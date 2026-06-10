require('dotenv').config();
const mongoose = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');

  // Find groups where same vehicle+driverName+day has more than 1 record
  const nameDups = await VehicleTrip.aggregate([
    {
      $group: {
        _id: {
          vehicle:    '$vehicle',
          driverName: '$driverName',
          date:       { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } }
        },
        count: { $sum: 1 },
        ids:   { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort:  { count: -1 } }
  ]);

  console.log(`Total duplicate groups (same vehicle+driverName+day): ${nameDups.length}\n`);

  // Show first 15 groups in full detail
  const sample = nameDups.slice(0, 15);
  for (const group of sample) {
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } })
      .lean()
      .sort({ createdAt: 1 });

    console.log(`=== vehicle=${String(group._id.vehicle).slice(-6)}  driver="${group._id.driverName}"  date=${group._id.date}  (${group.count} records) ===`);
    docs.forEach((d, i) => {
      console.log(`  [${i+1}] _id=${d._id}  trips=${d.numberOfTrips}  tripAmt=${d.tripAmount}  rentalAmt=${d.rentalAmount}  dest="${d.destination}"  createdAt=${d.createdAt?.toISOString()}`);
    });
    console.log('');
  }

  // Summary breakdown
  const ghostsOnly    = nameDups.filter(g => false); // placeholder
  
  // Count how many groups have a tripAmount=0 record mixed with tripAmount>0 records
  let mixedGroups = 0, allZeroGroups = 0, allNonZeroGroups = 0;
  for (const group of nameDups) {
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } }).lean();
    const hasZero    = docs.some(d => (d.tripAmount || 0) === 0);
    const hasNonZero = docs.some(d => (d.tripAmount || 0) > 0);
    if (hasZero && hasNonZero) mixedGroups++;
    else if (hasZero)          allZeroGroups++;
    else                       allNonZeroGroups++;
  }

  console.log('=== SUMMARY ===');
  console.log(`Groups with zero+nonzero mix (one is ghost, one is real): ${mixedGroups}`);
  console.log(`Groups where ALL records have tripAmount=0:                ${allZeroGroups}`);
  console.log(`Groups where ALL records have tripAmount>0:                ${allNonZeroGroups}`);
  console.log('');
  console.log('Only "mixed" groups are safe to auto-clean (delete the zero-amount one).');
  console.log('The other groups need manual review.');

  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
