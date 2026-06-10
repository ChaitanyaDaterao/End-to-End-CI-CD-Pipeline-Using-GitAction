/**
 * fix-attendance.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME repair script — fixes corrupted StaffAttendance trip counts caused
 * by the missing `vehicle` filter bug (driver using multiple vehicles on the
 * same day had later records overwriting earlier ones).
 *
 * HOW TO RUN (from your project root, where package.json lives):
 *   node fix-attendance.js
 *
 * WHAT IT DOES:
 *   1. Loads every BillingDelivery ever created.
 *   2. Groups them by date → vehicle → driver (same logic as the fixed POST route).
 *   3. For each vehicle|driver|date combination, sums the correct total trips.
 *   4. Finds the matching StaffAttendance record(s) and updates numberOfTrips
 *      and earnedAmount.  Creates a record if one is missing entirely.
 *   5. Prints a full report of every change made.
 *
 * SAFE TO RE-RUN — it is idempotent; running it twice produces the same result.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

// ── Adjust this path to point at your .env or hard-code your MONGO_URI ──────
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not found in environment. Set it in .env or edit this script.');
  process.exit(1);
}

// ── Load models (adjust paths if your project structure differs) ─────────────
const BillingDelivery  = require('./models/BillingDelivery');
const StaffAttendance  = require('./models/StaffAttendance');
const Staff            = require('./models/Staff');
const Vehicle          = require('./models/Vehicle');

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── Step 1: Load ALL deliveries ──────────────────────────────────────────
  const allDeliveries = await BillingDelivery.find({})
      .populate('vehicles.vehicle', 'vehicleNumber ownershipType')
      .populate('vehicles.driver',  'name ratePerTrip')
      .sort({ date: 1 });

  console.log(`📦 Loaded ${allDeliveries.length} deliveries\n`);

  // ── Step 2: Build correct trip totals per date|vehicle|driver ────────────
  // key = "YYYY-MM-DD|vehicleId|driverId"
  const tripMap = {};   // key → { date, vehicleId, driverId, rate, trips }

  for (const delivery of allDeliveries) {
    const dateStr = delivery.date.toISOString().slice(0, 10);

    for (const v of delivery.vehicles) {
      if (!v.vehicle || !v.driver) continue;

      const ownershipType = v.vehicle?.ownershipType || '';
      if (ownershipType !== 'Own') continue;   // only Own vehicles get driver attendance

      const vehicleId = String(v.vehicle._id || v.vehicle);
      const driverId  = String(v.driver._id  || v.driver);
      const trips     = Number(v.numberOfTrips) || 0;
      const rate      = v.driver?.ratePerTrip ?? 200;

      const key = `${dateStr}|${vehicleId}|${driverId}`;
      if (!tripMap[key]) {
        tripMap[key] = { dateStr, vehicleId, driverId, rate, trips: 0 };
      }
      tripMap[key].trips += trips;
    }
  }

  const entries = Object.values(tripMap);
  console.log(`🗂  Found ${entries.length} unique date|vehicle|driver combinations\n`);

  // ── Step 3: Fix each StaffAttendance record ──────────────────────────────
  let fixed   = 0;
  let created = 0;
  let correct = 0;
  let skipped = 0;

  for (const entry of entries) {
    const { dateStr, vehicleId, driverId, rate, trips } = entry;

    // Build date range for the day — wide enough to catch both local-midnight
    // stored records (old billing.js) and UTC-noon stored records (staff.js)
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayStart  = new Date(Date.UTC(y, m - 1, d,  0,  0,  0,   0)); // UTC midnight
    const dayEnd    = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)); // UTC end-of-day
    // Also cover local-timezone midnight records that may be stored slightly earlier
    dayStart.setHours(dayStart.getHours() - 6); // subtract 6h buffer for any timezone

    const vehicleObjId = new mongoose.Types.ObjectId(vehicleId);
    const driverObjId  = new mongoose.Types.ObjectId(driverId);

    // Find the specific record for this vehicle+driver on this day
    const att = await StaffAttendance.findOne({
      staff:   driverObjId,
      vehicle: vehicleObjId,
      date:    { $gte: dayStart, $lte: dayEnd },
      note:    { $ne: 'Summary override' },
    });

    if (att) {
      const lockedRate = att.ratePerTrip || rate;
      const expected   = trips * lockedRate;

      if (att.numberOfTrips === trips && att.earnedAmount === expected) {
        correct++;
        continue;   // already correct — nothing to do
      }

      const oldTrips  = att.numberOfTrips;
      const oldEarned = att.earnedAmount;

      att.numberOfTrips = trips;
      att.earnedAmount  = expected;
      att.ratePerTrip   = att.ratePerTrip || lockedRate; // lock rate if missing
      await att.save();

      console.log(
          `✏️  FIXED  ${dateStr} | vehicle ${vehicleId.slice(-6)} | driver ${driverId.slice(-6)}` +
          `  trips: ${oldTrips} → ${trips}  earned: ₹${oldEarned} → ₹${expected}`
      );
      fixed++;

    } else {
      // No record exists at all for this vehicle+driver on this day — create it
      if (trips === 0) { skipped++; continue; }

      const attendDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)); // UTC noon — standard
      await StaffAttendance.create({
        staff:         driverObjId,
        vehicle:       vehicleObjId,
        date:          attendDate,
        numberOfTrips: trips,
        ratePerTrip:   rate,
        present:       true,
        earnedAmount:  trips * rate,
        note:          '',
      });

      console.log(
          `➕ CREATED ${dateStr} | vehicle ${vehicleId.slice(-6)} | driver ${driverId.slice(-6)}` +
          `  trips: ${trips}  earned: ₹${trips * rate}`
      );
      created++;
    }
  }

  // ── Step 4: Remove duplicate records left over from the old bug ───────────
  // The old bug could create multiple attendance records for the same
  // staff+date when vehicle was different. Now that each record is
  // vehicle-specific, we need to check for any remaining duplicates
  // (same staff + date + NO vehicle, or same staff+date written without vehicle).
  console.log('\n🔍 Checking for stale duplicate records (same staff+date, no vehicle)...');

  const dupCandidates = await StaffAttendance.aggregate([
    { $match: { note: { $ne: 'Summary override' } } },
    { $group: {
        _id:   { staff: '$staff', date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } },
        count: { $sum: 1 },
        ids:   { $push: '$_id' },
      }},
    { $match: { count: { $gt: 1 } } },
  ]);

  if (dupCandidates.length === 0) {
    console.log('✅ No duplicates found.\n');
  } else {
    console.log(`⚠️  Found ${dupCandidates.length} staff+date groups with multiple records.`);
    console.log('   These may be legitimate (driver used 2 vehicles) — listing for review:\n');
    for (const dup of dupCandidates) {
      const recs = await StaffAttendance.find({ _id: { $in: dup.ids } })
          .populate('staff', 'name')
          .populate('vehicle', 'vehicleNumber');
      for (const r of recs) {
        console.log(
            `   ${r.staff?.name || r.staff} | ${r.date.toISOString().slice(0,10)}` +
            ` | vehicle: ${r.vehicle?.vehicleNumber || r.vehicle || 'NONE'}` +
            ` | trips: ${r.numberOfTrips} | earned: ₹${r.earnedAmount}`
        );
      }
      console.log('');
    }
    console.log('   If any show NONE for vehicle, those are stale — delete them manually.');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`✅ Already correct : ${correct}`);
  console.log(`✏️  Fixed           : ${fixed}`);
  console.log(`➕ Created          : ${created}`);
  console.log(`⏭  Skipped (0 trips): ${skipped}`);
  console.log('─'.repeat(60));
  console.log('\n🎉 Done! Refresh the driver bill to see corrected totals.\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});