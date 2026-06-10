/**
 * cleanup-repair-trips.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Removes VehicleTrip records that were incorrectly created by fix-vehicle-trips.js
 * with note = 'Created by fix-vehicle-trips repair script'.
 *
 * Also removes any VehicleTrip records in the current week (01/06–07/06/2026)
 * whose source = 'Billing' but have no matching BillingDelivery for that date,
 * which indicates the repair script wrote them on the wrong date due to UTC offset.
 *
 * HOW TO RUN:
 *   node cleanup-repair-trips.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not found in environment.');
  process.exit(1);
}

const BillingDelivery = require('./models/BillingDelivery');
const VehicleTrip     = require('./models/VehicleTrip');
const Vehicle         = require('./models/Vehicle');
const Staff           = require('./models/Staff');

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── Step 1: Delete all records the repair script created ──────────────────
  const repairCreated = await VehicleTrip.deleteMany({
    note: 'Created by fix-vehicle-trips repair script',
  });
  console.log(`🗑  Deleted ${repairCreated.deletedCount} records created by repair script\n`);

  // ── Step 2: Find VehicleTrip records in the current week with source=Billing
  //            and verify each has a real BillingDelivery on that date ────────
  // Current week: Mon 01/06/2026 – Sun 07/06/2026 (IST)
  const weekStart = new Date(2026, 5, 1,  0,  0,  0,   0); // local midnight Mon
  const weekEnd   = new Date(2026, 5, 7, 23, 59, 59, 999); // local midnight Sun

  const thisWeekTrips = await VehicleTrip.find({
    tripDate: { $gte: weekStart, $lte: weekEnd },
    source:   { $nin: ['Summary edit', 'Manual'] },
  }).populate('vehicle', 'vehicleNumber');

  console.log(`🔍 Found ${thisWeekTrips.length} non-manual VehicleTrip records in current week\n`);

  let deleted  = 0;
  let kept     = 0;

  for (const vt of thisWeekTrips) {
    const dateStr  = vt.tripDate.toISOString().slice(0, 10);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayStart  = new Date(Date.UTC(y, m - 1, d,  0,  0,  0,   0));
    const dayStart6 = new Date(dayStart); dayStart6.setHours(dayStart6.getHours() - 6);
    const dayEnd    = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

    // Check if any BillingDelivery exists for this vehicle on this date
    const deliveryExists = await BillingDelivery.findOne({
      'vehicles.vehicle': vt.vehicle._id || vt.vehicle,
      date: { $gte: dayStart6, $lte: dayEnd },
    });

    if (!deliveryExists) {
      console.log(
        `🗑  DELETE orphan: ${vt.vehicle?.vehicleNumber || vt.vehicle} | ${dateStr}` +
        ` | driver: "${vt.driverName}" | trips: ${vt.numberOfTrips} | source: ${vt.source}`
      );
      await VehicleTrip.deleteOne({ _id: vt._id });
      deleted++;
    } else {
      console.log(
        `✅ KEEP   valid:  ${vt.vehicle?.vehicleNumber || vt.vehicle} | ${dateStr}` +
        ` | driver: "${vt.driverName}" | trips: ${vt.numberOfTrips}`
      );
      kept++;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`🗑  Deleted repair-script records : ${repairCreated.deletedCount}`);
  console.log(`🗑  Deleted orphan this-week trips : ${deleted}`);
  console.log(`✅ Kept valid this-week trips      : ${kept}`);
  console.log('─'.repeat(60));
  console.log('\n🎉 Done! Refresh the weekly summary — current week should show 0.\n');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
