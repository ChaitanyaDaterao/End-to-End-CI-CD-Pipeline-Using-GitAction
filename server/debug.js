require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const VehicleExpense = require('./models/VehicleExpense');
  const Vehicle = require('./models/Vehicle');

  const start = new Date('2026-04-06'); start.setHours(0,0,0,0);
  const end = new Date('2026-04-12'); end.setHours(23,59,59,999);

  const vehicles = await Vehicle.find({}).lean();
  console.log('--- All Vehicles ---');
  vehicles.forEach(v => console.log(' -', v.vehicleNumber, '| type:', v.ownershipType, '| isActive:', v.isActive));

  const ve = await VehicleExpense.find({ date: { $gte: start, $lte: end } }).lean();
  console.log('\n--- VehicleExpense count:', ve.length, '| total:', ve.reduce((s,e) => s + e.amount, 0));

  for (const e of ve) {
    const v = vehicles.find(v => v._id.toString() === e.vehicle?.toString());
    console.log(' -', e.expenseType, '₹'+e.amount, '| vehicle:', v?.vehicleNumber || 'UNKNOWN', '| ownership:', v?.ownershipType || 'N/A', '| date:', e.date?.toISOString().split('T')[0]);
  }

  mongoose.disconnect();
});