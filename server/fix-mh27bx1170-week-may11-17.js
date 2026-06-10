/**
 * fix-mh27bx1170-week-may11-17.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Targeted fix for MH27BX1170 for the week 11/05/2026 to 17/05/2026.
 *
 * FIX 1: Delete stale 'Summary edit' record dated 2026-05-10
 *         that carries ₹9,000 phantom rent with 0 trips.
 *
 * FIX 2: Correct the 2026-05-12 real trip record:
 *         2 trips × ₹1,800 = ₹3,600 (currently shows ₹1,800 — wrong)
 *
 * SAFE TO RE-RUN — Fix 1 checks record exists before deleting,
 *                  Fix 2 checks current value before updating.
 *
 * HOW TO RUN:
 *   node fix-mh27bx1170-week-may11-17.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGO_URI not found'); process.exit(1); }

const VehicleTrip = require('./models/VehicleTrip');
const Vehicle     = require('./models/Vehicle');

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const vehicle = await Vehicle.findOne({ vehicleNumber: 'MH27BX1170', isActive: true });
  if (!vehicle) { console.error('❌ Vehicle MH27BX1170 not found'); process.exit(1); }
  console.log(`🚛 Found vehicle: ${vehicle.vehicleNumber} (rate: ₹${vehicle.rentalAmount}/trip)\n`);

  // ── FIX 1: Delete stale Summary edit record dated 2026-05-10 ──────────────
  console.log('── FIX 1: Stale Summary edit record ─────────────────────────────────────');

  const may10Start = new Date(2026, 4, 10, 0, 0, 0, 0);
  const may10End   = new Date(2026, 4, 10, 23, 59, 59, 999);

  const staleRecords = await VehicleTrip.find({
    vehicle:  vehicle._id,
    tripDate: { $gte: may10Start, $lte: may10End },
    source:   'Summary edit',
  });

  if (staleRecords.length === 0) {
    console.log('   ℹ️  No stale Summary edit record found on 2026-05-10 — already cleaned up or never existed.\n');
  } else {
    for (const rec of staleRecords) {
      console.log(`   🗑️  Deleting Summary edit: date=${rec.tripDate.toISOString().slice(0,10)} trips=${rec.numberOfTrips} rent=₹${rec.rentalAmount}`);
      await VehicleTrip.deleteOne({ _id: rec._id });
    }
    console.log(`   ✅ Deleted ${staleRecords.length} stale Summary edit record(s)\n`);
  }

  // ── FIX 2: Correct ₹1,800 → ₹3,600 on 2026-05-12 (2 trips × ₹1,800) ─────
  console.log('── FIX 2: Wrong rentalAmount on 2026-05-12 ──────────────────────────────');

  const may12Start = new Date(2026, 4, 12, 0, 0, 0, 0);
  const may12End   = new Date(2026, 4, 12, 23, 59, 59, 999);

  const may12Trips = await VehicleTrip.find({
    vehicle:  vehicle._id,
    tripDate: { $gte: may12Start, $lte: may12End },
    source:   { $ne: 'Summary edit' },
  });

  console.log(`   Found ${may12Trips.length} real trip record(s) on 2026-05-12:`);

  let fixedCount = 0;
  for (const trip of may12Trips) {
    const expectedRent = (trip.numberOfTrips || 0) * (trip.rentalTripRate || vehicle.rentalAmount || 0);
    console.log(`   → trips=${trip.numberOfTrips}  rentalTripRate=₹${trip.rentalTripRate}  current rentalAmount=₹${trip.rentalAmount}  expected=₹${expectedRent}`);

    if (trip.rentalAmount !== expectedRent) {
      const old = trip.rentalAmount;
      trip.rentalAmount = expectedRent;
      if (!trip.rentalTripRate || trip.rentalTripRate === 0) {
        trip.rentalTripRate = vehicle.rentalAmount || 0;
      }
      await trip.save();
      console.log(`   ✏️  FIXED rentalAmount: ₹${old} → ₹${expectedRent}`);
      fixedCount++;
    } else {
      console.log(`   ✅ Already correct — no change needed`);
    }
  }
  if (fixedCount === 0 && may12Trips.length > 0) {
    console.log('   ℹ️  All 2026-05-12 records already have correct rental amounts.\n');
  } else {
    console.log(`   ✅ Fixed ${fixedCount} record(s)\n`);
  }

  // ── Verification: print final state for this week ─────────────────────────
  console.log('── VERIFICATION: Final state for MH27BX1170 (week 11–17 May) ───────────');

  const weekStart = new Date(2026, 4, 11, 0, 0, 0, 0);
  const weekEnd   = new Date(2026, 4, 17, 23, 59, 59, 999);

  const allTrips = await VehicleTrip.find({
    vehicle:  vehicle._id,
    tripDate: { $gte: weekStart, $lte: weekEnd },
  });

  const totalTrips = allTrips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);
  const totalRent  = allTrips.reduce((s, t) => s + (t.rentalAmount  || 0), 0);

  console.log(`\n   ${'DATE'.padEnd(14)} ${'TRIPS'.padStart(6)} ${'RENT ₹'.padStart(10)}  SOURCE`);
  for (const t of allTrips.sort((a, b) => a.tripDate - b.tripDate)) {
    const d = t.tripDate.toISOString().slice(0, 10);
    console.log(`   ${d.padEnd(14)} ${String(t.numberOfTrips).padStart(6)} ${String(t.rentalAmount || 0).padStart(10)}  ${t.source || '(billing)'}`);
  }
  console.log('   ' + '·'.repeat(40));
  console.log(`   ${'TOTAL'.padEnd(14)} ${String(totalTrips).padStart(6)} ${String(totalRent).padStart(10)}`);
  console.log('\n' + '─'.repeat(70));
  console.log(`   Total trips : ${totalTrips}`);
  console.log(`   Total rent  : ₹${totalRent}`);
  console.log('─'.repeat(70));

  await mongoose.disconnect();
  console.log('\n🎉 Done!\n');
}

run().catch(err => { console.error('❌ Failed:', err); process.exit(1); });
