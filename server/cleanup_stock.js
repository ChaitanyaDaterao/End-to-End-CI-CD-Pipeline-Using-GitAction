require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const StockTransaction = require('./models/StockTransaction');

  // Delete all Stock IN transactions where isDeleted is not explicitly set
  // These are old records that were never properly managed
  const result = await StockTransaction.deleteMany({
    type: 'IN',
    isDeleted: { $exists: false },  // only records with NO isDeleted field at all
  });

  console.log('✅ Deleted stale stock transactions:', result.deletedCount);

  // Verify what remains
  const remaining = await StockTransaction.find({ type: 'IN' }).lean();
  console.log('\n--- Remaining Stock IN transactions ---');
  remaining.forEach(t => console.log(
    ' - qty:', t.quantity,
    '| totalAmount:', t.totalAmount,
    '| isDeleted:', t.isDeleted,
    '| date:', t.date?.toISOString().split('T')[0]
  ));

  mongoose.disconnect();
});
