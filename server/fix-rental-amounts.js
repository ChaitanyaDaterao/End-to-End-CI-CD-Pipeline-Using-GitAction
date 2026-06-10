/**
 * fix-rental-amounts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes VehicleTrip records for Rental vehicles where rentalAmount = 0
 * even though the vehicle has a rentalAmount (ratePerTrip) configured.
 *
 * Root cause: billing.js creates VehicleTrip records but the rentalTripRate
 * was not being passed/resolved correctly, leaving rentalAmount = 0.
 *
 * WHAT IT DOES:
 *   For every VehicleTrip on a Rental vehicle with rentalAmount = 0:
 *   1. Looks up the rate: checks VehicleRentalRate for that date,
 *      falls back to vehicle.rentalAmount default.
 *   2. Recalculates rentalAmount = numberOfTrips × ratePerTrip
 *      (or quantity × ratePerBrass for Quantity billing).
 *   3. Updates the record.
 *
 * SAFE TO RE-RUN — skips records that already have rentalAmount > 0.
 *
 * HOW TO RUN:
 *   node fix-rental-amounts.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGO_URI not found'); process.exit(1); }

const VehicleTrip       = require('./models/VehicleTrip');
const Vehicle           = require('./models/Vehicle');
const VehicleRentalRate = require('./models/VehicleRentalRate');

// Same helper as vehicles.js — checks daily override, falls back to vehicle default
async function getRentalRate(vehicle, tripDate) {
  const dayStart = new Date(tripDate); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(tripDate); dayEnd.setHours(23, 59, 59, 999);

  const rateDoc = await VehicleRentalRate.findOne({
    vehicle: vehicle._id,
    date: { $gte: dayStart, $lte: dayEnd },
  });

  if (rateDoc) {
    return {
      ratePerTrip:  rateDoc.ratePerTrip  || 0,
      ratePerBrass: rateDoc.ratePerBrass || 0,
      source: 'daily-override',
    };
  }
  return {
    ratePerTrip:  vehicle.rentalAmount          || 0,
    ratePerBrass: vehicle.rentalAmountPerBrass  || 0,
    source: 'vehicle-default',
  };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // Load all Rental vehicles
  const rentalVehicles = await Vehicle.find({ ownershipType: 'Rental', isActive: true });
  console.log(`🚛 Found ${rentalVehicles.length} active Rental vehicles\n`);

  let fixed   = 0;
  let skipped = 0;
  let noRate  = 0;

  for (const vehicle of rentalVehicles) {
    // Find ALL VehicleTrip records for this vehicle with rentalAmount = 0
    const trips = await VehicleTrip.find({
      vehicle:      vehicle._id,
      rentalAmount: { $in: [0, null] },
      source:       { $ne: 'Summary edit' },
    });

    if (trips.length === 0) {
      console.log(`✅ ${vehicle.vehicleNumber} — no zero-rental records`);
      continue;
    }

    console.log(`\n🔧 ${vehicle.vehicleNumber} (default rate: ₹${vehicle.rentalAmount}/trip, ₹${vehicle.rentalAmountPerBrass || 0}/brass)`);
    console.log(`   ${trips.length} record(s) with rentalAmount = 0`);

    for (const trip of trips) {
      const rates = await getRentalRate(vehicle, trip.tripDate);

      let rentalAmount = 0;
      let rentalTripRate = 0;
      let rentalQuantityRate = 0;

      if (trip.billingType === 'Quantity') {
        rentalQuantityRate = rates.ratePerBrass;
        rentalAmount       = (trip.quantity || 0) * rentalQuantityRate;
      } else {
        rentalTripRate = rates.ratePerTrip;
        rentalAmount   = (trip.numberOfTrips || 0) * rentalTripRate;
      }

      if (rentalAmount === 0) {
        // No rate configured anywhere — skip but warn
        const dateStr = trip.tripDate.toISOString().slice(0, 10);
        console.log(
          `   ⚠️  SKIP ${dateStr} | trips: ${trip.numberOfTrips}` +
          ` — rate is 0 (no default or daily override set for this vehicle)`
        );
        noRate++;
        continue;
      }

      const dateStr = trip.tripDate.toISOString().slice(0, 10);
      const oldAmt  = trip.rentalAmount;

      trip.rentalAmount       = rentalAmount;
      if (rentalTripRate     > 0) trip.rentalTripRate     = rentalTripRate;
      if (rentalQuantityRate > 0) trip.rentalQuantityRate = rentalQuantityRate;
      await trip.save();

      console.log(
        `   ✏️  FIXED ${dateStr} | trips: ${trip.numberOfTrips}` +
        ` | rate: ₹${rentalTripRate || rentalQuantityRate} (${rates.source})` +
        ` | rentalAmount: ₹${oldAmt} → ₹${rentalAmount}`
      );
      fixed++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`✏️  Fixed   : ${fixed}`);
  console.log(`⏭  Skipped : ${skipped}`);
  console.log(`⚠️  No rate : ${noRate} (vehicle has no rentalAmount configured)`);
  console.log('─'.repeat(60));
  console.log('\n🎉 Done! Refresh the vehicle weekly summary to see rental amounts.\n');

  await mongoose.disconnect();
}

run().catch(err => { console.error('❌ Failed:', err); process.exit(1); });
