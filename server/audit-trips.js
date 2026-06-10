const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bms';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  console.log(`Week: ${mon.toDateString()} → ${sun.toDateString()}\n`);

  // ── 1. Billing trips per vehicle (from customerdeliveries) ───────────────
  const deliveries = await mongoose.connection.db
    .collection('customerdeliveries')
    .find({ date: { $gte: mon, $lte: sun } })
    .toArray();

  const billingMap = {}; // vehicleId -> trips
  for (const del of deliveries) {
    for (const v of (del.vehicles || [])) {
      const vid = String(v.vehicle || '');
      if (!vid) continue;
      billingMap[vid] = (billingMap[vid] || 0) + (Number(v.numberOfTrips) || 0);
    }
  }

  // ── 2. VehicleTrip trips per vehicle ────────────────────────────────────
  const vtrips = await mongoose.connection.db
    .collection('vehicletrips')
    .find({ tripDate: { $gte: mon, $lte: sun } })
    .toArray();

  const vtripMap = {}; // vehicleId -> trips
  for (const vt of vtrips) {
    const vid = String(vt.vehicle || '');
    if (!vid) continue;
    vtripMap[vid] = (vtripMap[vid] || 0) + (Number(vt.numberOfTrips) || 0);
  }

  // ── 3. Vehicle lookup ────────────────────────────────────────────────────
  const allIds = [...new Set([...Object.keys(billingMap), ...Object.keys(vtripMap)])]
    .filter(Boolean)
    .map(id => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } })
    .filter(Boolean);

  const vehicles = await mongoose.connection.db
    .collection('vehicles')
    .find({ _id: { $in: allIds } })
    .toArray();

  const vehLookup = {};
  for (const v of vehicles) vehLookup[String(v._id)] = v.vehicleNumber || v.name || String(v._id);

  // ── 4. Compare ───────────────────────────────────────────────────────────
  const allVids = [...new Set([...Object.keys(billingMap), ...Object.keys(vtripMap)])];

  let hasDiscrepancy = false;
  console.log('━━━ Comparison: Billing vs VehicleTrips ━━━');
  console.log(`${'Vehicle'.padEnd(22)} ${'Billing'.padStart(8)} ${'VTrips'.padStart(8)} ${'Diff'.padStart(8)}`);
  console.log('─'.repeat(50));

  for (const vid of allVids) {
    const name    = vehLookup[vid] || vid;
    const billing = billingMap[vid] || 0;
    const vtrip   = vtripMap[vid]   || 0;
    const diff    = billing - vtrip;
    const flag    = diff !== 0 ? '  ⚠️' : '';
    if (diff !== 0) hasDiscrepancy = true;
    console.log(`${String(name).padEnd(22)} ${String(billing).padStart(8)} ${String(vtrip).padStart(8)} ${String(diff > 0 ? '+'+diff : diff).padStart(8)}${flag}`);
  }

  console.log('─'.repeat(50));
  const totalBilling = Object.values(billingMap).reduce((s, v) => s + v, 0);
  const totalVtrips  = Object.values(vtripMap).reduce((s, v) => s + v, 0);
  const totalDiff    = totalBilling - totalVtrips;
  console.log(`${'TOTAL'.padEnd(22)} ${String(totalBilling).padStart(8)} ${String(totalVtrips).padStart(8)} ${String(totalDiff > 0 ? '+'+totalDiff : totalDiff).padStart(8)}`);

  if (!hasDiscrepancy) {
    console.log('\n✅ Billing and VehicleTrips match perfectly.');
  } else {
    console.log('\n⚠️  Discrepancies found. Run fix-trips.js to sync VehicleTrips from billing.');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
