const express = require('express');
const router  = express.Router();
const Material         = require('../models/Material');
const StockTransaction = require('../models/StockTransaction');
const { protect } = require('../middleware/auth');

router.use(protect);

const getWeekStart = (date) => {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate()+(day===0?-6:1-day)); d.setHours(0,0,0,0); return d;
};
const getWeekEnd = (date) => {
  const s = getWeekStart(date); const e = new Date(s);
  e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e;
};

/**
 * Cost for a SINGLE trip based on how many brass it carries.
 * Base: 3 brass = ₹500. Every brass beyond a multiple of 3 = +₹150 each.
 * Examples:
 *   3 brass → ₹500
 *   4 brass → ₹500 + 1×₹150 = ₹650
 *   6 brass → ₹500 (multiple of 3, no extra)
 *   7 brass → ₹500 + 1×₹150 = ₹650
 */
const costPerTrip = (brassPerTrip, ratePerTrip = 500, extraRate = 150) => {
  const b     = Math.max(0, Number(brassPerTrip) || 3);
  const extra = b % 3;
  return ratePerTrip + extra * extraRate;
};

/**
 * Total billing for vehicles array  [{ numberOfTrips, brassPerTrip }, ...]
 * Each trip is priced individually via costPerTrip().
 * Returns { trips (total), amount (total) }
 */
const calcTripBilling = (vehicles = [], ratePerTrip = 500, extraRate = 150) => {
  let trips = 0, amount = 0;
  vehicles.forEach(v => {
    const n    = Number(v.numberOfTrips)  || 0;
    const bpt  = Number(v.brassPerTrip)   || 3;
    const rate = costPerTrip(bpt, ratePerTrip, extraRate);
    trips  += n;
    amount += n * rate;
  });
  return { trips, amount };
};

// ── MUST be before /:id routes ──

router.delete('/transactions/:txId', async (req, res) => {
  try {
    const tx = await StockTransaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    if (tx.type === 'IN') {
      await Material.findByIdAndUpdate(tx.material, { $inc: { currentStock: -tx.quantity } });
    } else if (tx.type === 'OUT') {
      await Material.findByIdAndUpdate(tx.material, { $inc: { currentStock: tx.quantity } });
    }
    await StockTransaction.findByIdAndDelete(req.params.txId);
    res.json({ message: 'Deleted and stock reversed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/settle-week', async (req, res) => {
  try {
    const { date, materialId } = req.body;
    const d = date ? new Date(date) : new Date();
    const start = getWeekStart(d);
    const end   = getWeekEnd(d);

    const txFilter = {
      type:      'OUT',
      date:      { $gte: start, $lte: end },
      isDeleted: { $ne: true },
      isSettled: { $ne: true },
    };
    if (materialId) txFilter.material = materialId;

    const outTxs = await StockTransaction.find(txFilter);
    if (outTxs.length === 0)
      return res.status(400).json({ message: 'No unsettled orders found for this week.' });

    const byMaterial = {};
    outTxs.forEach(tx => {
      const mid = tx.material?.toString();
      if (!byMaterial[mid]) byMaterial[mid] = { materialId: mid, txIds: [], totalQty: 0, totalAmount: 0 };
      byMaterial[mid].txIds.push(tx._id);
      byMaterial[mid].totalQty    += tx.quantity;
      byMaterial[mid].totalAmount += tx.totalAmount;
    });

    const settled = [];
    for (const [mid, group] of Object.entries(byMaterial)) {
      await StockTransaction.updateMany(
          { _id: { $in: group.txIds } },
          { $set: { isSettled: true, settledAt: new Date() } }
      );
      const settleTx = await StockTransaction.create({
        material:    mid,
        type:        'SETTLED',
        quantity:    group.totalQty,
        pricePerUnit: 0,
        totalAmount: group.totalAmount,
        source:      'Weekly Bill Settlement',
        note:        `Week: ${start.toDateString()} – ${end.toDateString()}`,
        date:        new Date(),
        isDeleted:   false,
        isSettled:   true,
        settledAt:   new Date(),
      });
      settled.push({ materialId: mid, totalQty: group.totalQty, totalAmount: group.totalAmount, settleTx });
    }

    res.json({
      message: `Week settled. ${settled.length} material(s) marked as paid.`,
      weekStart: start, weekEnd: end, settled,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PURCHASE BILL — daily or weekly
router.get('/purchase/:type', async (req, res) => {
  try {
    const { date } = req.query;
    const type = req.params.type;
    const d = date ? new Date(date) : new Date();

    let start, end;
    if (type === 'daily') {
      start = new Date(d); start.setHours(0,0,0,0);
      end   = new Date(d); end.setHours(23,59,59,999);
    } else {
      start = getWeekStart(d); end = getWeekEnd(d);
    }

    const txs = await StockTransaction.find({
      type: 'IN', date: { $gte: start, $lte: end }, isDeleted: { $ne: true },
    }).populate('material', 'name unit').sort({ date: 1 });

    const totalAmount = txs.reduce((s, t) => s + t.totalAmount, 0);

    const byMaterialMap = {};
    txs.forEach(t => {
      const mid = t.material?._id?.toString(); if (!mid) return;
      if (!byMaterialMap[mid]) byMaterialMap[mid] = { material: t.material, qty: 0, amount: 0 };
      byMaterialMap[mid].qty    += t.quantity;
      byMaterialMap[mid].amount += t.totalAmount;
    });

    const byDateMap = {};
    txs.forEach(t => {
      const key = new Date(t.date).toDateString();
      if (!byDateMap[key]) byDateMap[key] = { date: t.date, txs: [], total: 0 };
      byDateMap[key].txs.push(t); byDateMap[key].total += t.totalAmount;
    });
    const dailyGroups = Object.values(byDateMap).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      date: d, start, end, weekStart: start, weekEnd: end,
      transactions: txs, dailyGroups,
      byMaterial: Object.values(byMaterialMap),
      totalAmount,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// SUMMARY
router.get('/summary', async (req, res) => {
  try {
    const { date, type } = req.query;
    const d = date ? new Date(date) : new Date();

    let start, end;
    if (type === 'daily') {
      start = new Date(d); start.setHours(0,0,0,0);
      end   = new Date(d); end.setHours(23,59,59,999);
    } else {
      start = getWeekStart(d); end = getWeekEnd(d);
    }

    const inTxs = await StockTransaction.find({
      type: 'IN', date: { $gte: start, $lte: end }, isDeleted: { $ne: true },
    }).populate('material', 'name unit').sort({ date: 1 });

    const totalInAmt = inTxs.reduce((s, t) => s + t.totalAmount, 0);

    const outTxs = await StockTransaction.find({
      type: 'OUT', date: { $gte: start, $lte: end }, isDeleted: { $ne: true },
    }).populate('material', 'name unit').sort({ date: 1 });

    const outByMat = {};
    outTxs.forEach(t => {
      const mid = t.material?._id?.toString(); if (!mid) return;
      if (!outByMat[mid]) outByMat[mid] = { material: t.material, qty: 0, khetCustomers: [], settled: false };
      outByMat[mid].qty += t.quantity;
      if (t.isSettled) outByMat[mid].settled = true;
      if (t.khetCustomer && !outByMat[mid].khetCustomers.includes(t.khetCustomer))
        outByMat[mid].khetCustomers.push(t.khetCustomer);
    });

    const KhetOrder = require('../models/KhetOrder');
    const khetOrders = await KhetOrder.find({ date: { $gte: start, $lte: end } });

    const khetByMat = {};
    khetOrders.forEach(o => {
      if (!o.material) return;
      const key = o.material.toLowerCase().trim();
      if (!khetByMat[key]) khetByMat[key] = { materialName: o.material, trips: 0, qty: 0, brassQty: 0, amount: 0, customers: {} };

      const customerName = o.customerName || o.customer || o.khetCustomer || 'Unknown';
      if (!khetByMat[key].customers[customerName])
        khetByMat[key].customers[customerName] = { name: customerName, trips: 0, brassQty: 0, qty: 0, amount: 0 };

      if (o.billingType === 'Trip') {
        const orderTrips    = o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0);
        const orderBrassQty = o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0) * (v.brassPerTrip || 0), 0);
        khetByMat[key].trips    += orderTrips;
        khetByMat[key].brassQty += orderBrassQty;
        khetByMat[key].customers[customerName].trips    += orderTrips;
        khetByMat[key].customers[customerName].brassQty += orderBrassQty;
      } else {
        const orderQty = o.vehicles.reduce((s, v) => s + (v.quantity || 0), 0);
        khetByMat[key].qty += orderQty;
        khetByMat[key].customers[customerName].qty += orderQty;
      }
      const orderAmount = o.grandTotal || o.totalAmount || 0;
      khetByMat[key].amount += orderAmount;
      khetByMat[key].customers[customerName].amount += orderAmount;
    });
    const khetTotalRevenue = khetOrders.reduce((s, o) => s + (o.grandTotal || o.totalAmount || 0), 0);

    const inByMat = {};
    inTxs.forEach(t => {
      const mid = t.material?._id?.toString(); if (!mid) return;
      if (!inByMat[mid]) inByMat[mid] = { material: t.material, inQty: 0, inAmount: 0 };
      inByMat[mid].inQty    += t.quantity;
      inByMat[mid].inAmount += t.totalAmount;
    });

    const unsettledOut = await StockTransaction.find({
      type: 'OUT', date: { $gte: start, $lte: end }, isDeleted: { $ne: true }, isSettled: { $ne: true },
    }).populate('material', 'name unit');

    const unsettledByMat = {};
    unsettledOut.forEach(t => {
      const mid = t.material?._id?.toString(); if (!mid) return;
      if (!unsettledByMat[mid]) unsettledByMat[mid] = { material: t.material, qty: 0, amount: 0 };
      unsettledByMat[mid].qty    += t.quantity;
      unsettledByMat[mid].amount += t.totalAmount;
    });

    const materials = await Material.find({ isActive: true });

    res.json({
      start, end, type,
      stockIn:  { transactions: inTxs,  totalAmount: totalInAmt },
      stockOut: { transactions: outTxs, byMaterial: Object.values(outByMat) },
      khetOrders: Object.values(khetByMat).map(k => ({ ...k, customers: Object.values(k.customers) })),
      khetTotalRevenue,
      inByMaterial: Object.values(inByMat),
      unsettledByMaterial: Object.values(unsettledByMat),
      currentStock: materials.map(m => ({
        _id: m._id, name: m.name, unit: m.unit,
        stock: m.currentStock, pricePerUnit: m.pricePerUnit,
      })),
      profit: khetTotalRevenue - totalInAmt,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/week-status', async (req, res) => {
  try {
    const d     = req.query.date ? new Date(req.query.date) : new Date();
    const start = getWeekStart(d);
    const end   = getWeekEnd(d);

    const outTxs = await StockTransaction.find({
      type: 'OUT', date: { $gte: start, $lte: end }, isDeleted: { $ne: true },
    }).populate('material', 'name unit');

    const byMat = {};
    outTxs.forEach(t => {
      const mid = t.material?._id?.toString(); if (!mid) return;
      if (!byMat[mid]) byMat[mid] = {
        material: t.material, totalQty: 0, totalAmount: 0,
        unsettledQty: 0, unsettledAmount: 0, isFullySettled: false,
      };
      byMat[mid].totalQty    += t.quantity;
      byMat[mid].totalAmount += t.totalAmount;
      if (!t.isSettled) {
        byMat[mid].unsettledQty    += t.quantity;
        byMat[mid].unsettledAmount += t.totalAmount;
      }
    });
    Object.values(byMat).forEach(m => {
      m.isFullySettled = m.unsettledQty === 0 && m.totalQty > 0;
    });

    res.json({ weekStart: start, weekEnd: end, byMaterial: Object.values(byMat) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── /:id routes ──

router.get('/', async (req, res) => {
  try { res.json(await Material.find({ isActive: true }).sort({ name: 1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Material.create(req.body)); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const m = await Material.findById(req.params.id);
    if (!m) return res.status(404).json({ message: 'Not found' });
    res.json(m);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await Material.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await Material.findByIdAndUpdate(req.params.id, { isActive: false }); res.json({ message: 'Removed' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/:id/stock-in', async (req, res) => {
  try {
    const { quantity, pricePerUnit, source, note, date } = req.body;
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });

    material.currentStock += Number(quantity);
    if (pricePerUnit) material.pricePerUnit = Number(pricePerUnit);
    await material.save();

    const tx = await StockTransaction.create({
      material:     material._id,
      type:         'IN',
      quantity:     Number(quantity),
      pricePerUnit: Number(pricePerUnit) || material.pricePerUnit,
      totalAmount:  Number(quantity) * (Number(pricePerUnit) || material.pricePerUnit),
      source:       source || '',
      note:         note   || '',
      date:         date   || Date.now(),
      isDeleted:    false,
      isSettled:    false,
    });
    res.status(201).json({ material, transaction: tx });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

/**
 * STOCK OUT
 *
 * For trip-unit materials pass:
 *   { vehicles: [{ numberOfTrips, brassPerTrip }, ...], ratePerTrip: 500, extraRate: 150 }
 *
 * Each trip is billed individually:
 *   3 brass → ₹500  |  4 brass → ₹650  |  6 brass → ₹500  |  7 brass → ₹650
 *
 * Stock decrements by total TRIPS only (not brass).
 *
 * Fallback: if no `vehicles` array, uses { quantity, pricePerUnit } as before.
 */
router.post('/:id/stock-out', async (req, res) => {
  try {
    const {
      quantity, pricePerUnit,
      vehicles, ratePerTrip, extraRate,      // trip-billing params
      destination, khetCustomer, khetOrderId, note, date,
    } = req.body;

    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });

    let finalQty, finalPPU, finalTotal;

    if (vehicles && Array.isArray(vehicles) && vehicles.length && material.unit === 'trip') {
      // ── Per-trip billing: each trip priced by its own brassPerTrip ──
      const billed = calcTripBilling(
          vehicles,
          Number(ratePerTrip) || material.pricePerUnit || 500,
          Number(extraRate)   || 150,
      );
      finalQty   = billed.trips;
      finalPPU   = Number(ratePerTrip) || material.pricePerUnit || 500;
      finalTotal = billed.amount;
    } else {
      // ── Standard calculation ──
      finalQty   = Number(quantity);
      finalPPU   = Number(pricePerUnit) || material.pricePerUnit;
      finalTotal = finalQty * finalPPU;
    }

    material.currentStock -= finalQty;
    await material.save();

    const tx = await StockTransaction.create({
      material:     material._id,
      type:         'OUT',
      quantity:     finalQty,
      pricePerUnit: finalPPU,
      totalAmount:  finalTotal,
      destination:  destination  || '',
      khetCustomer: khetCustomer || '',
      khetOrderId:  khetOrderId  || null,
      note:         note         || '',
      date:         date         || Date.now(),
      isDeleted:    false,
      isSettled:    false,
    });
    res.status(201).json({ material, transaction: tx });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get('/:id/transactions', async (req, res) => {
  try {
    const { from, to, type } = req.query;
    const filter = { material: req.params.id, isDeleted: { $ne: true } };
    if (type) filter.type = type;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from + 'T00:00:00');
      if (to)   filter.date.$lte = new Date(to   + 'T23:59:59');
    }
    const txs = await StockTransaction.find(filter).sort({ date: -1 });
    res.json(txs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;