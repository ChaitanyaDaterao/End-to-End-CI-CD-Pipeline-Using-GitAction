require('dotenv').config();
const mongoose    = require('mongoose');
const VehicleTrip = require('./models/VehicleTrip');

mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI).then(async () => {
  const dups = await VehicleTrip.aggregate([
    { $group: {
        _id:   { vehicle: '$vehicle', date: { $dateToString: { format: '%Y-%m-%d', date: '$tripDate' } } },
        count: { $sum: 1 },
        ids:   { $push: '$_id' }
    }},
    { $match: { count: { $gt: 1 } } },
    { $sort:  { count: -1 } }
  ]);

  console.log('Duplicate groups:', dups.length);
  dups.slice(0, 10).forEach(d => console.log(d));
  mongoose.disconnect();
});
