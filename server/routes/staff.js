const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const StaffAttendance = require('../models/StaffAttendance');
const StaffAdvance = require('../models/StaffAdvance');
const Vehicle = require('../models/Vehicle');
const { protect } = require('../middleware/auth');

router.use(protect);

const DRIVER_WEEKLY_ALLOWANCE = 1000;

// Parse a date value as LOCAL midnight so getDay() is correct in IST.
// new Date('2026-05-31') parses as UTC midnight = 2026-05-30T18:30 IST -> getDay()=Sat, WRONG.
// Splitting and using new Date(y, m-1, d) gives local midnight -> getDay()=Sun, correct.
const parseLocalDate = (date) => {
  if (!date) return new Date();
  const str = (date instanceof Date) ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d); // local midnight
};
const getWeekStart = (date) => {
  const d = parseLocalDate(date || new Date());
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
};
const getWeekEnd = (date) => {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23,59,59,999);
  return end;
};

// GET all staff
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;
    const filter = { isActive: true };
    if (role) filter.role = role;
    const staff = await Staff.find(filter).sort({ name: 1 });
    res.json(staff);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly summary for all staff
router.get('/summary/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());
    const StaffPayment = require('../models/StaffPayment');

    const allStaff = await Staff.find({ isActive: true });
    const summary = await Promise.all(allStaff.map(async (s) => {
      const attendance    = await StaffAttendance.find({ staff: s._id, date: { $gte: weekStart, $lte: weekEnd } });
      const advances      = await StaffAdvance.find({ staff: s._id, weekStart });
      const paymentRecord = await StaffPayment.findOne({ staff: s._id, weekStart });

      const overrideRecord = attendance.find(a => a.note === 'Summary override');
      const realAttendance = attendance.filter(a => a.note !== 'Summary override');

      let grossPay = 0, totalTrips = 0, daysWorked = 0;

      if (s.role === 'Driver') {
        if (overrideRecord && overrideRecord.numberOfTrips >= 0) {
          // Manual override — use staff's current rate
          totalTrips = overrideRecord.numberOfTrips;
          grossPay   = (totalTrips * s.ratePerTrip) + DRIVER_WEEKLY_ALLOWANCE;
        } else {
          totalTrips = realAttendance.reduce((sum, a) => sum + (a.numberOfTrips || 0), 0);
          // Use earnedAmount locked at billing time; fall back for older records with earnedAmount=0
          const billedEarnings = realAttendance.reduce((sum, a) => {
            if (a.earnedAmount > 0) return sum + a.earnedAmount;
            return sum + ((a.numberOfTrips || 0) * (a.ratePerTrip || s.ratePerTrip || 0));
          }, 0);
          grossPay = billedEarnings + DRIVER_WEEKLY_ALLOWANCE;
        }
      } else {
        // Conductor
        if (overrideRecord) {
          daysWorked = overrideRecord.numberOfTrips;
          grossPay   = daysWorked * s.dailyRate;
        } else {
          daysWorked = realAttendance.filter(a => a.present).length;
          // Use earnedAmount locked at billing time (dailyRate stored when delivery was created)
          grossPay = realAttendance
              .filter(a => a.present)
              .reduce((sum, a) => sum + (a.earnedAmount || a.dailyRate || s.dailyRate || 0), 0);
        }
      }

      const totalAdvance = advances.reduce((sum, a) => sum + a.amount, 0);
      const netPay = grossPay - totalAdvance;
      let finalNetPay = netPay;
      if (paymentRecord?.isPaid) finalNetPay = 0;
      else if (paymentRecord?.isPartial) finalNetPay = netPay - (paymentRecord.amountPaid || 0);

      return {
        staff: s, totalTrips, daysWorked, grossPay, totalAdvance, netPay, finalNetPay,
        paymentStatus: paymentRecord?.isPaid ? 'Paid' : paymentRecord?.isPartial ? 'Partial' : 'Unpaid',
      };
    }));

    res.json({ weekStart, weekEnd, summary });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST create staff
router.post('/', async (req, res) => {
  try {
    const staff = await Staff.create(req.body);
    res.status(201).json(staff);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// PUT update staff
router.put('/:id', async (req, res) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(staff);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE staff
router.delete('/:id', async (req, res) => {
  try {
    await Staff.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Staff removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST mark attendance manually (non-billing path)
router.post('/attendance', async (req, res) => {
  try {
    const { staffId, vehicleId, date, numberOfTrips, present, note } = req.body;
    const staff = await Staff.findById(staffId);
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const [y, m, d] = date.split('T')[0].split('-').map(Number);
    const attendDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));

    if (staff.role === 'Driver') {
      const trips      = Number(numberOfTrips) || 0;
      const rate       = staff.ratePerTrip ?? 200;
      const attendance = await StaffAttendance.create({
        staff:         new mongoose.Types.ObjectId(staffId),
        vehicle:       new mongoose.Types.ObjectId(vehicleId),
        date:          attendDate,
        numberOfTrips: trips,
        ratePerTrip:   rate,
        present:       true,
        earnedAmount:  trips * rate,
        note:          note || '',
      });
      return res.status(201).json(attendance);
    }

    if (staff.role === 'Conductor') {
      const condDateStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      const condDateEnd   = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
      const existing = await StaffAttendance.findOne({
        staff:   new mongoose.Types.ObjectId(staffId),
        vehicle: new mongoose.Types.ObjectId(vehicleId),
        date:    { $gte: condDateStart, $lte: condDateEnd },
      });
      if (existing) {
        existing.present      = present !== undefined ? present : true;
        existing.earnedAmount = existing.present ? (existing.dailyRate || staff.dailyRate || 450) : 0;
        existing.note         = note || '';
        await existing.save();
        return res.json(existing);
      }
      const dailyRate = staff.dailyRate ?? 450;
      const attendance = await StaffAttendance.create({
        staff:         new mongoose.Types.ObjectId(staffId),
        vehicle:       new mongoose.Types.ObjectId(vehicleId),
        date:          attendDate,
        numberOfTrips: 0,
        present:       present !== undefined ? present : true,
        dailyRate,
        earnedAmount:  dailyRate,
        note:          note || '',
      });
      return res.status(201).json(attendance);
    }

    res.status(400).json({ message: 'Unknown staff role' });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// GET attendance for a staff member
router.get('/:id/attendance', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { staff: new mongoose.Types.ObjectId(req.params.id) };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(to);
    }
    const attendance = await StaffAttendance.find(filter)
        .populate('vehicle', 'vehicleNumber vehicleType')
        .sort({ date: -1 });
    res.json(attendance);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH update attendance record
router.patch('/attendance/:id', async (req, res) => {
  try {
    const { numberOfTrips, present, note } = req.body;
    const record = await StaffAttendance.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    if (numberOfTrips !== undefined) {
      record.numberOfTrips = Number(numberOfTrips);
      // Recalculate using locked rate
      record.earnedAmount  = record.numberOfTrips * (record.ratePerTrip || 0);
    }
    if (present !== undefined) {
      record.present      = Boolean(present);
      // Conductor: earned = dailyRate if present, else 0
      if (record.dailyRate) {
        record.earnedAmount = record.present ? record.dailyRate : 0;
      }
    }
    if (note !== undefined) record.note = note;

    await record.save();

    // Clear any stale summary override for this week
    const wStart = getWeekStart(record.date);
    const wEnd   = getWeekEnd(record.date);
    await StaffAttendance.deleteMany({
      staff: record.staff,
      date:  { $gte: wStart, $lte: wEnd },
      note:  'Summary override',
    });

    res.json(record);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE attendance record
router.delete('/attendance/:id', async (req, res) => {
  try {
    const record = await StaffAttendance.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    if (record.note === 'Summary override') {
      await record.deleteOne();
      return res.json({ message: 'Attendance deleted' });
    }

    const wStart = getWeekStart(record.date);
    const wEnd   = getWeekEnd(record.date);
    await record.deleteOne();

    await StaffAttendance.deleteMany({
      staff: record.staff,
      date:  { $gte: wStart, $lte: wEnd },
      note:  'Summary override',
    });

    res.json({ message: 'Attendance deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST add advance for a staff member
router.post('/:id/advance', async (req, res) => {
  try {
    const { amount, date, note } = req.body;
    const advDate = new Date(date);
    advDate.setHours(0,0,0,0);
    const weekStart = getWeekStart(advDate);
    const advance = await StaffAdvance.create({
      staff:     new mongoose.Types.ObjectId(req.params.id),
      amount:    Number(amount),
      date:      advDate,
      note:      note || '',
      weekStart,
    });
    res.status(201).json(advance);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE advance
router.delete('/advance/:id', async (req, res) => {
  try {
    await StaffAdvance.findByIdAndDelete(req.params.id);
    res.json({ message: 'Advance deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly bill for a staff member
router.get('/:id/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());

    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const allAttendanceRaw = await StaffAttendance.find({
      staff: new mongoose.Types.ObjectId(req.params.id),
      date:  { $gte: weekStart, $lte: weekEnd },
    }).populate('vehicle', 'vehicleNumber vehicleType').sort({ date: 1 });

    const overrideRecord = allAttendanceRaw.find(a => a.note === 'Summary override');
    const realAttendance = allAttendanceRaw.filter(a => a.note !== 'Summary override');

    const advances     = await StaffAdvance.find({
      staff: new mongoose.Types.ObjectId(req.params.id),
      weekStart,
    }).sort({ date: 1 });

    const totalAdvance = advances.reduce((s, a) => s + a.amount, 0);

    let grossPay = 0, totalTrips = 0, daysWorked = 0;

    if (staff.role === 'Driver') {
      if (overrideRecord && overrideRecord.numberOfTrips >= 0) {
        // Manual override — use staff's current rate
        totalTrips = overrideRecord.numberOfTrips;
        grossPay   = (totalTrips * staff.ratePerTrip) + DRIVER_WEEKLY_ALLOWANCE;
      } else {
        totalTrips = realAttendance.reduce((s, a) => s + (a.numberOfTrips || 0), 0);
        // Sum earnedAmount locked at billing time; fall back to numberOfTrips * ratePerTrip
        // for older records that were created before earnedAmount was stored
        const billedEarnings = realAttendance.reduce((s, a) => {
          if (a.earnedAmount > 0) return s + a.earnedAmount;
          return s + ((a.numberOfTrips || 0) * (a.ratePerTrip || staff.ratePerTrip || 0));
        }, 0);
        grossPay = billedEarnings + DRIVER_WEEKLY_ALLOWANCE;
      }
    } else {
      // Conductor
      if (overrideRecord) {
        daysWorked = overrideRecord.numberOfTrips;
        grossPay   = daysWorked * staff.dailyRate;
      } else {
        daysWorked = realAttendance.filter(a => a.present).length;
        // Sum earnedAmount locked at billing time; fall back to dailyRate for older records
        grossPay = realAttendance
            .filter(a => a.present)
            .reduce((s, a) => s + (a.earnedAmount || a.dailyRate || staff.dailyRate || 0), 0);
      }
    }

    const netPay = grossPay - totalAdvance;
    const StaffPayment = require('../models/StaffPayment');
    const paymentRecord = await StaffPayment.findOne({ staff: staff._id, weekStart });

    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevPayment = await StaffPayment.findOne({ staff: staff._id, weekStart: prevWeekStart });
    let carriedForward = 0;
    if (prevPayment && !prevPayment.isPaid) {
      carriedForward = prevPayment.netPay - (prevPayment.amountPaid || 0);
      if (carriedForward < 0) carriedForward = 0;
    }

    const totalDue = netPay + carriedForward;
    let finalNetPay = totalDue;
    if (paymentRecord) {
      if (paymentRecord.isPaid) finalNetPay = 0;
      else if (paymentRecord.isPartial) finalNetPay = totalDue - (paymentRecord.amountPaid || 0);
    }

    res.json({
      staff, weekStart, weekEnd,
      attendance: realAttendance, advances,
      totalTrips, daysWorked,
      weeklyAllowance: staff.role === 'Driver' ? DRIVER_WEEKLY_ALLOWANCE : 0,
      grossPay, totalAdvance, netPay,
      carriedForward, totalDue, finalNetPay,
      paymentRecord: paymentRecord || null,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENT STATUS ────────────────────────────────────────────────────────
const StaffPayment = require('../models/StaffPayment');

// POST mark bill as paid/partial
router.post('/:id/payment', async (req, res) => {
  try {
    const { weekStart, amountPaid, isPaid, isPartial, note, grossPay, totalAdvance, netPay } = req.body;
    const wStart = new Date(weekStart);
    wStart.setHours(0,0,0,0);

    const existing = await StaffPayment.findOne({
      staff:     new mongoose.Types.ObjectId(req.params.id),
      weekStart: wStart,
    });

    if (existing) {
      existing.amountPaid = Number(amountPaid) || 0;
      existing.isPaid     = Boolean(isPaid);
      existing.isPartial  = Boolean(isPartial);
      existing.note       = note || '';
      existing.paidDate   = new Date();
      await existing.save();
      return res.json(existing);
    }

    const payment = await StaffPayment.create({
      staff:        new mongoose.Types.ObjectId(req.params.id),
      weekStart:    wStart,
      grossPay:     Number(grossPay)     || 0,
      totalAdvance: Number(totalAdvance) || 0,
      netPay:       Number(netPay)       || 0,
      amountPaid:   Number(amountPaid)   || 0,
      isPaid:       Boolean(isPaid),
      isPartial:    Boolean(isPartial),
      paidDate:     new Date(),
      note:         note || '',
    });
    res.status(201).json(payment);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// GET payment status for a week
router.get('/:id/payment', async (req, res) => {
  try {
    const { weekStart } = req.query;
    const wStart = new Date(weekStart);
    wStart.setHours(0,0,0,0);
    const payment = await StaffPayment.findOne({
      staff:     new mongoose.Types.ObjectId(req.params.id),
      weekStart: wStart,
    });
    res.json(payment || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT summary override (manual edit)
router.put('/:id/summary-override', async (req, res) => {
  try {
    const { weekStart, weekEnd, targetTotal } = req.body;
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const wEnd   = new Date(weekEnd);   wEnd.setHours(23,59,59,999);

    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const target = Number(targetTotal);

    await StaffAttendance.deleteMany({
      staff: new mongoose.Types.ObjectId(req.params.id),
      date:  { $gte: wStart, $lte: wEnd },
      note:  'Summary override',
    });

    const realRecord = await StaffAttendance.findOne({
      staff: new mongoose.Types.ObjectId(req.params.id),
      date:  { $gte: wStart, $lte: wEnd },
      note:  { $ne: 'Summary override' },
    });
    const vehicleId = realRecord?.vehicle || (await Vehicle.findOne().select('_id'))?._id;
    if (!vehicleId) return res.status(400).json({ message: 'No vehicle found to attach override record' });

    const midWeek = new Date(wStart);
    midWeek.setDate(midWeek.getDate() + 3);

    await StaffAttendance.create({
      staff:         new mongoose.Types.ObjectId(req.params.id),
      vehicle:       vehicleId,
      date:          midWeek,
      numberOfTrips: target,
      present:       true,
      note:          'Summary override',
    });

    res.json({ success: true, targetTotal: target });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;