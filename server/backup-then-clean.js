require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
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

  // Save backup to file
  const backupFile = `ghost-trips-backup-${new Date().toISOString().slice(0,10)}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(toDelete, null, 2));
  console.log(`Backup saved: ${backupFile}  (${toDelete.length} records)`);
  console.log('This file is in your server folder. Keep it as long as you want.\n');

  console.log(`Ready to delete ${toDelete.length} ghost records.`);
  console.log('Type "yes" to proceed, anything else to abort:');

  process.stdin.once('data', async (data) => {
    if (data.toString().trim().toLowerCase() === 'yes') {
      const ids    = toDelete.map(d => d._id);
      const result = await VehicleTrip.deleteMany({ _id: { $in: ids } });
      console.log(`Deleted ${result.deletedCount} ghost records.`);
      console.log(`Backup is at: ${backupFile} — delete it whenever you're satisfied.`);
    } else {
      console.log('Aborted. Nothing deleted. Backup file still saved.');
    }
    mongoose.disconnect();
  });

}).catch(err => { console.error(err); process.exit(1); });
