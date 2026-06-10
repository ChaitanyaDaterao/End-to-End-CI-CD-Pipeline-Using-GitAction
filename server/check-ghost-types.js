require('dotenv').config();
const mongoose    = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');
const Vehicle     = require('./models/Vehicle');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {

  const ghosts = await VehicleTrip.find({
    tripAmount:    0,
    numberOfTrips: { $gt: 1 },
  }).populate('vehicle', 'vehicleNumber ownershipType');

  const own    = ghosts.filter(g => g.vehicle?.ownershipType === 'Own');
  const rental = ghosts.filter(g => g.vehicle?.ownershipType === 'Rental');
  const unknown = ghosts.filter(g => !g.vehicle);

  console.log(`Total ghost records: ${ghosts.length}`);
  console.log(`  Own vehicle ghosts:    ${own.length}`);
  console.log(`  Rental vehicle ghosts: ${rental.length}`);
  console.log(`  Unknown (deleted vehicle): ${unknown.length}`);

  if (own.length > 0) {
    console.log('\nSample own vehicle ghosts:');
    own.slice(0, 5).forEach(g => {
      console.log(`  ${g.vehicle?.vehicleNumber}  date=${g.tripDate?.toISOString().slice(0,10)}  trips=${g.numberOfTrips}  dest="${g.destination}"  createdAt=${g.createdAt?.toISOString()}`);
    });
  }

  if (rental.length > 0) {
    console.log('\nSample rental vehicle ghosts:');
    rental.slice(0, 5).forEach(g => {
      console.log(`  ${g.vehicle?.vehicleNumber}  date=${g.tripDate?.toISOString().slice(0,10)}  trips=${g.numberOfTrips}  dest="${g.destination}"  createdAt=${g.createdAt?.toISOString()}`);
    });
  }

  mongoose.disconnect();
});
