const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const KhetOrder       = require('../models/KhetOrder');
const KhetPayment     = require('../models/KhetPayment');
const Vehicle         = require('../models/Vehicle');
const VehicleRentalRate = require('../models/VehicleRentalRate');
const VehicleTrip     = require('../models/VehicleTrip');
const Staff           = require('../models/Staff');
const StaffAttendance = require('../models/StaffAttendance');
const Material        = require('../models/Material');
const StockTransaction = require('../models/StockTransaction');
const { protect } = require('../middleware/auth');

router.use(protect);

// ── IST helpers (UTC+5:30) ─────────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes

// Parse a YYYY-MM-DD string as IST midnight (not UTC midnight)
const parseISTDate = (dateStr) => {
  // dateStr like "2026-04-01" → treat as 2026-04-01T00:00:00+05:30 = 2026-03-31T18:30:00Z
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
};

// Get IST calendar date parts from a JS Date
const toIST = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(), month: ist.getUTCMonth(), day: ist.getUTCDate(),
    hours: ist.getUTCHours(), minutes: ist.getUTCMinutes(),
    dow: ist.getUTCDay(),
  };
};

// Week start in IST (Monday), returned as UTC Date (so MongoDB comparisons work correctly)
const getWeekStart = (date) => {
  const ist = toIST(new Date(date));
  const diff = ist.dow === 0 ? -6 : 1 - ist.dow;
  // Build IST midnight of that Monday, then convert to UTC
  const istMidnight = Date.UTC(ist.year, ist.month, ist.day + diff) - IST_OFFSET_MS;
  return new Date(istMidnight);
};

const getWeekEnd = (date) => {
  const s = getWeekStart(date);
  return new Date(s.getTime() + 7 * 24 * 60 * 60 * 1000 - 1); // exactly 7 days later minus 1ms
};

// Parse a date range boundary as IST start-of-day or end-of-day
const parseISTStart = (dateStr) => parseISTDate(dateStr); // IST midnight = UTC 18:30 prev day
const parseISTEnd   = (dateStr) => {
  const start = parseISTDate(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1); // 23:59:59.999 IST
};


// ── Helper: compute per-customer carry-forward balance before a given weekStart ──
// Returns a map: { "CustomerName|phone": carryForwardAmount }
const getPerCustomerCarryForward = async (weekStart) => {
  // All orders strictly before the current week
  const prevOrders = await KhetOrder.find(
      { date: { $lt: weekStart } },
      'customerName customerPhone grandTotal totalAmount totalRoyalty'
  );

  // Payments that belong to weeks BEFORE the current weekStart.
  // A payment "belongs to" a past week if EITHER:
  //   (a) its weekStart field is set and is before current weekStart, OR
  //   (b) it has no weekStart and its date is before current weekStart
  // This handles both old records (weekStart-based) and new records (date-based).
  const prevPayments = await KhetPayment.find(
      { $or: [
          { weekStart: { $exists: true, $ne: null, $lt: weekStart } },
          { weekStart: { $exists: false }, date: { $lt: weekStart } },
          { weekStart: null, date: { $lt: weekStart } },
        ]},
      'customerName customerPhone amountPaid weekStart date'
  );

  // Sum billed per customer (only pre-week orders)
  const billed = {};
  prevOrders.forEach(o => {
    const key = `${o.customerName}|${o.customerPhone || ''}`;
    if (!billed[key]) billed[key] = 0;
    billed[key] += o.grandTotal || o.totalAmount || 0;
  });

  // Sum pre-week payments per customer
  const paid = {};
  prevPayments.forEach(p => {
    const key = `${p.customerName}|${p.customerPhone || ''}`;
    if (!paid[key]) paid[key] = 0;
    paid[key] += p.amountPaid || 0;
  });

  // Carry forward = max(0, pre-week billed - pre-week paid)
  const carryMap = {};
  const allKeys = new Set([...Object.keys(billed), ...Object.keys(paid)]);
  allKeys.forEach(key => {
    carryMap[key] = Math.max(0, (billed[key] || 0) - (paid[key] || 0));
  });

  return carryMap;
};

// GET form data
router.get('/form-data', async (req, res) => {
  try {
    const [vehicles, staff, materials] = await Promise.all([
      Vehicle.find({ isActive:true }).sort({ ownershipType:1, vehicleNumber:1 }),
      Staff.find({ isActive:true }).sort({ role:1, name:1 }),
      Material.find({ isActive:true }).sort({ name:1 }),
    ]);
    res.json({ vehicles, staff, materials });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET all orders
router.get('/orders', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from||to) { filter.date={}; if(from)filter.date.$gte=parseISTStart(from); if(to)filter.date.$lte=parseISTEnd(to); }
    const orders = await KhetOrder.find(filter)
        .populate('vehicles.vehicle','vehicleNumber vehicleType ownershipType')
        .populate('vehicles.driver','name')
        .populate('vehicles.conductor','name')
        .sort({ date:-1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET customers list
router.get('/customers', async (req, res) => {
  try {
    const orders = await KhetOrder.find({}, 'customerName customerPhone totalAmount grandTotal');
    const map = {};
    orders.forEach(o => {
      const key = `${o.customerName}__${o.customerPhone}`;
      if (o.customerName && !map[key]) map[key] = { name:o.customerName, phone:o.customerPhone||'', orderCount:0, totalAmount:0 };
      if (map[key]) { map[key].orderCount++; map[key].totalAmount += o.grandTotal||o.totalAmount||0; }
    });
    res.json(Object.values(map).sort((a,b)=>a.name.localeCompare(b.name)));
  } catch (err) { res.status(500).json({ message: err.message }); }
});


// DELETE customer — hard deletes all orders + payments for that customer
router.delete('/customers', async (req, res) => {
  try {
    const { name, phone } = req.query;
    if (!name) return res.status(400).json({ message: 'Customer name required' });

    const nameRegex = { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
    const orderFilter   = { customerName: nameRegex };
    const paymentFilter = { customerName: nameRegex };
    if (phone) {
      orderFilter.customerPhone   = phone;
      paymentFilter.customerPhone = phone;
    }

    const [ordersResult, paymentsResult] = await Promise.all([
      KhetOrder.deleteMany(orderFilter),
      KhetPayment.deleteMany(paymentFilter),
    ]);

    res.json({
      message: 'Customer deleted',
      ordersDeleted:   ordersResult.deletedCount,
      paymentsDeleted: paymentsResult.deletedCount,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET all payments for a specific customer (for Customers tab payment display)
router.get('/customer-payments', async (req, res) => {
  try {
    const { name, phone } = req.query;
    if (!name) return res.json([]);
    const filter = { customerName: { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, $options:'i' } };
    if (phone) filter.customerPhone = phone;
    const payments = await KhetPayment.find(filter).sort({ date:-1 });
    res.json(payments);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET customer order history
router.get('/customer-orders', async (req, res) => {
  try {
    const { name, phone } = req.query;
    const filter = {};
    if (name)  filter.customerName  = { $regex:name, $options:'i' };
    if (phone) filter.customerPhone = phone;
    const orders = await KhetOrder.find(filter)
        .populate('vehicles.vehicle','vehicleNumber vehicleType')
        .populate('vehicles.driver','name')
        .sort({ date:-1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── NEW: GET per-customer carry-forward balance ──
// Returns { carryForward: number } — all unpaid balance from ALL weeks before the queried weekStart
router.get('/customer-carry-forward', async (req, res) => {
  try {
    const { name, phone, weekStart } = req.query;
    if (!name || !weekStart) return res.json({ carryForward: 0 });

    const ws = getWeekStart(new Date(weekStart));
    const nameRegex = { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, $options: 'i' };

    const [prevOrders, prevPayments] = await Promise.all([
      KhetOrder.find(
          { customerName: nameRegex, customerPhone: phone || '', date: { $lt: ws } },
          'grandTotal totalAmount'
      ),
      // Payments that belong to weeks before current weekStart (same logic as getPerCustomerCarryForward)
      KhetPayment.find(
          { customerName: nameRegex, customerPhone: phone || '',
            $or: [
              { weekStart: { $exists: true, $ne: null, $lt: ws } },
              { weekStart: { $exists: false }, date: { $lt: ws } },
              { weekStart: null, date: { $lt: ws } },
            ]
          },
          'amountPaid weekStart date'
      ),
    ]);

    const totalBilled = prevOrders.reduce((s, o) => s + (o.grandTotal || o.totalAmount || 0), 0);
    const totalPaid   = prevPayments.reduce((s, p) => s + (p.amountPaid || 0), 0);
    const carryForward = Math.max(0, totalBilled - totalPaid);

    res.json({ carryForward, totalBilled, totalPaid });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST place order
router.post('/orders', async (req, res) => {
  try {
    const { date, billingType, quantityUnit, material, destination, vehicles, note, customerName, customerPhone } = req.body;
    // Parse date as IST noon (UTC 06:30) so it stores correctly regardless of server timezone
    let orderDate;
    if (date) {
      const [y,m,d] = String(date).slice(0,10).split('-').map(Number);
      // IST noon = UTC 06:30
      orderDate = new Date(Date.UTC(y, m-1, d, 6, 30, 0, 0));
    } else {
      orderDate = new Date();
    }

    const vehicleEntries = [];
    for (const v of (vehicles||[])) {

      let driverName = '';
      let conductorName = '';
      let resolvedVehicleNumber = v.vehicleNumber || '';

      if (v.vehicleId) {
        const vDoc = await Vehicle.findById(v.vehicleId);
        if (vDoc) resolvedVehicleNumber = vDoc.vehicleNumber || resolvedVehicleNumber;
      }

      if (v.driverId) {
        const d = await Staff.findById(v.driverId);
        if (d) driverName = d.name;
      }

      if (v.conductorId) {
        const c = await Staff.findById(v.conductorId);
        if (c) conductorName = c.name;
      }

      const productAmt = billingType==='Trip'
          ? (Number(v.numberOfTrips)||0)*(Number(v.rateApplied)||0)
          : (Number(v.quantity)||0)*(Number(v.rateApplied)||0);

      vehicleEntries.push({
        vehicle:       v.vehicleId ? new mongoose.Types.ObjectId(v.vehicleId) : null,
        vehicleNumber: resolvedVehicleNumber,
        driver:        v.driverId ? new mongoose.Types.ObjectId(v.driverId) : null,
        driverName,
        conductorName,
        numberOfTrips: Number(v.numberOfTrips)||0,
        quantity:      Number(v.quantity)||0,
        brassPerTrip:  Number(v.brassPerTrip)||0,
        rateApplied:   Number(v.rateApplied)||0,
        totalAmount:   productAmt,
      });
    }

    const totalAmount = vehicleEntries.reduce((s,v)=>s+v.totalAmount,0);
    const royaltyQty  = Number(req.body.royaltyQuantity)||0;
    const royaltyRate = Number(req.body.royaltyRate)||0;
    const totalRoyalty = royaltyQty * royaltyRate;
    const grandTotal   = totalAmount + totalRoyalty;

    const order = await KhetOrder.create({
      date:orderDate, billingType, customerName:customerName||'', customerPhone:customerPhone||'',
      quantityUnit:quantityUnit||'brass', material:material||'', destination:destination||'',
      vehicles:vehicleEntries, totalAmount, totalRoyalty, grandTotal, note:note||'',
      royaltyQuantity:royaltyQty, royaltyRate,
    });

    // ── Auto stock deduction (FIXED) ──────────────────────────────────────────
    // For Trip-unit materials:
    //   Stock is decremented by TRIPS (not brass).
    //   Amount = fullTrips × ratePerTrip + extraBrass × extraRate
    //   where fullTrips = floor(totalBrass / 3), extraBrass = totalBrass % 3
    // For Quantity-unit materials:
    //   Stock decremented by total quantity, amount = qty × pricePerUnit.
    // ─────────────────────────────────────────────────────────────────────────
    const TRIP_RATE        = 500;  // default ₹/trip  (3 brass = 1 trip)
    const EXTRA_BRASS_RATE = 150;  // default ₹/extra brass (non-multiple of 3)

    let stockDeductResult = { done: false, qty: 0, reason: 'no material' };
    try {
      if (material && material.trim()) {
        const escaped = material.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matDoc  = await Material.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' }, isActive: true });

        if (matDoc) {
          let deductQty  = 0;
          let deductAmt  = 0;
          let noteDetail = '';

          if (billingType === 'Trip' && matDoc.unit === 'trip') {
            // Per-trip billing rules:
            //   brassPerTrip is multiple of 3 → fullSets × ₹500  (e.g. 6 brass = 2×₹500 = ₹1000)
            //   brassPerTrip is NOT multiple of 3 → floor(b/3)×₹500 + (b%3)×₹150
            //   e.g. 4 brass = 1×₹500 + 1×₹150 = ₹650
            const ratePerTrip = Number(matDoc.pricePerUnit) || TRIP_RATE;
            let totalTrips    = 0;
            let totalAmt      = 0;
            let totalBrassAll = 0;
            vehicleEntries.forEach(v => {
              const trips      = Number(v.numberOfTrips) || 0;
              const brass      = Number(v.brassPerTrip)  || 0;
              const fullSets   = Math.floor(brass / 3);
              const extraBrass = brass % 3;                         // 0 if multiple of 3
              const perTripAmt = fullSets * ratePerTrip + extraBrass * EXTRA_BRASS_RATE;
              totalTrips    += trips;
              totalAmt      += trips * perTripAmt;
              totalBrassAll += trips * brass;
            });
            deductQty  = totalTrips;
            deductAmt  = totalAmt;
            noteDetail = `${totalTrips} trip(s), ${totalBrassAll} brass`;

          } else if (billingType === 'Trip') {
            const totalBrass = vehicleEntries.reduce(
                (s, v) => s + (Number(v.numberOfTrips) || 0) * (Number(v.brassPerTrip) || 0), 0
            );
            deductQty  = totalBrass;
            deductAmt  = deductQty * (matDoc.pricePerUnit || 0);
            noteDetail = `${totalBrass} ${matDoc.unit}`;

          } else {
            const totalQty = vehicleEntries.reduce((s, v) => s + (Number(v.quantity) || 0), 0);
            deductQty  = totalQty;
            deductAmt  = deductQty * (matDoc.pricePerUnit || 0);
            noteDetail = `${totalQty} ${matDoc.unit}`;
          }

          if (deductQty > 0) {
            await Material.findByIdAndUpdate(matDoc._id, { $inc: { currentStock: -deductQty } });
            await StockTransaction.create({
              material:     matDoc._id,
              type:         'OUT',
              quantity:     deductQty,
              pricePerUnit: matDoc.pricePerUnit || 0,
              totalAmount:  deductAmt,
              destination:  destination || customerName || '',
              khetCustomer: customerName || '',
              note:         `Khet — ${customerName || ''} | ${noteDetail}`,
              date:         orderDate,
              isDeleted:    false,
              isSettled:    false,
            });
            stockDeductResult = { done: true, qty: deductQty, material: matDoc.name };
          }
        } else {
          stockDeductResult.reason = `"${material}" not found`;
        }
      }
    } catch (e) { stockDeductResult.reason = e.message; }

    res.status(201).json({ order, stockDeduct:stockDeductResult });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE order
router.delete('/orders/:id', async (req, res) => {
  try {
    const order = await KhetOrder.findById(req.params.id);
    if (order) {
      await KhetOrder.findByIdAndDelete(req.params.id);
    }
    res.json({ message:'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAYMENT — per customer, no week grouping ──
router.post('/payments', async (req, res) => {
  try {
    const { customerName, customerPhone, amount, paymentType, note, date } = req.body;

    const paidAmt = Number(amount)||0;
    if (paidAmt < 0) return res.status(400).json({ message: 'Invalid amount' });

    const custName  = customerName||'';
    const custPhone = customerPhone||'';
    const payDate = date ? new Date(date) : new Date();

    const rec = await KhetPayment.create({
      customerName:custName, customerPhone:custPhone,
      amountPaid:paidAmt, isPaid:paymentType==='full', isPartial:paymentType==='partial',
      note:note||'', date:payDate,
    });
    res.status(201).json(rec);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE payment
router.delete('/payments/:id', async (req, res) => {
  try { await KhetPayment.findByIdAndDelete(req.params.id); res.json({ message:'Deleted' }); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// ── WEEKLY BILL — grouped by customer, includes per-customer carry-forward ──
router.get('/weekly-summary', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());

    const orders = await KhetOrder.find({ date:{ $gte:weekStart, $lte:weekEnd } })
        .populate('vehicles.vehicle','vehicleNumber vehicleType ownershipType')
        .sort({ date:1, customerName:1 });

    // Group by customer
    const byCust = {};
    orders.forEach(o => {
      const key = o.customerName+'|'+(o.customerPhone||'');
      if (!byCust[key]) byCust[key] = { name:o.customerName, phone:o.customerPhone||'', orders:[], total:0, royalty:0, grandTotal:0, carryForward:0 };
      byCust[key].orders.push(o);
      byCust[key].total      += o.totalAmount||0;
      byCust[key].royalty    += o.totalRoyalty||0;
      byCust[key].grandTotal += o.grandTotal||o.totalAmount||0;
    });

    // Get per-customer carry-forward
    const carryMap = await getPerCustomerCarryForward(weekStart);
    Object.keys(byCust).forEach(key => {
      byCust[key].carryForward = carryMap[key] || 0;
    });

    // Get payments for this week — match by date range OR by weekStart field (old records)
    const payments = await KhetPayment.find({
      $or: [
        { date: { $gte: weekStart, $lte: weekEnd } },
        { weekStart: { $gte: weekStart, $lte: weekEnd } },
      ]
    }).sort({ date:1 });

    // Fetch ALL payments + ALL orders ever for accurate per-customer netDue
    const allPayments = await KhetPayment.find({});
    const allPayMap = {};
    allPayments.forEach(p => {
      const k = `${p.customerName}|${p.customerPhone||''}`;
      if (!allPayMap[k]) allPayMap[k] = 0;
      allPayMap[k] += p.amountPaid || 0;
    });
    const allOrdersDocs = await KhetOrder.find({}, 'customerName customerPhone grandTotal totalAmount');
    const allBilledMap = {};
    allOrdersDocs.forEach(o => {
      const k = `${o.customerName}|${o.customerPhone||''}`;
      if (!allBilledMap[k]) allBilledMap[k] = 0;
      allBilledMap[k] += o.grandTotal || o.totalAmount || 0;
    });

    // Attach accurate netDue to each customer group
    Object.keys(byCust).forEach(key => {
      const totalEverPaid   = allPayMap[key] || 0;
      const totalEverBilled = allBilledMap[key] || 0;
      byCust[key].netDue = Math.max(0, totalEverBilled - totalEverPaid);
      byCust[key].custPaid = totalEverPaid;
    });

    const weekTotal   = orders.reduce((s,o)=>s+o.totalAmount,0);
    const weekRoyalty = orders.reduce((s,o)=>s+(o.totalRoyalty||0),0);
    const weekGrand   = orders.reduce((s,o)=>s+(o.grandTotal||o.totalAmount),0);
    const weekPaid    = payments.reduce((s,p)=>s+p.amountPaid,0);
    const weekTrips   = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
    const weekQty     = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0);

    // Overall carry forward (sum of all customer carry-forwards for customers who have orders this week)
    const carriedBalance = Object.values(byCust).reduce((s, c) => s + c.carryForward, 0);
    const netDue = carriedBalance + weekGrand - weekPaid;

    res.json({ weekStart, weekEnd, byCustomer:Object.values(byCust), payments, weekTotal, weekRoyalty, weekGrand, weekTrips, weekQty, weekPaid, carriedBalance, netDue });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly summary by customer (for summary tab) — with per-customer carry-forward
router.get('/summary/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());
    const orders    = await KhetOrder.find({ date:{ $gte:weekStart, $lte:weekEnd } }).sort({ date:1 });

    // Fetch payments for this week — match by date range OR by weekStart field (old records)
    const weekPayments = await KhetPayment.find({
      $or: [
        { date: { $gte: weekStart, $lte: weekEnd } },
        { weekStart: { $gte: weekStart, $lte: weekEnd } },
      ]
    }).sort({ date:1 });

    const byCustomer = {};
    orders.forEach(o => {
      const key = `${o.customerName||'Unknown'}__${o.customerPhone||''}`;
      if (!byCustomer[key]) byCustomer[key] = { customerName:o.customerName||'Unknown', customerPhone:o.customerPhone||'', orders:[], total:0, royalty:0, grandTotal:0, carryForward:0 };
      byCustomer[key].orders.push(o);
      byCustomer[key].total      += o.totalAmount||0;
      byCustomer[key].royalty    += o.totalRoyalty||0;
      byCustomer[key].grandTotal += o.grandTotal||o.totalAmount||0;
    });

    // Compute per-customer carry-forward (all billed - all paid BEFORE this week)
    const carryMap = await getPerCustomerCarryForward(weekStart);

    // Fetch ALL payments ever made per customer (to correctly compute total paid vs total billed)
    const allPayments = await KhetPayment.find({});
    const allPayMap = {};
    allPayments.forEach(p => {
      const k = `${p.customerName}|${p.customerPhone||''}`;
      if (!allPayMap[k]) allPayMap[k] = 0;
      allPayMap[k] += p.amountPaid || 0;
    });

    // Fetch all orders ever per customer (total billed ever)
    const allOrders = await KhetOrder.find({}, 'customerName customerPhone grandTotal totalAmount');
    const allBilledMap = {};
    allOrders.forEach(o => {
      const k = `${o.customerName}|${o.customerPhone||''}`;
      if (!allBilledMap[k]) allBilledMap[k] = 0;
      allBilledMap[k] += o.grandTotal || o.totalAmount || 0;
    });

    // netDue = (total ever billed) - (total ever paid), clamped to 0
    const customers = Object.values(byCustomer).map(cs => {
      const custKey = `${cs.customerName}|${cs.customerPhone||''}`;
      const carryForward = carryMap[custKey] || 0;
      const pay = weekPayments.find(p => p.customerName===cs.customerName && p.customerPhone===(cs.customerPhone||''));
      const totalEverPaid   = allPayMap[custKey] || 0;
      const totalEverBilled = allBilledMap[custKey] || 0;
      const netDue = Math.max(0, totalEverBilled - totalEverPaid);
      return { ...cs, carryForward, payment: pay||null, custPaid: totalEverPaid, netDue };
    });

    const grandTotal    = customers.reduce((s,c)=>s+c.grandTotal,0);
    const weekRoyalty   = customers.reduce((s,c)=>s+c.royalty,0);
    const weekRoyaltyQty = orders.reduce((s,o)=>s+(Number(o.royaltyQuantity)||0),0);
    const weekPaid      = weekPayments.reduce((s,p)=>s+p.amountPaid,0);
    const weekTrips = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
    const weekQty   = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0);

    const carriedBalance = customers.reduce((s,c) => s + c.carryForward, 0);
    const netDue = carriedBalance + grandTotal - weekPaid;

    res.json({ weekStart, weekEnd, customers, payments: weekPayments, grandTotal, weekRoyalty, weekRoyaltyQty, weekTrips, weekQty, weekPaid, carriedBalance, netDue });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT customer — update name and/or phone across all orders and payments
router.put('/customers', async (req, res) => {
  try {
    const { originalName, originalPhone, newName, newPhone } = req.body;
    if (!originalName || !newName || !newName.trim())
      return res.status(400).json({ message: 'originalName and newName are required' });

    const nameRegex = { $regex: `^${originalName.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, $options:'i' };
    const orderFilter   = { customerName: nameRegex };
    const paymentFilter = { customerName: nameRegex };
    if (originalPhone !== undefined && originalPhone !== '') {
      orderFilter.customerPhone   = originalPhone;
      paymentFilter.customerPhone = originalPhone;
    }

    const updateFields = { customerName: newName.trim(), customerPhone: (newPhone||'').trim() };

    const [ordersResult, paymentsResult] = await Promise.all([
      KhetOrder.updateMany(orderFilter,    { $set: updateFields }),
      KhetPayment.updateMany(paymentFilter, { $set: updateFields }),
    ]);

    res.json({ message:'Customer updated', ordersUpdated:ordersResult.modifiedCount, paymentsUpdated:paymentsResult.modifiedCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
});


// ── GET /summary/range — like /summary/weekly but accepts explicit start+end dates ──
// This powers the Monthly and Custom range views in the frontend
router.get('/summary/range', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ message: 'start and end required' });

    const rangeStart = parseISTStart(start);
    const rangeEnd   = parseISTEnd(end);

    const orders = await KhetOrder.find({ date: { $gte: rangeStart, $lte: rangeEnd } })
        .populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType')
        .sort({ date: 1 });

    // Group by customer
    const byCustomer = {};
    orders.forEach(o => {
      const key = `${o.customerName||'Unknown'}__${o.customerPhone||''}`;
      if (!byCustomer[key]) byCustomer[key] = {
        customerName: o.customerName||'Unknown', customerPhone: o.customerPhone||'',
        orders: [], total: 0, royalty: 0, grandTotal: 0, carryForward: 0,
      };
      byCustomer[key].orders.push(o);
      byCustomer[key].total      += o.totalAmount || 0;
      byCustomer[key].royalty    += o.totalRoyalty || 0;
      byCustomer[key].grandTotal += o.grandTotal || o.totalAmount || 0;
    });

    // Per-customer carry-forward (all unpaid before rangeStart)
    const carryMap = await getPerCustomerCarryForward(rangeStart);

    // All payments & orders ever (for accurate netDue)
    const allPayments = await KhetPayment.find({});
    const allPayMap = {};
    allPayments.forEach(p => {
      const k = `${p.customerName}|${p.customerPhone||''}`;
      if (!allPayMap[k]) allPayMap[k] = 0;
      allPayMap[k] += p.amountPaid || 0;
    });
    const allOrders = await KhetOrder.find({}, 'customerName customerPhone grandTotal totalAmount');
    const allBilledMap = {};
    allOrders.forEach(o => {
      const k = `${o.customerName}|${o.customerPhone||''}`;
      if (!allBilledMap[k]) allBilledMap[k] = 0;
      allBilledMap[k] += o.grandTotal || o.totalAmount || 0;
    });

    // Payments in this range (for display)
    const payments = await KhetPayment.find({ date: { $gte: rangeStart, $lte: rangeEnd } }).sort({ date: 1 });

    const customers = Object.values(byCustomer).map(cs => {
      const custKey = `${cs.customerName}|${cs.customerPhone||''}`;
      const carryForward      = carryMap[custKey] || 0;
      const totalEverPaid     = allPayMap[custKey] || 0;
      const totalEverBilled   = allBilledMap[custKey] || 0;
      const netDue = Math.max(0, totalEverBilled - totalEverPaid);
      return { ...cs, carryForward, custPaid: totalEverPaid, netDue };
    });

    const grandTotal     = customers.reduce((s,c)=>s+c.grandTotal, 0);
    const weekRoyalty    = customers.reduce((s,c)=>s+c.royalty, 0);
    const weekRoyaltyQty = orders.reduce((s,o)=>s+(Number(o.royaltyQuantity)||0), 0);
    const weekPaid       = payments.reduce((s,p)=>s+(p.amountPaid||0), 0);
    const weekTrips      = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0), 0);
    const weekQty        = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0), 0);
    const carriedBalance = customers.reduce((s,c)=>s+c.carryForward, 0);
    const netDue         = carriedBalance + grandTotal - weekPaid;

    res.json({
      weekStart: rangeStart, weekEnd: rangeEnd,
      customers, payments,
      grandTotal, weekRoyalty, weekRoyaltyQty,
      weekTrips, weekQty, weekPaid, carriedBalance, netDue,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;