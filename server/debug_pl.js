require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const VehicleExpense  = require('./models/VehicleExpense');
  const Vehicle         = require('./models/Vehicle');
  const RentalPayment   = require('./models/RentalPayment');
  const PoklandPayment  = require('./models/PoklandPayment');
  const PoklandEntry    = require('./models/PoklandEntry');
  const Pokland         = require('./models/Pokland');

  const vehicles  = await Vehicle.find({}).lean();
  const poklands  = await Pokland.find({}).lean();

  console.log('--- Vehicles (all) ---');
  vehicles.forEach(v => console.log(' -', v.vehicleNumber, '| type:', v.ownershipType, '| isActive:', v.isActive));

  console.log('\n--- Poklands (all) ---');
  poklands.forEach(p => console.log(' -', p.name, '| type:', p.ownershipType, '| isActive:', p.isActive));

  const activeOwnVehicleIds = vehicles.filter(v => v.ownershipType === 'Own' && v.isActive === true).map(v => v._id);
  const ownPoklandIds       = poklands.filter(p => p.ownershipType === 'Own' && p.isActive === true).map(p => p._id);

  console.log('\n--- VehicleExpense records ---');
  const ve = await VehicleExpense.find({}).lean();
  ve.forEach(e => {
    const v = vehicles.find(v => v._id.toString() === e.vehicle?.toString());
    const isActive = activeOwnVehicleIds.map(id => id.toString()).includes(e.vehicle?.toString());
    console.log(' -', e.expenseType, '₹'+e.amount, '| vehicle:', v?.vehicleNumber||'UNKNOWN', '| activeOwn:', isActive, '| date:', e.date?.toISOString().split('T')[0]);
  });

  console.log('\n--- RentalPayment records ---');
  const rp = await RentalPayment.find({}).lean();
  rp.forEach(p => console.log(' - ownerName:', p.ownerName, '| amountPaid:', p.amountPaid, '| weekStart:', p.weekStart?.toISOString().split('T')[0]));

  console.log('\n--- PoklandPayment records ---');
  const pp = await PoklandPayment.find({}).lean();
  pp.forEach(p => {
    const pk = poklands.find(pk => pk._id.toString() === p.pokland?.toString());
    console.log(' - paymentFor:', p.paymentFor, '| amountPaid:', p.amountPaid, '| pokland:', pk?.name||'UNKNOWN', '| poklandActive:', pk?.isActive, '| weekStart:', p.weekStart?.toISOString().split('T')[0]);
  });

  console.log('\n--- PoklandEntry (Trip) records ---');
  const pe = await PoklandEntry.find({ entryType: 'Trip' }).lean();
  pe.forEach(e => {
    const pk = poklands.find(pk => pk._id.toString() === e.pokland?.toString());
    const isActive = ownPoklandIds.map(id => id.toString()).includes(e.pokland?.toString());
    console.log(' - trips:', e.numberOfTrips, '| totalAmount:', e.totalAmount, '| pokland:', pk?.name||'UNKNOWN', '| ownActive:', isActive, '| date:', e.date?.toISOString().split('T')[0]);
  });

  mongoose.disconnect();
});
