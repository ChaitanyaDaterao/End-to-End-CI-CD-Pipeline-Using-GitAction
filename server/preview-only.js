require('dotenv').config();
const mongoose = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');

  const nameDups = await VehicleTrip.aggregate([
    {
      $group: {
        _id: { vehicle: '$vehicle', driverName: '$driverName', date: { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } } },
        count: { $sum: 1 },
        ids:   { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  const toDelete = [];
  for (const group of nameDups) {
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } }).lean();
    const zeroAmtDocs    = docs.filter(d => (d.tripAmount || 0) === 0);
    const nonZeroAmtDocs = docs.filter(d => (d.tripAmount || 0) >  0);
    if (zeroAmtDocs.length > 0 && nonZeroAmtDocs.length > 0) {
      for (const d of zeroAmtDocs) toDelete.push(d);
    }
  }

  console.log(`Records that WILL BE DELETED: ${toDelete.length}`);
  console.log(`\n--- EVERY record scheduled for deletion ---`);
  toDelete.forEach((d, i) => {
    console.log(`[${i+1}] _id=${d._id}  date=${d.tripDate?.toISOString().slice(0,10)}  driver="${d.driverName}"  trips=${d.numberOfTrips}  tripAmt=${d.tripAmount}  dest="${d.destination}"  createdAt=${d.createdAt?.toISOString()}`);
  });

  console.log(`\n--- EVERY record that WILL BE KEPT (non-zero amount) in those same groups ---`);
  const keepDocs = [];
  for (const group of nameDups) {
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } }).lean();
    const zeroAmtDocs    = docs.filter(d => (d.tripAmount || 0) === 0);
    const nonZeroAmtDocs = docs.filter(d => (d.tripAmount || 0) >  0);
    if (zeroAmtDocs.length > 0 && nonZeroAmtDocs.length > 0) {
      for (const d of nonZeroAmtDocs) keepDocs.push(d);
    }
  }
  keepDocs.forEach((d, i) => {
    console.log(`[${i+1}] _id=${d._id}  date=${d.tripDate?.toISOString().slice(0,10)}  driver="${d.driverName}"  trips=${d.numberOfTrips}  tripAmt=${d.tripAmount}  dest="${d.destination}"`);
  });

  console.log(`\nSummary: will delete ${toDelete.length}, will keep ${keepDocs.length} real records`);
  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
