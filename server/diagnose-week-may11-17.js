/**
 * diagnose-week-may11-17.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Diagnoses VehicleTrip records for the week 11/05/2026 to 17/05/2026.
 * READ-ONLY — makes no changes to the database.
 *
 * HOW TO RUN:
 *   node diagnose-week-may11-17.js
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

const WEEK_START = new Date(2026, 4, 11, 0, 0, 0, 0);   // 11 May 2026 local midnight
const WEEK_END   = new Date(2026, 4, 17, 23, 59, 59, 999); // 17 May 2026 local end

function sep(char = '─', len = 70) { return char.repeat(len); }
function fmt(n) { return String(n).padStart(6); }

async function diagnoseVehicle(vehicle, trips) {
  const realTrips    = trips.filter(t => t.source !== 'Summary edit');
  const summaryTrips = trips.filter(t => t.source === 'Summary edit');

  const realTripCount    = realTrips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);
  const summaryTripCount = summaryTrips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);
  const totalTripCount   = realTripCount + summaryTripCount;

  const realRentTotal    = realTrips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
  const summaryRentTotal = summaryTrips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
  const totalRent        = realRentTotal + summaryRentTotal;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🚛  ${vehicle.vehicleNumber}  [${vehicle.ownershipType}]  —  Owner: ${vehicle.rentalOwner || 'N/A'}`);
  console.log(`    Default rate: ₹${vehicle.rentalAmount || 0}/trip`);
  console.log(sep());

  console.log(`\n  📋 REAL trip records (source ≠ 'Summary edit'):  ${realTrips.length} document(s)`);
  if (realTrips.length === 0) {
    console.log('     (none)');
  } else {
    console.log(`  ${'DATE'.padEnd(14)} ${'TRIPS'.padStart(6)} ${'RENT ₹'.padStart(10)}  SOURCE`);
    for (const t of realTrips.sort((a,b) => a.tripDate - b.tripDate)) {
      const d = t.tripDate.toISOString().slice(0, 10);
      console.log(`  ${d.padEnd(14)} ${fmt(t.numberOfTrips)} ${fmt(t.rentalAmount || 0).padStart(10)}  ${t.source || '(billing)'}`);
    }
    console.log(sep('·'));
    console.log(`  ${'SUBTOTAL'.padEnd(14)} ${fmt(realTripCount)} ${fmt(realRentTotal).padStart(10)}`);
  }

  console.log(`\n  ✏️  SUMMARY EDIT records (source = 'Summary edit'):  ${summaryTrips.length} document(s)`);
  if (summaryTrips.length === 0) {
    console.log('     (none)');
  } else {
    console.log(`  ${'DATE'.padEnd(14)} ${'TRIPS'.padStart(6)} ${'RENT ₹'.padStart(10)}  RATE/TRIP`);
    for (const t of summaryTrips.sort((a,b) => a.tripDate - b.tripDate)) {
      const d = t.tripDate.toISOString().slice(0, 10);
      console.log(`  ${d.padEnd(14)} ${fmt(t.numberOfTrips)} ${fmt(t.rentalAmount || 0).padStart(10)}  ₹${t.rentalTripRate || 0}/trip`);
    }
    console.log(sep('·'));
    console.log(`  ${'SUBTOTAL'.padEnd(14)} ${fmt(summaryTripCount)} ${fmt(summaryRentTotal).padStart(10)}`);
  }

  console.log(`\n  ${'═'.repeat(40)}`);
  console.log(`  ${'TOTAL (real + summary)'.padEnd(28)} ${fmt(totalTripCount)} ${fmt(totalRent).padStart(10)}`);
  console.log(`  ${'═'.repeat(40)}`);

  // Flags
  if (summaryTrips.length > 1) {
    console.log(`\n  ⚠️  MULTIPLE Summary edit records — likely stale duplicates!`);
  }
  if (summaryTripCount < 0) {
    console.log(`\n  ⚠️  Summary edit has NEGATIVE trip adjustment (${summaryTripCount})`);
  }
  if (summaryRentTotal < 0) {
    console.log(`\n  ⚠️  Summary edit has NEGATIVE rental amount (₹${summaryRentTotal})`);
  }
  if (realRentTotal > 0 && summaryRentTotal > 0 && vehicle.ownershipType === 'Rental') {
    console.log(`\n  ⚠️  DOUBLE-COUNT RISK: both real trips AND summary edit carry rental amounts`);
    console.log(`      Real rent: ₹${realRentTotal}  +  Summary rent: ₹${summaryRentTotal}  =  ₹${totalRent}`);
  }

  return { totalTripCount, totalRent, realTripCount, summaryTripCount };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');
  console.log(`\n📅 Week: ${WEEK_START.toDateString()} → ${WEEK_END.toDateString()}\n`);

  const vehicles = await Vehicle.find({ isActive: true }).sort({ ownershipType: 1, vehicleNumber: 1 });

  let grandOwnTrips = 0, grandRentalTrips = 0, grandRentalRent = 0;

  for (const vehicle of vehicles) {
    const trips = await VehicleTrip.find({
      vehicle:  vehicle._id,
      tripDate: { $gte: WEEK_START, $lte: WEEK_END },
    });

    if (trips.length === 0) {
      console.log(`\n✅  ${vehicle.vehicleNumber} [${vehicle.ownershipType}] — no records this week`);
      continue;
    }

    const { totalTripCount, totalRent } = await diagnoseVehicle(vehicle, trips);

    if (vehicle.ownershipType === 'Own')    grandOwnTrips    += totalTripCount;
    if (vehicle.ownershipType === 'Rental') grandRentalTrips += totalTripCount;
    if (vehicle.ownershipType === 'Rental') grandRentalRent  += totalRent;
  }

  // Grand totals
  console.log(`\n\n${'█'.repeat(70)}`);
  console.log('  GRAND TOTALS FOR WEEK 11–17 MAY 2026');
  console.log(`${'█'.repeat(70)}`);
  console.log(`  Own vehicle trips    : ${grandOwnTrips}   (expected: 132)`);
  console.log(`  Rental vehicle trips : ${grandRentalTrips}   (expected: 32)`);
  console.log(`  Rental rent total    : ₹${grandRentalRent}`);
  console.log(`${'█'.repeat(70)}\n`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected. No changes were made.\n');
}

run().catch(err => { console.error('❌ Failed:', err); process.exit(1); });
