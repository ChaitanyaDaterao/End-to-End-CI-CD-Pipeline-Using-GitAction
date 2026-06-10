require('dotenv').config();
const mongoose    = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {

  // Inspect the first few duplicate groups — show full details of each record
  const sampleIds = [
    // vehicle 69e3beac, date 2026-04-22 — 8 records
    '69eb96f2ad899a10053b6287',
    '69eb99eaad899a10053b62ba',
    '69ece70953fc8039b2a5577f',
    '69ece84253fc8039b2a558b1',
    '69ece86d53fc8039b2a558de',
    '69ece8b253fc8039b2a55918',
    '69ece8ce53fc8039b2a55926',
    '69ece8e953fc8039b2a5593d',
  ];

  const records = await VehicleTrip.find({ _id: { $in: sampleIds } }).sort({ createdAt: 1 });

  console.log(`\n=== Group: vehicle 69e3beac, date 2026-04-22 (${records.length} records) ===\n`);
  records.forEach((r, i) => {
    console.log(`Record ${i+1}:`);
    console.log(`  _id:          ${r._id}`);
    console.log(`  createdAt:    ${r.createdAt}`);
    console.log(`  tripDate:     ${r.tripDate}`);
    console.log(`  source:       "${r.source}"`);
    console.log(`  destination:  "${r.destination}"`);
    console.log(`  numberOfTrips:${r.numberOfTrips}`);
    console.log(`  tripAmount:   ${r.tripAmount}`);
    console.log(`  rentalAmount: ${r.rentalAmount}`);
    console.log(`  driverName:   "${r.driverName}"`);
    console.log(`  note:         "${r.note}"`);
    console.log('');
  });

  mongoose.disconnect();
});
