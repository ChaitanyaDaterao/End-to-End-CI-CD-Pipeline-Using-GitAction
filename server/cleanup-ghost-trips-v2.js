require('dotenv').config();
const mongoose = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');

  // Find all groups: same vehicle + driverName + day with more than 1 record
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
    { $match: { count: { $gt: 1 } } }
  ]);

  console.log(`Total duplicate groups: ${nameDups.length}`);

  const toDelete    = [];
  const skipGroups  = [];

  for (const group of nameDups) {
    const docs = await VehicleTrip.find({ _id: { $in: group.ids } }).lean();

    const zeroAmtDocs    = docs.filter(d => (d.tripAmount || 0) === 0);
    const nonZeroAmtDocs = docs.filter(d => (d.tripAmount || 0) >  0);

    if (zeroAmtDocs.length > 0 && nonZeroAmtDocs.length > 0) {
      // Safe: delete ALL zero-amount records in this group, keep all non-zero
      for (const d of zeroAmtDocs) {
        toDelete.push({
          _id:        d._id,
          vehicle:    String(group._id.vehicle).slice(-6),
          driverName: group._id.driverName,
          date:       group._id.date,
          trips:      d.numberOfTrips,
          dest:       d.destination,
        });
      }
    } else {
      // All zero or all non-zero — skip, needs manual review
      skipGroups.push({
        key:   `vehicle=${String(group._id.vehicle).slice(-6)} driver="${group._id.driverName}" date=${group._id.date}`,
        count: docs.length,
        docs:  docs.map(d => ({ _id: d._id, trips: d.numberOfTrips, amt: d.tripAmount, dest: d.destination }))
      });
    }
  }

  console.log(`\nSafe to delete (zero-amount ghosts in mixed groups): ${toDelete.length}`);
  console.log(`Skipping (need manual review): ${skipGroups.length} groups`);

  if (skipGroups.length > 0) {
    console.log('\n--- SKIPPED GROUPS (review manually) ---');
    skipGroups.forEach(g => {
      console.log(`\n${g.key}  (${g.count} records)`);
      g.docs.forEach((d, i) => console.log(`  [${i+1}] _id=${d._id}  trips=${d.trips}  amt=${d.amt}  dest="${d.dest}"`));
    });
  }

  console.log('\n--- SAMPLE OF RECORDS TO DELETE (first 10) ---');
  toDelete.slice(0, 10).forEach(d => {
    console.log(`  _id=${d._id}  vehicle=...${d.vehicle}  driver="${d.driverName}"  date=${d.date}  trips=${d.trips}  dest="${d.dest}"`);
  });

  console.log(`\nReady to delete ${toDelete.length} ghost records.`);
  console.log('Type "yes" to proceed, anything else to abort:');

  process.stdin.once('data', async (data) => {
    if (data.toString().trim().toLowerCase() === 'yes') {
      const ids    = toDelete.map(d => d._id);
      const result = await VehicleTrip.deleteMany({ _id: { $in: ids } });
      console.log(`\nDeleted ${result.deletedCount} ghost records.`);
      console.log('Done. Your vehicle trip records now match billing.');
    } else {
      console.log('Aborted. Nothing deleted.');
    }
    mongoose.disconnect();
  });

}).catch(err => { console.error(err); process.exit(1); });
