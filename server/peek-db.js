require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  for (const name of ['customers', 'customerdeliveries', 'customerpayments', 'billingpaymentstatuses']) {
    const sample = await db.collection(name).findOne();
    console.log(`\n━━━ ${name} ━━━`);
    console.log(JSON.stringify(sample, null, 2));
  }

  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
