const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

function weekBounds() {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { mon, sun };
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const { mon, sun } = weekBounds();
  console.log(`Week: ${mon.toDateString()} → ${sun.toDateString()}\n`);

  const db = mongoose.connection.db;

  const deliveries = await db.collection('customerdeliveries')
    .find({ date: { $gte: mon, $lte: sun } })
    .toArray();

  console.log(`Found ${deliveries.length} billing deliveries\n`);

  const allVehicleIds = [...new Set(
    deliveries.flatMap(d => (d.vehicles || []).map(v => v.vehicle).filter(Boolean).map(String))
  )].map(id => new mongoose.Types.ObjectId(id));

  const allCustomerIds = [...new Set(
    deliveries.map(d => d.customer).filter(Boolean).map(String)
  )].map(id => new mongoose.Types.ObjectId(id));

  const vehicles  = await db.collection('vehicles').find({ _id: { $in: allVehicleIds } }).toArray();
  const customers = await db.collection('customers').find({ _id: { $in: allCustomerIds } }).toArray();

  const vehMap  = {};
  for (const v of vehicles)  vehMap[String(v._id)] = v;
  const custMap = {};
  for (const c of customers) custMap[String(c._id)] = c;

  // Build expected VehicleTrip records — all vehicles, trips + rentalAmount summed per vehicle per day
  const tripMap = {}; // key: `vehicleId::YYYY-MM-DD`

  for (const del of deliveries) {
    const customer = custMap[String(del.customer)] || {};
    const _d = new Date(del.date);
    const dateKey = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;

    for (const v of (del.vehicles || [])) {
      if (!v.vehicle) continue;
      const veh   = vehMap[String(v.vehicle)];
      if (!veh) continue;

      const trips      = Number(v.numberOfTrips) || 0;
      const dailyRent  = Number(v.dailyRent) || 0;
      // rentalAmount for this row: if dailyRent is set use it, else trips × rateApplied for rental vehicles
      const rentalAmt  = veh.ownershipType === 'Rental'
        ? (dailyRent > 0 ? dailyRent : trips * (Number(v.rateApplied) || 0))
        : 0;

      const key = `${String(v.vehicle)}::${dateKey}`;
      if (!tripMap[key]) {
        const tripDate = new Date(_d.getFullYear(), _d.getMonth(), _d.getDate(), 0, 0, 0, 0);
        tripMap[key] = {
          vehicle:       new mongoose.Types.ObjectId(v.vehicle),
          tripDate,
          source:        del.material || '',
          destination:   del.destination || customer.siteAddress || '',
          numberOfTrips: 0,
          dieselAmount:  0,
          rentalAmount:  0,
          driverName:    v.driverName || '',
          note:          del.note || '',
        };
      }
      tripMap[key].numberOfTrips += trips;
      tripMap[key].rentalAmount  += rentalAmt;
      if (v.driverName) tripMap[key].driverName = v.driverName;
    }
  }

  const expectedTrips = Object.values(tripMap);
  console.log(`Expected VehicleTrip records: ${expectedTrips.length}\n`);

  const deleted = await db.collection('vehicletrips').deleteMany({
    tripDate: { $gte: mon, $lte: sun },
  });
  console.log(`🗑️  Deleted ${deleted.deletedCount} existing VehicleTrip records for this week`);

  if (expectedTrips.length > 0) {
    await db.collection('vehicletrips').insertMany(expectedTrips);
  }
  console.log(`✅ Inserted ${expectedTrips.length} VehicleTrip records rebuilt from billing\n`);

  console.log('━━━ Rebuilt Trip Summary ━━━');
  console.log(`${'Vehicle'.padEnd(25)} ${'Type'.padEnd(8)} ${'Trips'.padStart(6)} ${'Rent ₹'.padStart(10)}`);
  console.log('─'.repeat(55));
  let totalTrips = 0, totalRent = 0;
  for (const t of expectedTrips.sort((a, b) => String(a.vehicle).localeCompare(String(b.vehicle)))) {
    const veh  = vehMap[String(t.vehicle)];
    const name = veh?.vehicleNumber || String(t.vehicle);
    const type = veh?.ownershipType || '?';
    console.log(`${name.padEnd(25)} ${type.padEnd(8)} ${String(t.numberOfTrips).padStart(6)} ${String(t.rentalAmount).padStart(10)}`);
    totalTrips += t.numberOfTrips;
    totalRent  += t.rentalAmount;
  }
  console.log('─'.repeat(55));
  console.log(`${'TOTAL'.padEnd(25)} ${''.padEnd(8)} ${String(totalTrips).padStart(6)} ${String(totalRent).padStart(10)}`);

  await mongoose.disconnect();
  console.log('\n✅ Done. VehicleTrips now match billing exactly.');
}

main().catch(console.error);
