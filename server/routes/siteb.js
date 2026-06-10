const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const SiteB        = require('../models/SiteB');
const SiteBOrder   = require('../models/SiteBOrder');
const SiteBPayment = require('../models/SiteBPayment');
const Vehicle      = require('../models/Vehicle');
const VehicleRentalRate = require('../models/VehicleRentalRate');
const VehicleTrip      = require('../models/VehicleTrip');
const Staff        = require('../models/Staff');
const StaffAttendance = require('../models/StaffAttendance');
const { protect }  = require('../middleware/auth');

router.use(protect);

// ── Week helpers ──────────────────────────────────────────────────────────────
const getWeekStart = (date) => {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0,0,0,0); return d;
};
const getWeekEnd = (date) => {
  const s = getWeekStart(date); const e = new Date(s);
  e.setDate(s.getDate() + 6); e.setHours(23,59,59,999); return e;
};
const getPrevWeekStart = (weekStart) => {
  const d = new Date(weekStart);
  d.setDate(d.getDate() - 7);
  d.setHours(0,0,0,0); return d;
};

// ── Helper: compute carry-forward balance for a site + paymentFor ─────────────
// Returns the unpaid balance from the PREVIOUS week (or 0 if fully paid)
const getCarryForward = async (siteBId, weekStart, paymentFor) => {
  const prevWeekStart = getPrevWeekStart(weekStart);
  const prevPay = await SiteBPayment.findOne({
    siteB: siteBId,
    weekStart: prevWeekStart,
    paymentFor,
  });
  if (!prevPay) return 0;
  const balance = (prevPay.totalBill || 0) - (prevPay.amountPaid || 0);
  return balance > 0 ? balance : 0;
};

// ── Helper: recalculate and upsert payment record for a week ─────────────────
// Gathers all orders for the week, sums totals, adds carry-forward, and upserts.
const upsertWeeklyPayment = async (siteBId, weekStart, paymentFor, delta = null) => {
  const weekEnd = getWeekEnd(weekStart);
  const orders  = await SiteBOrder.find({
    siteB: siteBId,
    date:  { $gte: weekStart, $lte: weekEnd },
  });

  const totalTrips         = orders.reduce((s,o) => s + (o.numberOfTrips     || 0), 0);
  const totalBrass         = orders.reduce((s,o) => s + (o.totalBrass        || 0), 0);
  const totalRoyaltyCount  = orders.reduce((s,o) => s + (o.royaltyCount      || 0), 0);
  const totalRoyaltyAmount = orders.reduce((s,o) => s + (o.royaltyAmount     || 0), 0);

  let currentWeekBill = 0;
  if (paymentFor === 'customer') {
    currentWeekBill = orders.reduce((s,o) => s + (o.amountForCustomer || 0), 0);
  } else {
    currentWeekBill = orders.reduce((s,o) => s + (o.amountForOwner    || 0), 0);
  }

  const carryForward = await getCarryForward(siteBId, weekStart, paymentFor);
  const totalBill    = currentWeekBill + carryForward;

  // Get existing record to preserve amountPaid / status fields
  let rec = await SiteBPayment.findOne({ siteB: siteBId, weekStart, paymentFor });
  if (rec) {
    rec.currentWeekBill   = currentWeekBill;
    rec.carryForward      = carryForward;
    rec.totalBill         = totalBill;
    rec.totalTrips        = totalTrips;
    rec.totalBrass        = totalBrass;
    rec.totalRoyaltyCount = totalRoyaltyCount;
    rec.totalRoyaltyAmount= totalRoyaltyAmount;
    await rec.save();
  } else {
    rec = await SiteBPayment.create({
      siteB:             siteBId,
      weekStart,
      paymentFor,
      currentWeekBill,
      carryForward,
      totalBill,
      totalTrips,
      totalBrass,
      totalRoyaltyCount,
      totalRoyaltyAmount,
      amountPaid: 0,
      isPaid:     false,
    });
  }
  return rec;
};

// ── GET form data (vehicles + staff) ─────────────────────────────────────────
router.get('/form-data', async (req, res) => {
  try {
    const [vehicles, drivers, conductors] = await Promise.all([
      Vehicle.find({ isActive: true }).sort({ ownershipType: 1, vehicleNumber: 1 }),
      Staff.find({ isActive: true, role: 'Driver' }).sort({ name: 1 }),
      Staff.find({ isActive: true, role: 'Conductor' }).sort({ name: 1 }),
    ]);
    res.json({ vehicles, drivers, conductors });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── WEEKLY SUMMARY (all sites) ────────────────────────────────────────────────
router.get('/summary/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());

    const sites = await SiteB.find({ isActive: true });
    const summary = await Promise.all(sites.map(async (site) => {
      const orders = await SiteBOrder.find({ siteB: site._id, date: { $gte: weekStart, $lte: weekEnd } });

      const totalTrips          = orders.reduce((s,o) => s + (o.numberOfTrips     || 0), 0);
      const totalBrass          = orders.reduce((s,o) => s + (o.totalBrass        || 0), 0);
      const totalRoyaltyCount   = orders.reduce((s,o) => s + (o.royaltyCount      || 0), 0);
      const totalRoyaltyAmount  = orders.reduce((s,o) => s + (o.royaltyAmount     || 0), 0);
      const totalAmountOwner    = orders.reduce((s,o) => s + (o.amountForOwner    || 0), 0);
      const totalAmountCustomer = orders.reduce((s,o) => s + (o.amountForCustomer || 0), 0);

      const [ownerPay, customerPay] = await Promise.all([
        SiteBPayment.findOne({ siteB: site._id, weekStart, paymentFor: 'owner' }),
        SiteBPayment.findOne({ siteB: site._id, weekStart, paymentFor: 'customer' }),
      ]);

      return {
        site,
        totalTrips, totalBrass,
        totalRoyaltyCount, totalRoyaltyAmount,
        totalAmountOwner, totalAmountCustomer,
        ownerPay, customerPay,
      };
    }));

    res.json({ weekStart, weekEnd, summary });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── P&L DATA endpoint ─────────────────────────────────────────────────────────
router.get('/pl/income', async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = new Date(from); start.setHours(0,0,0,0);
    const end   = new Date(to);   end.setHours(23,59,59,999);

    const payments = await SiteBPayment.find({
      paymentFor: 'customer',
      weekStart: { $gte: start, $lte: end }
    });

    const total = payments.reduce((s,p) => s + (p.amountPaid||0), 0);
    const yetToReceive = payments.reduce((s, p) => {
      const balance = (p.totalBill || 0) - (p.amountPaid || 0);
      return s + (balance > 0 ? balance : 0);
    }, 0);

    res.json({ total, yetToReceive, payments });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── CRUD: Sites ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try { res.json(await SiteB.find({ isActive: true }).sort({ ownerName: 1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await SiteB.create(req.body)); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

// ── GET orders for a site ─────────────────────────────────────────────────────
router.get('/:id/orders', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { siteB: req.params.id };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(new Date(to).setHours(23,59,59,999));
    }
    const orders = await SiteBOrder.find(filter)
        .populate('vehicles.vehicle', 'vehicleNumber ownershipType')
        .populate('vehicles.driver', 'name')
        .populate('vehicles.conductor', 'name')
        .populate('vehicle', 'vehicleNumber ownershipType')
        .populate('driver', 'name')
        .populate('conductor', 'name')
        .sort({ date: -1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST order — multi-vehicle with royalty + brass ───────────────────────────
router.post('/:id/orders', async (req, res) => {
  try {
    const site = await SiteB.findById(req.params.id);
    if (!site) return res.status(404).json({ message: 'Site not found' });

    const {
      date, note,
      vehicles: vehicleRows,
      // Royalty fields (manually provided per order)
      royaltyCount = 0,
      royaltyRate  = null,   // if not sent, falls back to site.royaltyRate
    } = req.body;

    const orderDate  = new Date(date); orderDate.setHours(12,0,0,0);
    const weekStart  = getWeekStart(orderDate);
    const attendDate = new Date(orderDate); attendDate.setHours(0,0,0,0);

    const effectiveRoyaltyRate  = Number(royaltyRate  ?? site.royaltyRate  ?? 0);
    const effectiveRoyaltyCount = Number(royaltyCount || 0);

    // ── Build vehicle entries ─────────────────────────────────────────────────
    const vehicleEntries = [];

    for (const row of (vehicleRows || [])) {
      let vehicleNumber = row.vehicleNumber || '';
      let vehicleType   = row.vehicleType   || 'Own';
      let driverName    = '';
      let conductorName = '';

      if (row.vehicleId) {
        const vDoc = await Vehicle.findById(row.vehicleId);
        if (vDoc) {
          vehicleNumber = vDoc.vehicleNumber || vehicleNumber;
          vehicleType   = vDoc.ownershipType === 'Rental' ? 'Rental' : 'Own';
        }
      }
      if (row.driverId) {
        const d = await Staff.findById(row.driverId);
        if (d) driverName = d.name;
      }
      if (row.conductorId) {
        const c = await Staff.findById(row.conductorId);
        if (c) conductorName = c.name;
      }

      const trips      = Number(row.numberOfTrips) || 0;
      // brassPerTrip: use row-level value, else fall back to site default
      const brassPerTrip = Number(row.brassPerTrip ?? site.brassPerTrip ?? 0);
      const totalBrass   = trips * brassPerTrip;

      vehicleEntries.push({
        vehicle:       row.vehicleId ? new mongoose.Types.ObjectId(row.vehicleId) : null,
        vehicleNumber,
        vehicleType,
        driver:        row.driverId    ? new mongoose.Types.ObjectId(row.driverId)    : null,
        driverName,
        conductor:     row.conductorId ? new mongoose.Types.ObjectId(row.conductorId) : null,
        conductorName,
        numberOfTrips:     trips,
        brassPerTrip,
        totalBrass,
        amountForOwner:    trips * site.rateForOwner,
        amountForCustomer: trips * site.rateForCustomer,
      });
    }

    // ── Totals across all vehicles ────────────────────────────────────────────
    const totalTrips          = vehicleEntries.reduce((s, v) => s + v.numberOfTrips,     0);
    const totalBrass          = vehicleEntries.reduce((s, v) => s + v.totalBrass,        0);
    const totalAmountOwner    = vehicleEntries.reduce((s, v) => s + v.amountForOwner,    0);
    const vehicleAmountCustomer = vehicleEntries.reduce((s, v) => s + v.amountForCustomer, 0);
    const royaltyAmount       = effectiveRoyaltyCount * effectiveRoyaltyRate;
    const totalAmountCustomer = vehicleAmountCustomer + royaltyAmount;

    // First vehicle as legacy top-level fields (for backward compat display)
    const firstV = vehicleEntries[0] || {};

    const order = await SiteBOrder.create({
      siteB:           site._id,
      date:            orderDate,
      rateForOwner:    site.rateForOwner,
      rateForCustomer: site.rateForCustomer,
      vehicles:        vehicleEntries,
      // Royalty
      royaltyCount:    effectiveRoyaltyCount,
      royaltyRate:     effectiveRoyaltyRate,
      royaltyAmount,
      // Totals
      numberOfTrips:   totalTrips,
      totalBrass,
      amountForOwner:    totalAmountOwner,
      amountForCustomer: totalAmountCustomer,
      // Legacy top-level for old UI compatibility
      vehicle:       firstV.vehicle       || null,
      vehicleNumber: firstV.vehicleNumber || '',
      vehicleType:   firstV.vehicleType   || 'Own',
      driver:        firstV.driver        || null,
      driverName:    firstV.driverName    || '',
      conductor:     firstV.conductor     || null,
      conductorName: firstV.conductorName || '',
      note:          note || '',
    });

    // ── Recalculate weekly payment totals (includes carry-forward) ────────────
    await upsertWeeklyPayment(site._id, weekStart, 'customer');
    await upsertWeeklyPayment(site._id, weekStart, 'owner');

    // ── Staff attendance per vehicle row ──────────────────────────────────────
    for (const v of vehicleEntries) {
      for (const staffId of [v.driver, v.conductor].filter(Boolean)) {
        try {
          const sid      = staffId.toString();
          const existing = await StaffAttendance.findOne({ staff: sid, date: attendDate });
          if (existing) {
            existing.numberOfTrips = (existing.numberOfTrips || 0) + v.numberOfTrips;
            await existing.save();
          } else {
            await StaffAttendance.create({
              staff: sid, vehicle: v.vehicle || null,
              date: attendDate, numberOfTrips: v.numberOfTrips, present: true,
            });
          }
        } catch {}
      }
    }

    // NOTE: VehicleTrip records are created exclusively by billing.js.
    // siteb.js must NOT create VehicleTrip records — doing so causes duplicates.

    res.status(201).json(order);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// ── DELETE order ──────────────────────────────────────────────────────────────
router.delete('/:id/orders/:orderId', async (req, res) => {
  try {
    const order = await SiteBOrder.findById(req.params.orderId);
    if (order) {
      const weekStart = getWeekStart(order.date);

      await SiteBOrder.findByIdAndDelete(req.params.orderId);

      // Recalculate weekly payment totals after deletion
      await upsertWeeklyPayment(order.siteB, weekStart, 'customer');
      await upsertWeeklyPayment(order.siteB, weekStart, 'owner');
    }
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── WEEKLY BILL (single site) ──────────────────────────────────────────────────
router.get('/:id/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());

    const site = await SiteB.findById(req.params.id);
    if (!site) return res.status(404).json({ message: 'Site not found' });

    const orders = await SiteBOrder.find({
      siteB: site._id,
      date:  { $gte: weekStart, $lte: weekEnd },
    })
        .populate('vehicles.vehicle', 'vehicleNumber ownershipType')
        .populate('vehicles.driver', 'name')
        .populate('vehicles.conductor', 'name')
        .populate('vehicle', 'vehicleNumber ownershipType')
        .populate('driver', 'name')
        .populate('conductor', 'name')
        .sort({ date: 1 });

    // Group by date for display
    const byDate = {};
    orders.forEach(o => {
      const key = new Date(o.date).toDateString();
      if (!byDate[key]) byDate[key] = { date: o.date, orders: [] };
      byDate[key].orders.push(o);
    });
    const dailyGroups = Object.values(byDate).sort((a,b) => new Date(a.date)-new Date(b.date));

    // Week-level totals
    const totalTrips          = orders.reduce((s,o) => s + (o.numberOfTrips     || 0), 0);
    const totalBrass          = orders.reduce((s,o) => s + (o.totalBrass        || 0), 0);
    const totalRoyaltyCount   = orders.reduce((s,o) => s + (o.royaltyCount      || 0), 0);
    const totalRoyaltyAmount  = orders.reduce((s,o) => s + (o.royaltyAmount     || 0), 0);
    const totalAmountOwner    = orders.reduce((s,o) => s + (o.amountForOwner    || 0), 0);
    const totalAmountCustomer = orders.reduce((s,o) => s + (o.amountForCustomer || 0), 0);

    // Get payment records (with carry-forward already computed inside them)
    const [ownerPay, customerPay] = await Promise.all([
      SiteBPayment.findOne({ siteB: site._id, weekStart, paymentFor: 'owner' }),
      SiteBPayment.findOne({ siteB: site._id, weekStart, paymentFor: 'customer' }),
    ]);

    // Previous week carry-forward amounts (for display)
    const customerCarryForward = await getCarryForward(site._id, weekStart, 'customer');
    const ownerCarryForward    = await getCarryForward(site._id, weekStart, 'owner');

    res.json({
      site, weekStart, weekEnd,
      orders, dailyGroups,
      totalTrips, totalBrass,
      totalRoyaltyCount, totalRoyaltyAmount,
      totalAmountOwner, totalAmountCustomer,
      customerCarryForward, ownerCarryForward,
      ownerPay:    ownerPay    || null,
      customerPay: customerPay || null,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENT ───────────────────────────────────────────────────────────────────
router.post('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor, amountPaid, note, paidDate } = req.body;

    if (!weekStart)  return res.status(400).json({ message: 'weekStart is required' });
    if (!paymentFor) return res.status(400).json({ message: 'paymentFor is required' });

    const wStart = new Date(weekStart);
    if (isNaN(wStart.getTime())) return res.status(400).json({ message: 'Invalid weekStart date' });
    wStart.setHours(0,0,0,0);

    // Always recompute totalBill from orders + carry-forward
    const rec = await upsertWeeklyPayment(req.params.id, wStart, paymentFor);

    // Now apply payment amount
    rec.amountPaid = Number(amountPaid) || 0;
    rec.paidDate   = rec.amountPaid > 0 ? (paidDate ? new Date(paidDate) : new Date()) : null;
    rec.note       = note || rec.note || '';
    await rec.save();

    // If the NEXT week already has a payment record, update its carry-forward too
    const nextWeekStart = new Date(wStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    const nextPay = await SiteBPayment.findOne({
      siteB: req.params.id, weekStart: nextWeekStart, paymentFor,
    });
    if (nextPay) {
      await upsertWeeklyPayment(req.params.id, nextWeekStart, paymentFor);
    }

    res.json(rec);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor } = req.query;
    if (!weekStart) return res.status(400).json({ message: 'weekStart required' });
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const rec = await SiteBPayment.findOne({ siteB: req.params.id, weekStart: wStart, paymentFor });
    res.json(rec || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Site CRUD ─────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try { res.json(await SiteB.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await SiteB.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;