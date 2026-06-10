const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const deliveries = await mongoose.connection.db
    .collection('customerdeliveries')
    .find({})
    .toArray();

  let totalTrips = 0;
  const vehicleMap = {}; // vehicleId -> { number, trips }

  for (const del of deliveries) {
    for (const v of (del.vehicles || [])) {
      const trips = Number(v.numberOfTrips) || 0;
      totalTrips += trips;

      const vid = String(v.vehicle || 'unknown');
      if (!vehicleMap[vid]) vehicleMap[vid] = { trips: 0 };
      vehicleMap[vid].trips += trips;
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

  console.log('━━━ Per-Vehicle Trip Counts ━━━');
  const rows = Object.entries(vehicleMap)
    .map(([id, data]) => ({ vehicle: vehLookup[id] || id, trips: data.trips }))
    .sort((a, b) => b.trips - a.trips);

  for (const row of rows) {
    console.log(`  ${String(row.vehicle).padEnd(20)} ${row.trips} trips`);
  }

  console.log('\n━━━ Totals ━━━');
  console.log(`  Total trips across all vehicles : ${totalTrips}`);
  console.log(`  Distinct vehicles with trips    : ${rows.length}`);

  await mongoose.disconnect();
}

main().catch(console.error);
