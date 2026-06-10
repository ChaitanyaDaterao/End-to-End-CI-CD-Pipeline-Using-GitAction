require('dotenv').config();
const mongoose    = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {

  // Find records with tripAmount=0 and numberOfTrips > 1 — likely ghost summary records
  const ghosts = await VehicleTrip.find({
    tripAmount:    0,
    numberOfTrips: { $gt: 1 },
  }).sort({ createdAt: 1 });

  console.log(`Ghost summary records (tripAmount=0, trips>1): ${ghosts.length}\n`);
  ghosts.forEach(r => {
    console.log(`  ${r._id}  date=${r.tripDate?.toISOString().slice(0,10)}  trips=${r.numberOfTrips}  source="${r.source}"  dest="${r.destination}"  createdAt=${r.createdAt?.toISOString()}`);
  });

  // Also check: tripAmount=0 AND rentalAmount=0 (completely empty money records)
  const empty = await VehicleTrip.find({
    tripAmount:    0,
    rentalAmount:  0,
    numberOfTrips: { $gt: 1 },
  }).countDocuments();

  console.log(`\nOf those, fully zero-amount (tripAmount=0 AND rentalAmount=0): ${empty}`);

  mongoose.disconnect();
});
