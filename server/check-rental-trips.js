const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  // Rental vehicle IDs from billing this week
  const deliveries = await mongoose.connection.db
    .collection('customerdeliveries')
    .find({ date: { $gte: mon, $lte: sun } })
    .toArray();

  const rentalVehicleIds = new Set();
  const billingRentalMap = {};
  for (const del of deliveries) {
    for (const v of (del.vehicles || [])) {
      if (!v.vehicle) continue;
      const veh = await mongoose.connection.db.collection('vehicles').findOne({ _id: new mongoose.Types.ObjectId(v.vehicle) });
      if (veh && veh.ownershipType !== 'Own') {
        const vid = String(v.vehicle);
        rentalVehicleIds.add(vid);
        billingRentalMap[vid] = (billingRentalMap[vid] || 0) + (Number(v.numberOfTrips) || 0);
      }
    }
  }

  console.log('━━━ Rental vehicles in billing this week ━━━');
  const vehicles = await mongoose.connection.db
    .collection('vehicles')
    .find({ _id: { $in: [...rentalVehicleIds].map(id => new mongoose.Types.ObjectId(id)) } })
    .toArray();
  const vehLookup = {};
  for (const v of vehicles) vehLookup[String(v._id)] = { number: v.vehicleNumber || v.name, type: v.ownershipType };

  for (const [vid, trips] of Object.entries(billingRentalMap)) {
    console.log(`  ${(vehLookup[vid]?.number || vid).padEnd(20)} ownershipType: ${vehLookup[vid]?.type}   billing trips: ${trips}`);
  }

  console.log('\n━━━ VehicleTrips for these rental vehicles this week ━━━');
  for (const vid of rentalVehicleIds) {
    const vt = await mongoose.connection.db.collection('vehicletrips').find({
      vehicle: new mongoose.Types.ObjectId(vid),
      tripDate: { $gte: mon, $lte: sun },
    }).toArray();
    const total = vt.reduce((s, r) => s + (r.numberOfTrips || 0), 0);
    console.log(`  ${(vehLookup[vid]?.number || vid).padEnd(20)} vehicletrips records: ${vt.length}   total trips: ${total}`);
  }

  console.log('\n━━━ ownershipType values in vehicles collection ━━━');
  const allVehicles = await mongoose.connection.db.collection('vehicles').find({}).toArray();
  const typeCounts = {};
  for (const v of allVehicles) {
    const t = v.ownershipType || 'undefined';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count} vehicles`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
