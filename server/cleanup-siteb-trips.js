/**
 * cleanup-siteb-trips.js
 * Deletes all VehicleTrip records created by siteb.js (source = 'Chand Laluwale')
 * Run from your server folder: node cleanup-siteb-trips.js
 */

require('dotenv').config();
const mongoose   = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

const SITEB_SOURCE = 'Chand Laluwale';  // Site B owner name used as source

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Preview what will be deleted
  const toDelete = await VehicleTrip.find({ source: SITEB_SOURCE });
  console.log(`\nFound ${toDelete.length} VehicleTrip records with source = '${SITEB_SOURCE}'`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete. Exiting.');
    await mongoose.disconnect();
    return;
  }

  // Show a sample for confirmation
  console.log('\nSample records (first 5):');
  toDelete.slice(0, 5).forEach(t => {
    console.log(`  ${t._id}  date=${t.tripDate?.toISOString().slice(0,10)}  trips=${t.numberOfTrips}  vehicle=${t.vehicle}`);
  });

  // 2. Delete them
  const result = await VehicleTrip.deleteMany({ source: SITEB_SOURCE });
  console.log(`\n✅ Deleted ${result.deletedCount} duplicate VehicleTrip records.`);

  // 3. Verify nothing remains
  const remaining = await VehicleTrip.countDocuments({ source: SITEB_SOURCE });
  console.log(`Remaining records with source '${SITEB_SOURCE}': ${remaining}`);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
