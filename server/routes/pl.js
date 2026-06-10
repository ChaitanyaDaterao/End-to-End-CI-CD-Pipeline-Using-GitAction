const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');

const BillingDelivery  = require('../models/BillingDelivery');
const BillingPayment   = require('../models/BillingPayment');
const KhetOrder         = require('../models/KhetOrder');
const KhetPayment       = require('../models/KhetPayment');
const StockTransaction  = require('../models/StockTransaction');
const StaffAdvance      = require('../models/StaffAdvance');
const StaffPayment      = require('../models/StaffPayment');
const VehicleExpense    = require('../models/VehicleExpense');
const RentalPayment     = require('../models/RentalPayment');
const PoklandPayment    = require('../models/PoklandPayment');
const BillingCustomer          = require('../models/BillingCustomer');
const Staff             = require('../models/Staff');
const PoklandOperator   = require('../models/PoklandOperator');
const SiteBPayment      = require('../models/SiteBPayment');
const BillingPaymentStatus = require('../models/BillingPaymentStatus');

let SiteBOrder = null;
try { SiteBOrder = require('../models/SiteBOrder'); } catch(e) {}
let SiteB = null;
try { SiteB = require('../models/SiteB'); } catch(e) {}

router.use(protect);

// ── IST helpers ───────────────────────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const istMidnightUTC = (year, month, day) =>
    new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);

const toISTComponents = (input) => {
  const ist = new Date(new Date(input || Date.now()).getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth(), day: ist.getUTCDate(), dow: ist.getUTCDay() };
};

// Parse a YYYY-MM-DD string as IST midnight (matches khet.js parseISTDate)
const parseISTDate = (dateStr) => {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
};

const getRange = (type, date, from, to) => {
  if (type === 'custom' && from && to) {
    const start = parseISTDate(from);
    const end   = new Date(parseISTDate(to).getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }
  const { year, month, day, dow } = toISTComponents(date);
  if (type === 'weekly') {
    const diff  = (dow === 0 ? -6 : 1 - dow);
    const start = istMidnightUTC(year, month, day + diff);
    const end   = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }
  if (type === 'monthly') {
    const start = istMidnightUTC(year, month, 1);
    const end   = new Date(istMidnightUTC(year, month + 1, 1).getTime() - 1);
    return { start, end };
  }
  return null;
};

// ── Billing-compatible weekStart ─────────────────────────────────────────────
const billingWeekBounds = (istRangeStart) => {
  const mon = new Date(istRangeStart.getTime() + IST_OFFSET_MS);
  const bws = new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 0, 0, 0, 0);
  const bwe = new Date(bws);
  bwe.setDate(bws.getDate() + 6);
  bwe.setHours(23, 59, 59, 999);
  return { bws, bwe };
};

// ── Khet carry-forward ────────────────────────────────────────────────────────
const getKhetCarryForwardMap = async (rangeStart) => {
  const [prevOrders, prevPayments] = await Promise.all([
    KhetOrder.find(
        { date: { $lt: rangeStart } },
        'customerName customerPhone grandTotal totalAmount'
    ).lean(),
    KhetPayment.find(
        { $or: [
            { weekStart: { $lt: rangeStart } },
            { weekStart: { $exists: false }, date: { $lt: rangeStart } },
          ]},
        'customerName customerPhone amountPaid'
    ).lean(),
  ]);

  const billed = {};
  prevOrders.forEach(o => {
    const key = `${(o.customerName || '').trim()}|${(o.customerPhone || '').trim()}`;
    billed[key] = (billed[key] || 0) + (Number(o.grandTotal) || Number(o.totalAmount) || 0);
  });

  const paid = {};
  prevPayments.forEach(p => {
    const key = `${(p.customerName || '').trim()}|${(p.customerPhone || '').trim()}`;
    paid[key] = (paid[key] || 0) + (Number(p.amountPaid) || 0);
  });

  const carryMap = {};
  const allKeys = new Set([...Object.keys(billed), ...Object.keys(paid)]);
  allKeys.forEach(key => {
    carryMap[key] = Math.max(0, (billed[key] || 0) - (paid[key] || 0));
  });
  return carryMap;
};

// ── Billing carry-forward ─────────────────────────────────────────────────────
// Only deliveries and payments strictly before rangeStart are used.
// This ensures current-week payments are counted as "collected" not as carry-forward reduction.
const getBillingCarryForwardMap = async (rangeStart) => {
  const [prevDels, prevPays] = await Promise.all([
    BillingDelivery.find({ date: { $lt: rangeStart } }, 'customer totalAmount').lean(),
    BillingPayment.find({ date: { $lt: rangeStart } }, 'customer amount').lean(),
  ]);

  const billed = {};
  prevDels.forEach(d => {
    const key = d.customer?.toString();
    if (!key) return;
    billed[key] = (billed[key] || 0) + (Number(d.totalAmount) || 0);
  });

  const paid = {};
  prevPays.forEach(p => {
    const key = p.customer?.toString();
    if (!key) return;
    paid[key] = (paid[key] || 0) + (Number(p.amount) || 0);
  });

  const carryMap = {};
  const allKeys = new Set([...Object.keys(billed), ...Object.keys(paid)]);
  allKeys.forEach(key => {
    carryMap[key] = Math.max(0, (billed[key] || 0) - (paid[key] || 0));
  });
  return carryMap;
};

// ── Site B carry-forward ──────────────────────────────────────────────────────
const getSiteBCarryForwardMap = async (rangeStart) => {
  const prevPays = await SiteBPayment.find(
      { weekStart: { $lt: rangeStart }, paymentFor: 'customer' },
      'siteB currentWeekBill amountPaid'
  ).populate('siteB', 'customerName').lean();

  const billed  = {};
  const paid    = {};
  const nameMap = {};
  prevPays.forEach(p => {
    const key = p.siteB?._id?.toString() || p.siteB?.toString();
    if (!key) return;
    if (p.siteB?.customerName) nameMap[key] = p.siteB.customerName;
    billed[key] = (billed[key] || 0) + (Number(p.currentWeekBill) || 0);
    paid[key]   = (paid[key]   || 0) + (Number(p.amountPaid)      || 0);
  });

  const carryMap = {};
  const allKeys = new Set([...Object.keys(billed), ...Object.keys(paid)]);
  allKeys.forEach(key => {
    carryMap[key] = Math.max(0, (billed[key] || 0) - (paid[key] || 0));
  });
  return { carryMap, nameMap };
};

// ─────────────────────────────────────────────────────────────────────────────
router.get('/report', async (req, res) => {
  try {
    const { type, date, from, to } = req.query;
    const range = getRange(type, date, from, to);
    if (!range) return res.status(400).json({ message: 'Please provide a valid date range.' });
    const { start, end } = range;

    // ── Lookup active entities ─────────────────────────────────────────────
    const [activeCustomers, activeStaffList, activeOperators] = await Promise.all([
      BillingCustomer.find({ isActive: { $ne: false } }).select('_id name').lean(),
      Staff.find({ isActive: true }).select('_id').lean(),
      PoklandOperator.find({ isActive: true }).select('_id pokland').lean(),
    ]);
    const activeCustomerIds = new Set(activeCustomers.map(c => c._id.toString()));
    const activeCustomerMap = new Map(activeCustomers.map(c => [c._id.toString(), c.name]));
    const activeStaffIds    = new Set(activeStaffList.map(s => s._id.toString()));
    const poklandsWithOps   = new Set(activeOperators.map(o => o.pokland?.toString()).filter(Boolean));

    // ── Fetch all data for the period ──────────────────────────────────────
    const [
      billingPayDocs,
      staffPayDocs,
      staffAdvDocs,
      vehExpDocs,
      rentalPayDocs,
      poklandPayDocs,
      stockDocs,
      billingDeliveries,
      billingCustomerPays,
      khetOrders,
      khetPeriodPayments,
      siteBPayDocsRaw,
      siteBOrdersRaw,
    ] = await Promise.all([
      BillingPayment.find({ date: { $gte: start, $lte: end } }).lean(),
      StaffPayment.find({ weekStart: { $gte: start, $lte: end } }).lean(),
      StaffAdvance.find({ date: { $gte: start, $lte: end } }).lean(),
      VehicleExpense.find({ date: { $gte: start, $lte: end } }).lean(),
      RentalPayment.find({ weekStart: { $gte: start, $lte: end } }).lean(),
      PoklandPayment.find({ weekStart: { $gte: start, $lte: end } }).lean(),
      StockTransaction.find({ date: { $gte: start, $lte: end }, type: 'IN' }).lean(),
      BillingDelivery.find({ date: { $gte: start, $lte: end } })
          .populate('customer', 'name isActive')
          .populate('vehicles.vehicle', 'vehicleNumber')
          .lean(),
      BillingPayment.find({ date: { $gte: start, $lte: end } }).lean(),
      KhetOrder.find({ date: { $gte: start, $lte: end } })
          .populate('vehicles.vehicle', 'vehicleNumber')
          .lean(),
      KhetPayment.find({
        $or: [
          { weekStart: { $gte: start, $lte: end } },
          { weekStart: { $exists: false }, date: { $gte: start, $lte: end } },
        ]
      }).lean(),
      SiteBPayment.find({ weekStart: { $gte: start, $lte: end } })
          .populate({ path: 'siteB', match: { isActive: { $ne: false } } }).lean(),
      SiteBOrder
          ? SiteBOrder.find({ date: { $gte: start, $lte: end } })
              .populate({ path: 'siteB', select: 'customerName isActive', match: { isActive: { $ne: false } } })
              .lean()
          : Promise.resolve([]),
    ]);

    const siteBPayDocs = siteBPayDocsRaw.filter(p => p.siteB !== null);

    const { bws, bwe } = billingWeekBounds(start);
    const currentStatusDocs = await BillingPaymentStatus.find({
      weekStart: { $gte: bws, $lte: bwe },
      isPaid: true,
    }).lean();
    const paidCustomerIds = new Set(
        currentStatusDocs.map(d => d.customer?.toString()).filter(Boolean)
    );

    // ── Current-period order history ───────────────────────────────────────
    const [allBillingDeliveries, allKhetOrders, allSiteBOrders] = await Promise.all([
      BillingDelivery.find({ date: { $gte: start, $lte: end } })
          .populate('customer', 'name isActive')
          .populate('vehicles.vehicle', 'vehicleNumber')
          .select('customer date totalAmount billingType quantityUnit vehicles material destination')
          .lean(),
      KhetOrder.find({ date: { $gte: start, $lte: end } })
          .populate('vehicles.vehicle', 'vehicleNumber')
          .select('customerName customerPhone date grandTotal totalAmount billingType quantityUnit vehicles numberOfTrips quantity material destination')
          .lean(),
      SiteBOrder
          ? SiteBOrder.find({ date: { $gte: start, $lte: end } })
              .populate({ path: 'siteB', select: 'customerName isActive', match: { isActive: { $ne: false } } })
              .select('siteB date amountForCustomer numberOfTrips totalBrass vehicles vehicleNumber')
              .lean()
          : Promise.resolve([]),
    ]);

    // ── Build order history lookup maps ────────────────────────────────────
    const billingOrdersMap = {};
    allBillingDeliveries.forEach(d => {
      if (!d.customer || d.customer.isActive === false) return;
      const cid = d.customer._id?.toString() || d.customer?.toString();
      if (!cid) return;
      if (!billingOrdersMap[cid]) billingOrdersMap[cid] = [];
      const trips      = d.vehicles ? d.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0) : 0;
      const qty        = d.vehicles ? d.vehicles.reduce((s, v) => s + (v.quantity || 0), 0) : 0;
      const vehicleNos = d.vehicles ? d.vehicles.map(v => v.vehicle?.vehicleNumber || v.vehicleNumber || null).filter(Boolean) : [];
      billingOrdersMap[cid].push({
        date: d.date, trips, qty,
        quantityUnit: d.quantityUnit || '',
        billingType:  d.billingType  || 'Trip',
        vehicles:     vehicleNos,
        amount:       Number(d.totalAmount) || 0,
        material:     d.material    || '',
        destination:  d.destination || '',
      });
    });

    const khetOrdersMap = {};
    allKhetOrders.forEach(o => {
      const key = `${(o.customerName || '').trim()}|${(o.customerPhone || '').trim()}`;
      if (!khetOrdersMap[key]) khetOrdersMap[key] = [];
      const trips      = o.vehicles ? o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0) : (o.numberOfTrips || 0);
      const qty        = o.vehicles ? o.vehicles.reduce((s, v) => s + (v.quantity || 0), 0) : (o.quantity || 0);
      const vehicleNos = o.vehicles ? o.vehicles.map(v => v.vehicle?.vehicleNumber || v.vehicleNumber || null).filter(Boolean) : [];
      khetOrdersMap[key].push({
        date: o.date, trips, qty,
        quantityUnit: o.quantityUnit || '',
        billingType:  o.billingType  || 'Trip',
        vehicles:     vehicleNos,
        amount:       Number(o.grandTotal) || Number(o.totalAmount) || 0,
        material:     o.material    || '',
        destination:  o.destination || '',
      });
    });

    const siteBOrdersMap = {};
    allSiteBOrders.filter(o => o.siteB !== null).forEach(o => {
      const siteBId = o.siteB?._id?.toString() || o.siteB?.toString();
      if (!siteBId) return;
      if (!siteBOrdersMap[siteBId]) siteBOrdersMap[siteBId] = [];
      const trips      = o.vehicles ? o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0) : (o.numberOfTrips || 0);
      const vehicleNos = o.vehicles ? o.vehicles.map(v => v.vehicleNumber || null).filter(Boolean) : (o.vehicleNumber ? [o.vehicleNumber] : []);
      siteBOrdersMap[siteBId].push({
        date: o.date, trips, qty: o.totalBrass || 0,
        quantityUnit: 'brass', billingType: 'Trip',
        vehicles: vehicleNos, amount: Number(o.amountForCustomer) || 0,
        material: '', destination: '',
      });
    });

    // ── INCOME ────────────────────────────────────────────────────────────
    const billingTotal = billingPayDocs
        .filter(p => !p.customer || activeCustomerIds.has(p.customer.toString()))
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const khetTotal = khetOrders.reduce((s, o) =>
        s + (Number(o.grandTotal) || Number(o.totalAmount) || 0), 0);

    const siteBIncomeTotal = siteBOrdersRaw
        .filter(o => o.siteB !== null)
        .reduce((s, o) => s + (Number(o.amountForCustomer) || 0), 0);

    const totalIncome = billingTotal + khetTotal + siteBIncomeTotal;

    // ── EXPENSES ──────────────────────────────────────────────────────────
    const materialCost = stockDocs.reduce((s, t) => s + (Number(t.totalAmount || t.amount) || 0), 0);

    const staffWages = staffPayDocs
        .filter(p => !p.staff || activeStaffIds.has(p.staff.toString()))
        .reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
    const staffAdv = staffAdvDocs
        .filter(a => !a.staff || activeStaffIds.has(a.staff.toString()))
        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const staffTotal = staffWages + staffAdv;

    const diesel       = vehExpDocs.filter(e => e.expenseType === 'Diesel'      && e.vehicleType !== 'Pokland').reduce((s,e) => s+(Number(e.amount)||0), 0);
    const maint        = vehExpDocs.filter(e => e.expenseType === 'Maintenance' && e.vehicleType !== 'Pokland').reduce((s,e) => s+(Number(e.amount)||0), 0);
    const otherV       = vehExpDocs.filter(e => !['Diesel','Maintenance'].includes(e.expenseType) && e.vehicleType !== 'Pokland').reduce((s,e) => s+(Number(e.amount)||0), 0);
    const vehicleTotal = diesel + maint + otherV;

    const ownPoklandDiesel      = vehExpDocs.filter(e => e.vehicleType === 'Pokland' && e.expenseType === 'Diesel').reduce((s,e) => s+(Number(e.amount)||0), 0);
    const ownPoklandMaintenance = vehExpDocs.filter(e => e.vehicleType === 'Pokland' && e.expenseType === 'Maintenance').reduce((s,e) => s+(Number(e.amount)||0), 0);

    const rentalVehicleTotal = rentalPayDocs.reduce((s,p) => s+(Number(p.amountPaid)||0), 0);
    const poklandRentalCost  = poklandPayDocs.filter(p => p.paymentFor === 'rental').reduce((s,p) => s+(Number(p.amountPaid)||0), 0);
    const operatorCost       = poklandPayDocs
        .filter(p => p.paymentFor === 'operator' && poklandsWithOps.has(p.pokland?.toString()))
        .reduce((s,p) => s+(Number(p.amountPaid)||0), 0);

    const siteBExpenseTotal = siteBOrdersRaw.filter(o => o.siteB !== null).length > 0
        ? siteBOrdersRaw.filter(o => o.siteB !== null).reduce((s, o) => s + (Number(o.amountForOwner) || 0), 0)
        : siteBPayDocs.filter(p => p.paymentFor === 'owner').reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);

    const totalExpenses = materialCost + staffTotal + vehicleTotal + ownPoklandDiesel + ownPoklandMaintenance + rentalVehicleTotal + poklandRentalCost + operatorCost + siteBExpenseTotal;
    const netProfit     = totalIncome - totalExpenses;

    // ── YET TO RECEIVE ────────────────────────────────────────────────────
    const unifiedMap = {};
    const getOrCreate = (key, name) => {
      if (!unifiedMap[key]) {
        unifiedMap[key] = {
          name, totalBill: 0, amountPaid: 0, remaining: 0, sources: [],
          prevOutstanding: 0, thisWeekBill: 0, thisWeekCollected: 0,
        };
      }
      return unifiedMap[key];
    };

    // ── BILLING SOURCE ────────────────────────────────────────────────────
    const custDeliveryMap = {};
    billingDeliveries.forEach(d => {
      if (!d.customer || d.customer.isActive === false) return;
      const cid  = d.customer._id?.toString() || d.customer?.toString();
      const name = d.customer?.name || activeCustomerMap.get(cid) || 'Unknown';
      if (!cid) return;
      if (!custDeliveryMap[cid]) custDeliveryMap[cid] = { name, totalBill: 0, amountPaid: 0 };
      custDeliveryMap[cid].totalBill += (Number(d.totalAmount) || 0);
    });
    billingCustomerPays.forEach(p => {
      const cid = p.customer?.toString();
      if (!cid) return;
      // Also add to custDeliveryMap if customer has no deliveries this period but has a payment
      if (!custDeliveryMap[cid] && activeCustomerIds.has(cid)) {
        const name = activeCustomerMap.get(cid) || 'Unknown';
        custDeliveryMap[cid] = { name, totalBill: 0, amountPaid: 0 };
      }
      if (custDeliveryMap[cid]) custDeliveryMap[cid].amountPaid += (Number(p.amount) || 0);
    });

    const billingCarryForwardMap = await getBillingCarryForwardMap(start);

    // Add active customers with carry-forward but NO deliveries this period
    Object.entries(billingCarryForwardMap).forEach(([cid, carry]) => {
      if (carry <= 0 || custDeliveryMap[cid]) return;
      if (!activeCustomerIds.has(cid)) return;
      const name = activeCustomerMap.get(cid) || 'Unknown';
      custDeliveryMap[cid] = { name, totalBill: 0, amountPaid: 0 };
    });

    Object.entries(custDeliveryMap).forEach(([cid, c]) => {
      const rawCarryFwd = billingCarryForwardMap[cid] || 0;
      const isPaid      = paidCustomerIds.has(cid);
      const remaining   = Math.max(0, rawCarryFwd + c.totalBill - c.amountPaid);
      if (isPaid && remaining <= 0) return;
      if (!isPaid && remaining <= 0 && c.totalBill <= 0 && rawCarryFwd <= 0) return;
      const entry = getOrCreate(cid, c.name);
      entry.sources.push({
        source:          'Billing',
        totalBill:       c.totalBill,
        amountPaid:      c.amountPaid,
        remaining:       0,
        prevOutstanding: rawCarryFwd,
        orders:          billingOrdersMap[cid] || [],
      });
      entry.totalBill         += c.totalBill;
      entry.amountPaid        += c.amountPaid;
      entry.prevOutstanding   += rawCarryFwd;
      entry.thisWeekBill      += c.totalBill;
      entry.thisWeekCollected += c.amountPaid;
    });

    // ── KHET SOURCE ───────────────────────────────────────────────────────
    const khetCustMap = {};
    khetOrders.forEach(o => {
      const key = `${(o.customerName || 'Unknown').trim()}|${(o.customerPhone || '').trim()}`;
      const name = (o.customerName || 'Unknown').trim();
      const amt  = Number(o.grandTotal) || Number(o.totalAmount) || 0;
      if (!khetCustMap[key]) khetCustMap[key] = { name, customerPhone: (o.customerPhone || '').trim(), totalBill: 0, amountPaid: 0 };
      khetCustMap[key].totalBill += amt;
    });

    const khetCarryForwardMap = await getKhetCarryForwardMap(start);

    // Add customers with carry-forward but NO orders this period
    Object.entries(khetCarryForwardMap).forEach(([key, carry]) => {
      if (carry <= 0 || khetCustMap[key]) return;
      const [name, phone] = key.split('|');
      khetCustMap[key] = { name: name || 'Unknown', customerPhone: phone || '', totalBill: 0, amountPaid: 0 };
    });

    // Add payments — exact key match first, then name-only fallback
    khetPeriodPayments.forEach(p => {
      const pName    = (p.customerName || '').trim().toLowerCase();
      const pPhone   = (p.customerPhone || '').trim();
      const exactKey = `${(p.customerName || '').trim()}|${pPhone}`;

      if (khetCustMap[exactKey]) {
        khetCustMap[exactKey].amountPaid += (Number(p.amountPaid) || 0);
      } else {
        const fallbackKey = Object.keys(khetCustMap).find(k =>
            k.split('|')[0].toLowerCase() === pName
        );
        if (fallbackKey) khetCustMap[fallbackKey].amountPaid += (Number(p.amountPaid) || 0);
      }
    });

    Object.entries(khetCustMap).forEach(([key, c]) => {
      const carryFwd  = khetCarryForwardMap[key] || 0;
      const remaining = Math.max(0, carryFwd + c.totalBill - c.amountPaid);
      if (remaining <= 0) return;
      const matchId = [...activeCustomerMap.entries()].find(([, name]) =>
          name.trim().toLowerCase() === c.name.toLowerCase()
      )?.[0];
      const mapKey = matchId || ('khet__' + key);
      const entry  = getOrCreate(mapKey, matchId ? activeCustomerMap.get(matchId) : c.name);
      entry.sources.push({
        source:          'Khet',
        totalBill:       c.totalBill,
        amountPaid:      c.amountPaid,
        remaining:       remaining,
        prevOutstanding: carryFwd,
        orders:          khetOrdersMap[key] || [],
      });
      entry.totalBill         += c.totalBill;
      entry.amountPaid        += c.amountPaid;
      entry.prevOutstanding   += carryFwd;
      entry.thisWeekBill      += c.totalBill;
      entry.thisWeekCollected += c.amountPaid;
    });

    // ── SITE B SOURCE ─────────────────────────────────────────────────────────
    const activeSiteBIds = SiteB
        ? new Set((await SiteB.find({ isActive: { $ne: false } }).select('_id').lean()).map(s => s._id.toString()))
        : null;

    const siteBNameMap = {};
    siteBPayDocs.forEach(p => {
      const id = p.siteB?._id?.toString() || p.siteB?.toString();
      if (id && p.siteB?.customerName) siteBNameMap[id] = p.siteB.customerName;
    });

    const siteBCustMap = {};
    siteBOrdersRaw
        .filter(o => o.siteB !== null)
        .forEach(o => {
          const siteBId = o.siteB?._id?.toString() || o.siteB?.toString();
          if (!siteBId) return;
          if (activeSiteBIds && !activeSiteBIds.has(siteBId)) return;
          const name = (siteBNameMap[siteBId] || o.siteB?.customerName || 'Unknown Site B Customer').trim();
          const amt  = Number(o.amountForCustomer) || 0;
          if (!siteBCustMap[siteBId]) siteBCustMap[siteBId] = { siteBId, name, totalBill: 0, amountPaid: 0 };
          siteBCustMap[siteBId].totalBill += amt;
        });

    siteBPayDocs
        .filter(p => p.paymentFor === 'customer')
        .forEach(p => {
          const siteBId = p.siteB?._id?.toString() || p.siteB?.toString();
          if (!siteBId || !siteBCustMap[siteBId]) return;
          siteBCustMap[siteBId].amountPaid += (Number(p.amountPaid) || 0);
        });

    const { carryMap: siteBCarryForwardMap, nameMap: siteBCarryNameMap } = await getSiteBCarryForwardMap(start);
    Object.entries(siteBCarryNameMap).forEach(([id, name]) => {
      if (!siteBNameMap[id]) siteBNameMap[id] = name;
    });

    Object.entries(siteBCarryForwardMap).forEach(([siteBId, carry]) => {
      if (carry <= 0 || siteBCustMap[siteBId]) return;
      if (activeSiteBIds && !activeSiteBIds.has(siteBId)) return;
      const name = siteBNameMap[siteBId] || 'Unknown Site B Customer';
      siteBCustMap[siteBId] = { siteBId, name, totalBill: 0, amountPaid: 0 };
    });

    const siteBReceivableList = [];
    Object.entries(siteBCustMap).forEach(([siteBId, c]) => {
      const carryFwd  = siteBCarryForwardMap[siteBId] || 0;
      const remaining = Math.max(0, carryFwd + c.totalBill - c.amountPaid);
      if (remaining > 0) {
        siteBReceivableList.push({
          name: c.name, totalBill: c.totalBill, amountPaid: c.amountPaid,
          carryForward: carryFwd, remaining, orders: siteBOrdersMap[siteBId] || [],
        });
      }
      if (remaining <= 0 && c.totalBill <= 0 && carryFwd <= 0) return;
      const mapKey = 'siteb__' + siteBId;
      const entry  = getOrCreate(mapKey, c.name);
      entry.sources.push({
        source:          'Site B',
        totalBill:       c.totalBill,
        amountPaid:      c.amountPaid,
        remaining:       Math.max(0, c.totalBill - c.amountPaid),
        prevOutstanding: carryFwd,
        orders:          siteBOrdersMap[siteBId] || [],
      });
      entry.totalBill         += c.totalBill;
      entry.amountPaid        += c.amountPaid;
      entry.prevOutstanding   += carryFwd;
      entry.thisWeekBill      += c.totalBill;
      entry.thisWeekCollected += c.amountPaid;
    });
    const siteBYetToReceive = siteBReceivableList.reduce((s, p) => s + p.remaining, 0);

    // ── FINALIZE ──────────────────────────────────────────────────────────
    const mergedCustomers = Object.values(unifiedMap)
        .map(c => ({ ...c, remaining: Math.max(0, c.prevOutstanding + c.totalBill - c.amountPaid) }))
        .filter(c => c.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining);

    const totalYetToReceive = mergedCustomers.reduce((s, c) => s + c.remaining, 0);

    const billingBreakdown = Object.entries(custDeliveryMap)
        .map(([cid, c]) => {
          const rawCarryFwd    = billingCarryForwardMap[cid] || 0;
          const isPaid         = paidCustomerIds.has(cid);
          const trueRemaining  = Math.max(0, rawCarryFwd + c.totalBill - c.amountPaid);
          const effectivelyPaid = isPaid && trueRemaining <= 0;
          const carryFwd  = effectivelyPaid ? 0 : rawCarryFwd;
          const remaining = effectivelyPaid ? 0 : trueRemaining;
          return { ...c, carryForward: carryFwd, remaining };
        })
        .filter(c => c.remaining > 0);
    const billingYetToReceive = billingBreakdown.reduce((s, c) => s + c.remaining, 0);

    const khetBreakdown = Object.values(khetCustMap)
        .map(c => {
          const key      = `${c.name}|${c.customerPhone || ''}`;
          const carryFwd = khetCarryForwardMap[key] || 0;
          return { ...c, carryForward: carryFwd, remaining: Math.max(0, carryFwd + c.totalBill - c.amountPaid) };
        })
        .filter(c => c.remaining > 0);
    const khetYetToReceive = khetBreakdown.reduce((s, c) => s + c.remaining, 0);

    res.json({
      period: { type: type || 'weekly', start, end },
      income: {
        total:   totalIncome,
        billing: { label: 'Billing Collections', amount: billingTotal,     icon: '📄' },
        khet:    { label: 'Khet Collections',     amount: khetTotal,        icon: '🚜' },
        siteB:   { label: 'Site B Collections',   amount: siteBIncomeTotal, icon: '🏢' },
      },
      expenses: {
        total:                 totalExpenses,
        material:              { label: 'Material Purchases',      amount: materialCost,          icon: '📦' },
        ownVehicle:            { label: 'Own Vehicle Expenses',     amount: vehicleTotal,          icon: '🚛', breakdown: { Diesel: diesel, Maintenance: maint, Others: otherV } },
        ownPoklandDiesel:      { label: 'Own Pokland Diesel',       amount: ownPoklandDiesel,      icon: '⛽' },
        ownPoklandMaintenance: { label: 'Own Pokland Maintenance',  amount: ownPoklandMaintenance, icon: '🔧' },
        rentalVehicle:         { label: 'Rental Vehicle Payments',  amount: rentalVehicleTotal,    icon: '📋' },
        rentalPokland:         { label: 'Rental Pokland Payments',  amount: poklandRentalCost,     icon: '🏗️' },
        operator:              { label: 'Operator Wages',           amount: operatorCost,          icon: '🦺' },
        staff:                 { label: 'Staff Wages & Advance',    amount: staffTotal,            icon: '👷', breakdown: { Wages: staffWages, Advance: staffAdv } },
        siteB:                 { label: 'Site B Owner Payments',    amount: siteBExpenseTotal,     icon: '🏢' },
      },
      netProfit,
      profitMargin: totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '0.0',
      pending: {
        yetToReceive: {
          total:           totalYetToReceive,
          mergedCustomers,
          billing: { label: 'Billing (Outstanding)', amount: billingYetToReceive, icon: '📄', customers: billingBreakdown },
          khet:    { label: 'Khet (Outstanding)',    amount: khetYetToReceive,    icon: '🚜', customers: khetBreakdown },
          siteB:   { label: 'Site B (Outstanding)',  amount: siteBYetToReceive,   icon: '🏢', customers: siteBReceivableList },
        },
      },
    });

  } catch (err) {
    console.error('❌ P&L Error:', err);
    res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
});

module.exports = router;