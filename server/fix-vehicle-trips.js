/**
 * fix-vehicle-trips.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME repair script — fixes corrupted VehicleTrip records caused by the
 * same overwrite bug that affected StaffAttendance: when the same vehicle
 * served multiple customers on the same day, the pairMap may have only
 * captured one customer's trips instead of summing all of them — or a
 * date-parsing timezone bug caused Sunday trips to be stored outside the
 * queried week window.
 *
 * HOW TO RUN (from your project root, where package.json lives):
 *   node fix-vehicle-trips.js
 *
 * WHAT IT DOES:
 *   1. Loads every BillingDelivery ever created.
 *   2. Groups them by date → vehicle → driverName (same logic as billing.js pairMap).
 *   3. For each vehicle|driverName|date combination, sums the correct total trips,
 *      tripAmount, and rentalAmount from the source-of-truth BillingDelivery data.
 *   4. Finds matching VehicleTrip record(s) and corrects numberOfTrips / tripAmount.
 *      Creates a record if one is missing entirely.
 *   5. Prints a full report of every change made.
 *
 * WHAT IT DOES NOT TOUCH:
 *   - VehicleTrip records with source = 'Summary edit'  (manual overrides — preserved)
 *   - VehicleTrip records with source = 'Manual'        (hand-entered records — preserved)
 *   - Expenses, rental rates, or any other collection
 *
 * SAFE TO RE-RUN — idempotent; running it twice produces the same result.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not found in environment. Set it in .env or edit this script.');
  process.exit(1);
}

// ── Load models ───────────────────────────────────────────────────────────────
const BillingDelivery = require('./models/BillingDelivery');
const VehicleTrip     = require('./models/VehicleTrip');
const Vehicle         = require('./models/Vehicle');
const Staff           = require('./models/Staff'); // needed so mongoose can populate vehicles.driver

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── Step 1: Load ALL deliveries ───────────────────────────────────────────
  const allDeliveries = await BillingDelivery.find({})
      .populate('vehicles.vehicle', 'vehicleNumber ownershipType rentalAmount rentalAmountPerBrass')
      .populate('vehicles.driver',  'name')
      .sort({ date: 1 });

  console.log(`📦 Loaded ${allDeliveries.length} deliveries\n`);

  // ── Step 2: Build correct trip totals per date|vehicle|driverName ─────────
  // Key mirrors billing.js pairMap: "YYYY-MM-DD|vehicleId|driverName"
  // (driverName is a string, not an ObjectId — that's how VehicleTrip stores it)
  //
  // For each group we track:
  //   trips       — sum of numberOfTrips across all deliveries that day
  //   tripAmount  — sum of tripAmount (what the customer pays)
  //   rentalAmount— sum of rentalAmount (what we owe the rental owner)
  //   billingType — 'Trip' or 'Quantity' (last value wins; should be consistent per vehicle)
  //   source      — 'Billing' (set on create; never overwrite manual records)
  //   material, source, destination, quantity, quantityUnit
  //     → not aggregated (VehicleTrip only stores these from the first/last write in billing.js)
  //     → we only correct numberOfTrips + tripAmount + rentalAmount

  const tripMap = {};

  for (const delivery of allDeliveries) {
    // Use local-date string (IST) — same as parseLocalDate in billing.js
    // delivery.date is stored as UTC noon, so .toISOString().slice(0,10) is safe here
    const dateStr = delivery.date.toISOString().slice(0, 10);

    for (const v of delivery.vehicles) {
      if (!v.vehicle) continue;

      const vehicleId    = String(v.vehicle._id || v.vehicle);
      const driverName   = (v.driver?.name || v.driverName || '').trim();
      const trips        = Number(v.numberOfTrips)  || 0;
      const tripAmt      = Number(v.tripAmount)      || 0;
      const rentalAmt    = Number(v.rentalAmount)    || 0;
      const billingType  = v.billingType || 'Trip';
      const ownershipType = v.vehicle?.ownershipType || '';

      const key = `${dateStr}|${vehicleId}|${driverName}`;
      if (!tripMap[key]) {
        tripMap[key] = {
          dateStr,
          vehicleId,
          driverName,
          ownershipType,
          trips:        0,
          tripAmount:   0,
          rentalAmount: 0,
          billingType,
        };
      }
      tripMap[key].trips        += trips;
      tripMap[key].tripAmount   += tripAmt;
      tripMap[key].rentalAmount += rentalAmt;
    }
  }

  const entries = Object.values(tripMap);
  console.log(`🗂  Found ${entries.length} unique date|vehicle|driverName combinations\n`);

  // ── Step 3: Fix each VehicleTrip record ───────────────────────────────────
  let fixed   = 0;
  let created = 0;
  let correct = 0;
  let skipped = 0;

  for (const entry of entries) {
    const { dateStr, vehicleId, driverName, ownershipType, trips, tripAmount, rentalAmount, billingType } = entry;

    if (trips === 0) { skipped++; continue; }

    // Wide date window — covers UTC-midnight, UTC-noon, and IST-midnight stored records
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayStart  = new Date(Date.UTC(y, m - 1, d,  0,  0,  0,   0));
    const dayEnd    = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    dayStart.setHours(dayStart.getHours() - 6); // 6h buffer for IST local-midnight records

    const vehicleObjId = new mongoose.Types.ObjectId(vehicleId);

    // Find the VehicleTrip for this vehicle+driverName on this day
    // Skip manual / summary-edit records so we don't clobber deliberate overrides
    const vt = await VehicleTrip.findOne({
      vehicle:    vehicleObjId,
      driverName: driverName,
      tripDate:   { $gte: dayStart, $lte: dayEnd },
      source:     { $nin: ['Summary edit', 'Manual'] },
    });

    if (vt) {
      const alreadyCorrect =
          vt.numberOfTrips === trips &&
          Math.round(vt.tripAmount)   === Math.round(tripAmount) &&
          Math.round(vt.rentalAmount) === Math.round(rentalAmount);

      if (alreadyCorrect) {
        correct++;
        continue;
      }

      const oldTrips  = vt.numberOfTrips;
      const oldAmt    = vt.tripAmount;
      const oldRental = vt.rentalAmount;

      vt.numberOfTrips = trips;
      vt.tripAmount    = tripAmount;
      if (ownershipType === 'Rental') vt.rentalAmount = rentalAmount;
      await vt.save();

      console.log(
          `✏️  FIXED  ${dateStr} | vehicle ${vehicleId.slice(-6)} | driver "${driverName}"` +
          `  trips: ${oldTrips} → ${trips}` +
          `  amount: ₹${oldAmt} → ₹${tripAmount}` +
          (ownershipType === 'Rental' ? `  rental: ₹${oldRental} → ₹${rentalAmount}` : '')
      );
      fixed++;

    } else {
      // No billing-sourced record found — check if a manual/summary record exists
      // (don't create a duplicate on top of it; just warn)
      const anyRecord = await VehicleTrip.findOne({
        vehicle:  vehicleObjId,
        tripDate: { $gte: dayStart, $lte: dayEnd },
        source:   { $in: ['Summary edit', 'Manual'] },
      });

      if (anyRecord) {
        console.log(
            `⚠️  SKIP   ${dateStr} | vehicle ${vehicleId.slice(-6)} | driver "${driverName}"` +
            `  — only a "${anyRecord.source}" record exists; not overwriting.`
        );
        skipped++;
        continue;
      }

      // Truly missing — create it
      const tripDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)); // UTC noon standard
      await VehicleTrip.create({
        vehicle:       vehicleObjId,
        tripDate,
        source:        'Billing',
        destination:   '',
        material:      null,
        quantity:      0,
        quantityUnit:  'brass',
        numberOfTrips: trips,
        billingType,
        rateApplied:   trips > 0 ? Math.round(tripAmount / trips) : 0,
        tripAmount,
        dieselAmount:  0,
        rentalTripRate:     0,
        rentalQuantityRate: 0,
        rentalAmount:  ownershipType === 'Rental' ? rentalAmount : 0,
        driverName,
        conductorName: '',
        note:          'Created by fix-vehicle-trips repair script',
      });

      console.log(
          `➕ CREATED ${dateStr} | vehicle ${vehicleId.slice(-6)} | driver "${driverName}"` +
          `  trips: ${trips}  amount: ₹${tripAmount}` +
          (ownershipType === 'Rental' ? `  rental: ₹${rentalAmount}` : '')
      );
      created++;
    }
  }

  // ── Step 4: Check for duplicate VehicleTrip records (same vehicle+date) ───
  // The old bug could create 2 separate records for the same vehicle on the same
  // day if two customers' orders were processed independently. After this fix,
  // there should be at most one billing-sourced record per vehicle+driverName+day.
  console.log('\n🔍 Checking for duplicate VehicleTrip records (same vehicle+date, billing source)...');

  const dupCandidates = await VehicleTrip.aggregate([
    { $match: { source: { $nin: ['Summary edit', 'Manual'] } } },
    { $group: {
        _id: {
          vehicle:    '$vehicle',
          driverName: '$driverName',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } },
        },
        count: { $sum: 1 },
        ids:   { $push: '$_id' },
        trips: { $push: '$numberOfTrips' },
      }},
    { $match: { count: { $gt: 1 } } },
  ]);

  if (dupCandidates.length === 0) {
    console.log('✅ No duplicates found.\n');
  } else {
    console.log(`⚠️  Found ${dupCandidates.length} vehicle+driverName+date groups with multiple billing records.`);
    console.log('   These may inflate trip totals — listing for manual review:\n');
    for (const dup of dupCandidates) {
      const recs = await VehicleTrip.find({ _id: { $in: dup.ids } })
          .populate('vehicle', 'vehicleNumber');
      for (const r of recs) {
        console.log(
            `   ${r.vehicle?.vehicleNumber || r.vehicle} | ${r.tripDate.toISOString().slice(0,10)}` +
            ` | driver: "${r.driverName}"` +
            ` | trips: ${r.numberOfTrips} | amount: ₹${r.tripAmount}` +
            ` | source: ${r.source || 'none'}`
        );
      }
      console.log('   → Keep the record with the correct total; delete the others manually.');
      console.log('');
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`✅ Already correct  : ${correct}`);
  console.log(`✏️  Fixed            : ${fixed}`);
  console.log(`➕ Created           : ${created}`);
  console.log(`⏭  Skipped          : ${skipped}`);
  console.log('─'.repeat(60));
  console.log('\n🎉 Done! Refresh the vehicle weekly summary to see corrected totals.\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
