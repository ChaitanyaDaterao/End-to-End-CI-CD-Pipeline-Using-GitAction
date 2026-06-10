/**
 * check-db.js — run with: node check-db.js
 * Lists all collections and their document counts so we can find your data.
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('✅ Connected — database:', db.databaseName);

  const collections = await db.listCollections().toArray();
  console.log(`\n📦 Collections (${collections.length} total):\n`);

  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`  ${col.name.padEnd(35)} ${count} docs`);
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error('❌', err); process.exit(1); });
