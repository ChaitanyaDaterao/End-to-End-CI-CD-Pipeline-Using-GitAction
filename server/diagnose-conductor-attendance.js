/**
 * diagnose-conductor-attendance.js
 * Prints every StaffAttendance record for conductors in May-June 2026,
 * showing exact stored dates so we can see what the week query misses.
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGO_URI not found'); process.exit(1); }

const StaffAttendance = require('./models/StaffAttendance');
const Staff           = require('./models/Staff');
const Vehicle         = require('./models/Vehicle');

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const conductors = await Staff.find({ isActive: true, role: 'Conductor' });
  console.log(`Found ${conductors.length} conductors\n`);

  // What the fixed staff.js queries for week of 25/05
  const weekStart = new Date(2026, 4, 25,  0,  0,  0,   0); // local Mon midnight
  const weekEnd   = new Date(2026, 4, 31, 23, 59, 59, 999); // local Sun end
  console.log(`Week query window (local): ${weekStart.toISOString()} → ${weekEnd.toISOString()}\n`);

  for (const c of conductors) {
    // Get ALL records in a wide window around that week
    const allRecs = await StaffAttendance.find({
      staff:   c._id,
      date:    {
        $gte: new Date(2026, 4, 24),  // start from Sun 24 May to catch anything shifted
        $lte: new Date(2026, 5,  2, 23, 59, 59), // end Mon 2 Jun
      },
      note:    { $ne: 'Summary override' },
    }).populate('vehicle', 'vehicleNumber').sort({ date: 1 });

    console.log(`── ${c.name} (${c._id}) ──────────────────────────`);
    console.log(`   Total records in wide window: ${allRecs.length}`);

    let inWindow = 0;
    for (const r of allRecs) {
      const inWeek = r.date >= weekStart && r.date <= weekEnd;
      if (inWeek) inWindow++;
      console.log(
        `   ${inWeek ? '✅ IN ' : '❌ OUT'} | stored: ${r.date.toISOString()}` +
        ` | local: ${r.date.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'2-digit'})}` +
        ` | vehicle: ${r.vehicle?.vehicleNumber || r.vehicle}` +
        ` | present: ${r.present} | earned: ₹${r.earnedAmount}`
      );
    }
    console.log(`   → IN window: ${inWindow}  OUT of window: ${allRecs.length - inWindow}\n`);
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error('❌', err); process.exit(1); });
