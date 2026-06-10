require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const StockTransaction = require('./models/StockTransaction');
  const Material = require('./models/Material');

  // Show all IN transactions with their isDeleted status
  const all = await StockTransaction.find({ type: 'IN' }).lean();
  console.log('--- All Stock IN transactions ---');
  console.log('Total count:', all.length);
  all.forEach(t => {
    console.log(
      ' - id:', t._id,
      '| qty:', t.quantity,
      '| totalAmount:', t.totalAmount,
      '| isDeleted:', t.isDeleted,
      '| date:', t.date?.toISOString().split('T')[0]
    );
  });

  // Show current material stocks
  const materials = await Material.find({ isActive: true }).lean();
  console.log('\n--- Current Material Stocks ---');
  materials.forEach(m => console.log(' -', m.name, '| currentStock:', m.currentStock));

  mongoose.disconnect();
});
