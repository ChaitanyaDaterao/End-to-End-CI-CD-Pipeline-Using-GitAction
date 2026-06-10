/**
 * fix-conductor-attendance-final.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Targeted final fix based on diagnostic output:
 *
 *  1. DELETE bad "Summary override" records for 6017 and 0164 in week 25-31 May
 *     (these were created by the v2 script and are blocking real records)
 *
 *  2. DELETE the duplicate record causing 4298 to show 8 instead of 7
 *     (find and remove the extra, keeping the correct ones)
 *
 *  3. CREATE the missing real attendance records for 6017 and 0164
 *     using IST-midnight storage format (matching billing.js)
 *
 * Expected result after running:
 *   6017 → 6 days, 0932 → 7 days, 4298 → 7 days, 0164 → 7 days
 *
 * HOW TO RUN:
 *   node fix-conductor-attendance-final.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGO_URI not found'); process.exit(1); }

const BillingDelivery = require('./models/BillingDelivery');
const StaffAttendance = require('./models/StaffAttendance');
const Staff           = require('./models/Staff');
const Vehicle         = require('./models/Vehicle');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayWindowUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - IST_OFFSET_MS);
  const end   = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MS);
  return { start, end };
}

function istMidnightUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - IST_OFFSET_MS);
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // Known IDs from diagnostic output
  const ID = {
    '6017': new mongoose.Types.ObjectId('69e3c1806698bb66c7a615f7'),
    '0932': new mongoose.Types.ObjectId('69e3c1a36698bb66c7a615fe'),
    '4298': new mongoose.Types.ObjectId('69e3c1cb6698bb66c7a61605'),
    '0164': new mongoose.Types.ObjectId('69e3c1db6698bb66c7a6160c'),
  };

  // Week bounds (IST Mon 25 May – Sun 31 May)
  const { start: weekStart } = istDayWindowUTC('2026-05-25');
  const { end:   weekEnd   } = istDayWindowUTC('2026-05-31');

  // ── Step 1: Remove bad Summary overrides for 6017 and 0164 ───────────────
  console.log('🗑  Step 1: Removing bad Summary override records...\n');

  for (const name of ['6017', '0164']) {
    const deleted = await StaffAttendance.deleteMany({
      staff: ID[name],
      date:  { $gte: weekStart, $lte: weekEnd },
      note:  'Summary override',
    });
    console.log(`   ${name}: deleted ${deleted.deletedCount} Summary override record(s)`);
  }

  // ── Step 2: Fix 4298 duplicate — find all records in week, remove extras ──
  console.log('\n🗑  Step 2: Fixing 4298 duplicate...\n');

  const recs4298 = await StaffAttendance.find({
    staff:   ID['4298'],
    date:    { $gte: weekStart, $lte: weekEnd },
    present: true,
    note:    { $ne: 'Summary override' },
  }).populate('vehicle', 'vehicleNumber').sort({ date: 1 });

  console.log(`   4298 records in week (${recs4298.length} total):`);
  for (const r of recs4298) {
    const istDate = new Date(r.date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    console.log(`   → ${istDate} | ${r.vehicle?.vehicleNumber || r.vehicle} | _id: ${r._id}`);
  }

  // Group by IST date — if any date has 2+ records, delete all but the first
  const byDate = {};
  for (const r of recs4298) {
    const istDate = new Date(r.date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (!byDate[istDate]) byDate[istDate] = [];
    byDate[istDate].push(r);
  }

  let dupRemoved = 0;
  for (const [date, group] of Object.entries(byDate)) {
    if (group.length > 1) {
      // Keep the first, delete the rest
      for (const dup of group.slice(1)) {
        await StaffAttendance.deleteOne({ _id: dup._id });
        console.log(`   🗑  Deleted dup for 4298 on ${date} | _id: ${dup._id}`);
        dupRemoved++;
      }
    }
  }
  if (dupRemoved === 0) console.log('   No duplicates found for 4298 — may need manual check.');

  // ── Step 3: Create missing records for 6017 and 0164 from BillingDelivery ─
  console.log('\n➕ Step 3: Creating missing records for 6017 and 0164...\n');

  const allDeliveries = await BillingDelivery.find({})
      .populate('vehicles.vehicle',   'vehicleNumber ownershipType')
      .populate('vehicles.conductor', 'name dailyRate role')
      .sort({ date: 1 });

  // Build presence map for 6017 and 0164 only
  const presenceMap = {};
  for (const delivery of allDeliveries) {
    const istDate = new Date(delivery.date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

    for (const v of delivery.vehicles) {
      if (!v.conductor) continue;
      const conductor = v.conductor;
      const conductorId = String(conductor._id || conductor);

      // Only process 6017 and 0164
      if (conductorId !== String(ID['6017']) && conductorId !== String(ID['0164'])) continue;

      const vehicleId = String(v.vehicle?._id || v.vehicle);
      const dailyRate = conductor.dailyRate ?? 450;
      const key       = `${istDate}|${vehicleId}|${conductorId}`;
      if (!presenceMap[key]) presenceMap[key] = { istDate, vehicleId, conductorId, dailyRate };
    }
  }

  let created = 0;
  let skipped = 0;

  for (const entry of Object.values(presenceMap)) {
    const { istDate, vehicleId, conductorId, dailyRate } = entry;
    const { start, end } = istDayWindowUTC(istDate);

    const existing = await StaffAttendance.findOne({
      staff:   new mongoose.Types.ObjectId(conductorId),
      vehicle: new mongoose.Types.ObjectId(vehicleId),
      date:    { $gte: start, $lte: end },
      note:    { $ne: 'Summary override' },
    });

    if (existing) { skipped++; continue; }

    await StaffAttendance.create({
      staff:         new mongoose.Types.ObjectId(conductorId),
      vehicle:       new mongoose.Types.ObjectId(vehicleId),
      date:          istMidnightUTC(istDate),
      numberOfTrips: 0,
      present:       true,
      dailyRate,
      earnedAmount:  dailyRate,
      note:          '',
    });

    const name = conductorId === String(ID['6017']) ? '6017' : '0164';
    console.log(`   ➕ CREATED ${istDate} | ${name} | vehicle ${vehicleId.slice(-6)}`);
    created++;
  }

  // ── Step 4: Verify all conductors ─────────────────────────────────────────
  console.log('\n📊 Final verification — week 25/05 – 31/05/2026:\n');

  const expected = { '6017': 6, '0932': 7, '4298': 7, '0164': 7 };
  const allConductors = await Staff.find({ isActive: true, role: 'Conductor' });

  let allCorrect = true;
  for (const c of allConductors) {
    const recs = await StaffAttendance.find({
      staff:   c._id,
      date:    { $gte: weekStart, $lte: weekEnd },
      present: true,
      note:    { $ne: 'Summary override' },
    });
    const exp    = expected[c.name] || 7;
    const status = recs.length === exp ? '✅' : `❌ expected ${exp}`;
    if (recs.length !== exp) allCorrect = false;
    console.log(`   ${c.name.padEnd(20)} → ${recs.length} days  ${status}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`🗑  Duplicates removed : ${dupRemoved}`);
  console.log(`➕ Records created     : ${created}`);
  console.log(`✅ Already existed     : ${skipped}`);
  console.log('─'.repeat(60));
  if (allCorrect) {
    console.log('\n🎉 All conductors correct! Refresh the weekly summary.\n');
  } else {
    console.log('\n⚠️  Some counts still off — check the output above.\n');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error('❌ Failed:', err); process.exit(1); });
