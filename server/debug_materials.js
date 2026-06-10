require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const StockTransaction = require('./models/StockTransaction');
  const Material = require('./models/Material');

  // Current month
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const txs = await StockTransaction.find({
    date:      { $gte: start, $lte: end },
    type:      'IN',
  }).lean();

  const materials = await Material.find({}).lean();
  const matMap = {};
  materials.forEach(m => matMap[m._id.toString()] = m.name);

  console.log('--- Stock IN transactions this month ---');
  console.log('Count:', txs.length);
  let total = 0;
  txs.forEach(t => {
    const name = matMap[t.material?.toString()] || 'UNKNOWN';
    const amt  = Number(t.totalAmount || t.amount) || 0;
    total += amt;
    console.log(
      ' -', name,
      '| qty:', t.quantity,
      '| price/unit:', t.pricePerUnit,
      '| totalAmount:', t.totalAmount,
      '| amount:', t.amount,
      '| isDeleted:', t.isDeleted,
      '| date:', t.date?.toISOString().split('T')[0]
    );
  });
  console.log('Total counted:', total);

  mongoose.disconnect();
});
