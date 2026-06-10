require('dotenv').config();
const mongoose = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');

  // Find all trips where tripAmount = 0 and numberOfTrips > 1
  // These are the "ghost summary" records created when driverName was blank
  const ghosts = await VehicleTrip.find({
    tripAmount:    0,
    numberOfTrips: { $gt: 1 },
  }).lean();

  console.log(`Found ${ghosts.length} ghost summary records (tripAmount=0, trips>1)\n`);

  if (ghosts.length === 0) {
    // Also check for driverName='' duplicates
    const blankNameDups = await VehicleTrip.aggregate([
      { $match: { driverName: '' } },
      {
        $group: {
          _id: {
            vehicle: '$vehicle',
            date: { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } }
          },
          count: { $sum: 1 },
          ids:   { $push: '$_id' },
          dates: { $push: '$createdAt' }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);
    console.log(`Found ${blankNameDups.length} vehicle+date groups with multiple blank-driverName records`);
    if (blankNameDups.length === 0) {
      console.log('No ghosts or blank-name duplicates found. DB looks clean.');
      return mongoose.disconnect();
    }
  }

  // Preview what will be deleted
  console.log('Sample ghosts to delete:');
  ghosts.slice(0, 5).forEach(g => {
    console.log(`  _id=${g._id}  vehicle=${g.vehicle}  date=${g.tripDate?.toISOString().slice(0,10)}  trips=${g.numberOfTrips}  driverName="${g.driverName}"  createdAt=${g.createdAt}`);
  });

  // Also find cases where same vehicle+driverName+day has multiple records
  // (these come from the driverName mismatch bug — old blank record + newer named records)
  const nameDups = await VehicleTrip.aggregate([
    {
      $group: {
        _id: {
          vehicle:    '$vehicle',
          driverName: '$driverName',
          date:       { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } }
        },
        count:     { $sum: 1 },
        ids:       { $push: '$_id' },
        createdAts: { $push: '$createdAt' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  console.log(`\nFound ${nameDups.length} vehicle+driverName+day groups with duplicates`);

  // For each duplicate group: keep the one with highest numberOfTrips (most complete),
  // or if tied, keep the most recent. Delete all others.
  let toDelete = new Set(ghosts.map(g => String(g._id)));

  for (const group of nameDups) {
    // Fetch full docs to compare
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } }).lean();
    // Sort: highest numberOfTrips first, then most recent createdAt
    docs.sort((a, b) => {
      if (b.numberOfTrips !== a.numberOfTrips) return b.numberOfTrips - a.numberOfTrips;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    // Keep first, delete rest
    docs.slice(1).forEach(d => toDelete.add(String(d._id)));
  }

  const deleteIds = [...toDelete];
  console.log(`\nTotal records to delete: ${deleteIds.length}`);
  console.log('\nType "yes" to proceed, anything else to abort:');

  process.stdin.once('data', async (data) => {
    if (data.toString().trim().toLowerCase() === 'yes') {
      const result = await VehicleTrip.deleteMany({ _id: { $in: deleteIds } });
      console.log(`Deleted ${result.deletedCount} ghost/duplicate records.`);
    } else {
      console.log('Aborted. Nothing deleted.');
    }
    mongoose.disconnect();
  });

}).catch(err => {
  console.error(err);
  process.exit(1);
});
