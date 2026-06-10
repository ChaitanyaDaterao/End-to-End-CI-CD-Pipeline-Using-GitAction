const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Pokland = require('../models/Pokland');
const PoklandEntry = require('../models/PoklandEntry');
const PoklandOperator = require('../models/PoklandOperator');
const PoklandOperatorWeek = require('../models/PoklandOperatorWeek');
const PoklandPayment = require('../models/PoklandPayment');
const { protect } = require('../middleware/auth');

router.use(protect);

const getWeekStart = (date) => {
  const d = new Date(date); const day = d.getDay();
  const diff = day===0?-6:1-day; d.setDate(d.getDate()+diff); d.setHours(0,0,0,0); return d;
};
const getWeekEnd = (date) => {
  const s = getWeekStart(date); const e = new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e;
};

// ── SUMMARY (must be before /:id routes) ──
router.get('/summary/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());
    const poklands  = await Pokland.find({ isActive: true });
    const summary   = await Promise.all(poklands.map(async (p) => {
      const entries = await PoklandEntry.find({ pokland: p._id, date: { $gte: weekStart, $lte: weekEnd } });
      const totalAmount = entries.reduce((s,e)=>s+(e.totalAmount||0),0);
      let operatorCost = 0;
      if (p.ownershipType === 'Own') {
        const opWeeks = await PoklandOperatorWeek.find({ pokland: p._id, weekStart });
        operatorCost = opWeeks.filter(w=>w.cameAtAll).reduce((s,w)=>s+(w.weeklyAmount||0),0);
      }
      return { pokland:p, entries:entries.length, totalAmount, operatorCost, netAmount:totalAmount-operatorCost };
    }));
    res.json({ weekStart, weekEnd, summary });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENT ENDPOINTS ──

router.post('/payment', async (req, res) => {
  try {
    const { poklandId, weekStart, paymentFor, totalBill, amountPaid, isPaid, isPartial, note } = req.body;
    if (!poklandId) return res.status(400).json({ message: 'poklandId required' });
    if (!weekStart) return res.status(400).json({ message: 'weekStart required' });
    if (!paymentFor) return res.status(400).json({ message: 'paymentFor required' });

    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const paid = Number(amountPaid) || 0;

    let rec = await PoklandPayment.findOne({ pokland: poklandId, weekStart: wStart, paymentFor });
    if (rec) {
      Object.assign(rec, { totalBill:Number(totalBill)||0, amountPaid:paid, isPaid:Boolean(isPaid), isPartial:Boolean(isPartial), note:note||'', paidDate:new Date() });
      await rec.save();
    } else {
      rec = await PoklandPayment.create({
        pokland: new mongoose.Types.ObjectId(poklandId),
        weekStart: wStart, paymentFor,
        totalBill: Number(totalBill)||0, amountPaid: paid,
        isPaid: Boolean(isPaid), isPartial: Boolean(isPartial),
        note: note||'', paidDate: new Date(),
      });
    }
    res.json(rec);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get('/payment', async (req, res) => {
  try {
    const { poklandId, weekStart, paymentFor } = req.query;
    if (!poklandId || !weekStart || !paymentFor) return res.json(null);
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const rec = await PoklandPayment.findOne({ pokland: poklandId, weekStart: wStart, paymentFor });
    res.json(rec || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/payment/:poklandId', async (req, res) => {
  try {
    const { weekStart, paymentFor } = req.query;
    if (!weekStart || !paymentFor) return res.json(null);
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const rec = await PoklandPayment.findOne({ pokland: req.params.poklandId, weekStart: wStart, paymentFor });
    res.json(rec || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POKLAND CRUD ──
router.get('/', async (req, res) => {
  try { res.json(await Pokland.find({ isActive:true }).sort({ ownershipType:1, name:1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Pokland.create(req.body)); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await Pokland.findByIdAndUpdate(req.params.id, req.body, { new:true })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await Pokland.findByIdAndUpdate(req.params.id, { isActive:false }); res.json({ message:'Removed' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ENTRIES ──

// GET entries for a custom date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/:id/entries-range', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: 'from and to dates are required' });
    const fromDate = new Date(from); fromDate.setHours(0, 0, 0, 0);
    const toDate   = new Date(to);   toDate.setHours(23, 59, 59, 999);
    const entries  = await PoklandEntry.find({
      pokland: req.params.id,
      date: { $gte: fromDate, $lte: toDate },
    }).sort({ date: 1 });
    res.json(entries);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/:id/entry', async (req, res) => {
  try {
    const pokland = await Pokland.findById(req.params.id);
    if (!pokland) return res.status(404).json({ message:'Not found' });
    const { date, entryType, numberOfTrips, pricePerTrip, hoursUsed, hourlyRate, dailyCharge, brassQuantity, brassRate, dieselCost, maintenanceCost, note } = req.body;
    let totalAmount = 0;
    if (entryType==='Trip')   totalAmount = (Number(numberOfTrips)||0)*(Number(pricePerTrip)||0);
    if (entryType==='Hourly') totalAmount = (Number(hoursUsed)||0)*(Number(hourlyRate)||0);
    if (entryType==='Daily')  totalAmount = Number(dailyCharge)||0;
    if (entryType==='Brass')  totalAmount = (Number(brassQuantity)||0)*(Number(brassRate)||0);

    const diesel      = Number(dieselCost)      || 0;
    const maintenance = Number(maintenanceCost) || 0;
    const totalDeductions = diesel + maintenance;

    const entry = await PoklandEntry.create({
      pokland:pokland._id, date:date||Date.now(), entryType,
      numberOfTrips:Number(numberOfTrips)||0, pricePerTrip:Number(pricePerTrip)||0,
      hoursUsed:Number(hoursUsed)||0, hourlyRate:Number(hourlyRate)||0,
      dailyCharge:Number(dailyCharge)||0, brassQuantity:Number(brassQuantity)||0,
      brassRate:Number(brassRate)||0, totalAmount,
      dieselCost: diesel, maintenanceCost: maintenance,
      note:note||'',
    });

    // --- AUTO-UPDATE OWNER RECEIVABLE FOR P&L ---
    const weekStart = getWeekStart(entry.date);
    const paymentFor = pokland.ownershipType === 'Rental' ? 'rental' : 'owner';
    await PoklandPayment.findOneAndUpdate(
        { pokland: pokland._id, weekStart, paymentFor },
        {
          $inc: { totalBill: totalAmount },
          $setOnInsert: { amountPaid: 0, isPaid: false }
        },
        { upsert: true }
    );

    // --- DEDUCT diesel + maintenance from payable ---
    if (totalDeductions > 0) {
      await PoklandPayment.findOneAndUpdate(
          { pokland: pokland._id, weekStart, paymentFor },
          {
            $inc: {
              totalBill:            -totalDeductions,
              dieselDeduction:      diesel,
              maintenanceDeduction: maintenance,
            }
          },
          { upsert: true }
      );
    }

    res.status(201).json(entry);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/entry/:id', async (req, res) => {
  try {
    const entry = await PoklandEntry.findById(req.params.id).populate('pokland');
    if (entry) {
      const weekStart  = getWeekStart(entry.date);
      const paymentFor = entry.pokland?.ownershipType === 'Rental' ? 'rental' : 'owner';
      const diesel      = entry.dieselCost      || 0;
      const maintenance = entry.maintenanceCost || 0;
      const totalDeductions = diesel + maintenance;

      // Reverse the gross bill increment
      await PoklandPayment.findOneAndUpdate(
          { pokland: entry.pokland, weekStart, paymentFor },
          { $inc: { totalBill: -entry.totalAmount } }
      );
      // Reverse the deductions (add back)
      if (totalDeductions > 0) {
        await PoklandPayment.findOneAndUpdate(
            { pokland: entry.pokland._id, weekStart, paymentFor },
            {
              $inc: {
                totalBill:            totalDeductions,
                dieselDeduction:      -diesel,
                maintenanceDeduction: -maintenance,
              }
            }
        );
      }
      await PoklandEntry.findByIdAndDelete(req.params.id);
    }
    res.json({ message:'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── OPERATORS ──
router.get('/:id/operators', async (req, res) => {
  try { res.json(await PoklandOperator.find({ pokland:req.params.id, isActive:true })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/:id/operators', async (req, res) => {
  try { res.status(201).json(await PoklandOperator.create({ pokland:req.params.id, ...req.body })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/operators/:id', async (req, res) => {
  try { await PoklandOperator.findByIdAndUpdate(req.params.id, { isActive:false }); res.json({ message:'Removed' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// ── OPERATOR WEEK ──
router.post('/operator-week', async (req, res) => {
  try {
    const { poklandId, operatorId, date, weeklyAmount, markPresent, isPaid, note } = req.body;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    let week = await PoklandOperatorWeek.findOne({ pokland:poklandId, operator:operatorId, weekStart });

    const oldAmount = week ? (week.cameAtAll ? week.weeklyAmount : 0) : 0;

    if (!week) {
      week = new PoklandOperatorWeek({ pokland:poklandId, operator:operatorId, weekStart, weeklyAmount:Number(weeklyAmount)||0, daysPresent:[], cameAtAll:false, isPaid:false });
    }
    if (weeklyAmount!==undefined) week.weeklyAmount = Number(weeklyAmount)||0;
    if (isPaid!==undefined) week.isPaid = Boolean(isPaid);
    if (note!==undefined) week.note = note;
    if (markPresent && date) {
      const d = new Date(date); d.setHours(0,0,0,0);
      const already = week.daysPresent.some(p=>new Date(p).toDateString()===d.toDateString());
      if (!already) week.daysPresent.push(d);
      week.cameAtAll = week.daysPresent.length > 0;
    }
    await week.save();

    // --- AUTO-UPDATE OPERATOR WAGES PAYABLE FOR P&L ---
    const newAmount = week.cameAtAll ? week.weeklyAmount : 0;
    const diff = newAmount - oldAmount;

    if (diff !== 0) {
      await PoklandPayment.findOneAndUpdate(
          { pokland: poklandId, weekStart, paymentFor: 'operator' },
          {
            $inc: { totalBill: diff },
            $setOnInsert: { amountPaid: 0, isPaid: false }
          },
          { upsert: true }
      );
    }

    res.json(week);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get('/operator-week/:poklandId', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weeks = await PoklandOperatorWeek.find({ pokland:req.params.poklandId, weekStart }).populate('operator');
    res.json(weeks);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/operator-week/:weekId', async (req, res) => {
  try {
    const week = await PoklandOperatorWeek.findById(req.params.weekId);
    if (week && week.cameAtAll) {
      await PoklandPayment.findOneAndUpdate(
          { pokland: week.pokland, weekStart: week.weekStart, paymentFor: 'operator' },
          { $inc: { totalBill: -week.weeklyAmount } }
      );
    }
    await PoklandOperatorWeek.findByIdAndDelete(req.params.weekId);
    res.json({ message: 'Removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ALL PAYMENTS for a pokland (for history view) ──
router.get('/:id/payments', async (req, res) => {
  try {
    const payments = await PoklandPayment.find({ pokland: req.params.id }).sort({ weekStart: -1 }).lean();
    res.json(payments);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── WEEKLY BILL ──
router.get('/:id/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());
    const pokland   = await Pokland.findById(req.params.id);
    if (!pokland) return res.status(404).json({ message:'Not found' });

    const entries = await PoklandEntry.find({ pokland:pokland._id, date:{ $gte:weekStart, $lte:weekEnd } }).sort({ date:1 });
    const totalAmount      = entries.reduce((s,e)=>s+(e.totalAmount||0),0);
    const totalDiesel      = entries.reduce((s,e)=>s+(e.dieselCost||0),0);
    const totalMaintenance = entries.reduce((s,e)=>s+(e.maintenanceCost||0),0);
    const totalDeductions  = totalDiesel + totalMaintenance;

    let operatorWeeks = [], totalOperatorCost = 0, netAmount = totalAmount;
    if (pokland.ownershipType === 'Own') {
      operatorWeeks = await PoklandOperatorWeek.find({ pokland:pokland._id, weekStart }).populate('operator');
      totalOperatorCost = operatorWeeks.filter(w=>w.cameAtAll).reduce((s,w)=>s+(w.weeklyAmount||0),0);
      netAmount = totalAmount - totalOperatorCost - totalDeductions;
    }

    const rentalNetAmount = pokland.ownershipType === 'Rental'
        ? totalAmount - totalDeductions
        : null;

    // CARRY-FORWARD: sum all entries before this week, subtract all payments recorded before this week
    const paymentFor = pokland.ownershipType === 'Rental' ? 'rental' : 'owner';

    // Get the Monday start of the week BEFORE this one (i.e., anything strictly before weekStart)
    const [prevEntries, prevPayments] = await Promise.all([
      PoklandEntry.find({ pokland: pokland._id, date: { $lt: weekStart } }).lean(),
      PoklandPayment.find({ pokland: pokland._id, paymentFor, weekStart: { $lt: weekStart } }).lean(),
    ]);

    const prevEarned = prevEntries.reduce((s, e) => {
      const gross = Number(e.totalAmount) || 0;
      const deductions = (Number(e.dieselCost) || 0) + (Number(e.maintenanceCost) || 0);
      return s + Math.max(0, gross - deductions);
    }, 0);
    const prevPaid = prevPayments.reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
    const prevOutstanding = Math.max(0, prevEarned - prevPaid);

    const thisWeekNet = rentalNetAmount !== null ? rentalNetAmount : netAmount;
    const totalDue    = thisWeekNet + prevOutstanding;

    const byType = {};
    entries.forEach(e => { if(!byType[e.entryType]) byType[e.entryType]=[]; byType[e.entryType].push(e); });

    res.json({
      pokland, weekStart, weekEnd, entries, byType,
      totalAmount, totalDiesel, totalMaintenance, totalDeductions,
      totalOperatorCost, netAmount, rentalNetAmount,
      prevOutstanding, totalDue,
      operatorWeeks, totalTrips:entries.reduce((s,e)=>s+(e.numberOfTrips||0),0),
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── OPERATOR BILL ──
router.get('/:id/operator-bill', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());
    const pokland   = await Pokland.findById(req.params.id);
    if (!pokland) return res.status(404).json({ message:'Not found' });
    const operatorWeeks = await PoklandOperatorWeek.find({ pokland:pokland._id, weekStart }).populate('operator');
    const totalOperatorCost = operatorWeeks.filter(w=>w.cameAtAll).reduce((s,w)=>s+(w.weeklyAmount||0),0);
    res.json({ pokland, weekStart, weekEnd, operatorWeeks, totalOperatorCost });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENT via URL id ──

router.post('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor, totalBill, amountPaid, isPaid, isPartial, note } = req.body;
    if (!weekStart || !paymentFor) return res.status(400).json({ message: 'weekStart and paymentFor required' });

    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const paid = Number(amountPaid) || 0;

    let rec = await PoklandPayment.findOne({ pokland: req.params.id, weekStart: wStart, paymentFor });
    if (rec) {
      Object.assign(rec, { totalBill:Number(totalBill)||0, amountPaid:paid, isPaid:Boolean(isPaid), isPartial:Boolean(isPartial), note:note||'', paidDate:new Date() });
      await rec.save();
    } else {
      rec = await PoklandPayment.create({
        pokland: new mongoose.Types.ObjectId(req.params.id),
        weekStart: wStart, paymentFor,
        totalBill: Number(totalBill)||0, amountPaid: paid,
        isPaid: Boolean(isPaid), isPartial: Boolean(isPartial),
        note: note||'', paidDate: new Date(),
      });
    }
    res.json(rec);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor } = req.query;
    if (!weekStart || !paymentFor) return res.json(null);
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const rec = await PoklandPayment.findOne({ pokland: req.params.id, weekStart: wStart, paymentFor });
    res.json(rec || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;