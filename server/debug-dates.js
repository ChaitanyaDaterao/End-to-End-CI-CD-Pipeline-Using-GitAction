const mongoose = require('mongoose');
require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

async function main() {
  await mongoose.connect(MONGO_URI);
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  const deliveries = await mongoose.connection.db
    .collection('customerdeliveries')
    .find({ date: { $gte: mon, $lte: sun } })
    .toArray();

  // Print unique raw date values and what keys they produce
  const seen = new Set();
  for (const del of deliveries) {
    const raw = del.date;
    const iso = raw.toISOString();
    const localKey = `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}`;
    const utcKey   = iso.slice(0, 10);
    const key = seen.has(iso) ? '' : iso;
    if (!seen.has(iso)) {
      seen.add(iso);
      console.log(`raw: ${iso}  |  localKey: ${localKey}  |  utcKey: ${utcKey}`);
    }
  }

  // Also print vehicle+date combos to see why grouping fails
  console.log('\n── Vehicle+date combos in deliveries ──');
  const combos = {};
  for (const del of deliveries) {
    for (const v of (del.vehicles || [])) {
      if (!v.vehicle) continue;
      const d = del.date;
      const localKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const utcKey   = d.toISOString().slice(0,10);
      const ck = `${v.vehicle}::${localKey}`;
      combos[ck] = (combos[ck] || 0) + 1;
    }
  }
  console.log(`Unique vehicle+localDate combos: ${Object.keys(combos).length}`);
  for (const [k, count] of Object.entries(combos)) {
    if (count > 1) console.log(`  ${k}  (${count} deliveries)`);
  }

  await mongoose.disconnect();
}
main().catch(console.error);
