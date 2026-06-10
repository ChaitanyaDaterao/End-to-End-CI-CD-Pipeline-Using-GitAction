const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  // Current week Mon 00:00 → Sun 23:59 (IST-safe local logic)
  const now  = new Date();
  const dow  = now.getDay(); // 0=Sun
  const mon  = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun  = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  console.log(`Week : ${mon.toDateString()}  →  ${sun.toDateString()}\n`);

  const deliveries = await mongoose.connection.db
    .collection('customerdeliveries')
    .find({ date: { $gte: mon, $lte: sun } })
    .toArray();

  console.log(`Delivery records in this week: ${deliveries.length}\n`);

  let totalTrips    = 0;
  let totalVehicles = 0; // vehicle-rows (one per vehicle per delivery)
  const vehicleMap  = {};

  for (const del of deliveries) {
    for (const v of (del.vehicles || [])) {
      const trips = Number(v.numberOfTrips) || 0;
      totalTrips    += trips;
      totalVehicles += 1;

      const vid = String(v.vehicle || 'unknown');
      if (!vehicleMap[vid]) vehicleMap[vid] = { trips: 0, rows: 0 };
      vehicleMap[vid].trips += trips;
      vehicleMap[vid].rows  += 1;
    }
  }

  // Enrich with vehicle numbers
  const vehicleIds = Object.keys(vehicleMap)
    .filter(id => id !== 'unknown')
    .map(id => new mongoose.Types.ObjectId(id));

  const vehicles = await mongoose.connection.db
    .collection('vehicles')
    .find({ _id: { $in: vehicleIds } })
    .toArray();

  const vehLookup = {};
  for (const v of vehicles) vehLookup[String(v._id)] = v.vehicleNumber || v.name || String(v._id);

  console.log('━━━ Per-Vehicle (this week) ━━━');
  const rows = Object.entries(vehicleMap)
    .map(([id, data]) => ({ vehicle: vehLookup[id] || id, trips: data.trips, rows: data.rows }))
    .sort((a, b) => b.trips - a.trips);

  for (const row of rows) {
    console.log(`  ${String(row.vehicle).padEnd(20)} ${String(row.trips).padStart(4)} trips   (${row.rows} delivery rows)`);
  }

  console.log('\n━━━ Totals ━━━');
  console.log(`  Total trips (sum of numberOfTrips) : ${totalTrips}`);
  console.log(`  Total vehicle-rows                 : ${totalVehicles}`);
  console.log(`  Distinct vehicles used             : ${rows.length}`);

  await mongoose.disconnect();
}

main().catch(console.error);
