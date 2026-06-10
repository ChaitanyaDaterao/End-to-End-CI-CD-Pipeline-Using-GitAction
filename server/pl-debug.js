// ─── P&L DEBUG ROUTER ─────────────────────────────────────────────────────────
// Mount this temporarily in your app, e.g.:
//   const plDebug = require('./routes/pl-debug');
//   app.use('/api/pl-debug', plDebug);
//
// Then hit these endpoints in the browser or Postman to diagnose carry-forward.
// REMOVE from production once the issue is resolved.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');

const KhetOrder   = require('../models/KhetOrder');
const KhetPayment = require('../models/KhetPayment');

router.use(protect);

const IST_MS = 5.5 * 60 * 60 * 1000;

const toIST = (d) => new Date(new Date(d).getTime() + IST_MS);
const toISTDateInt = (d) => {
  const ist = toIST(d);
  return ist.getUTCFullYear() * 10000 + (ist.getUTCMonth() + 1) * 100 + ist.getUTCDate();
};
const fmtIST = (d) => {
  if (!d) return null;
  const ist = toIST(d);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pl-debug/schema
// Shows the actual field names and sample values from KhetOrder and KhetPayment.
// This tells us WHICH amount field to use and WHICH date field payments store.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/schema', async (req, res) => {
  try {
    const [orderSample, paymentSample] = await Promise.all([
      KhetOrder.findOne().lean(),
      KhetPayment.findOne().lean(),
    ]);

    const [orderCount, paymentCount] = await Promise.all([
      KhetOrder.countDocuments(),
      KhetPayment.countDocuments(),
    ]);

    const analyzeDoc = (doc) => {
      if (!doc) return null;
      const result = {};
      for (const [k, v] of Object.entries(doc)) {
        result[k] = {
          value: v,
          type: Array.isArray(v) ? 'array' : typeof v,
          // flag fields that look like amounts or dates
          looksLikeAmount: typeof v === 'number' && ['amount','total','bill','due','paid','grand'].some(w => k.toLowerCase().includes(w)),
          looksLikeDate:   (v instanceof Date) || (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) || k.toLowerCase().includes('date') || k.toLowerCase().includes('week'),
        };
      }
      return result;
    };

    res.json({
      message: 'Schema inspection — check which fields hold amount and date values',
      KhetOrder: {
        totalDocuments: orderCount,
        sampleFields: analyzeDoc(orderSample),
        amountFieldCandidates: orderSample
          ? Object.entries(orderSample)
              .filter(([k, v]) => typeof v === 'number')
              .map(([k, v]) => ({ field: k, value: v }))
          : [],
        dateFieldCandidates: orderSample
          ? Object.entries(orderSample)
              .filter(([k, v]) => v instanceof Date || k.toLowerCase().includes('date') || k.toLowerCase().includes('week'))
              .map(([k, v]) => ({ field: k, value: v, IST: v ? fmtIST(v) : null }))
          : [],
      },
      KhetPayment: {
        totalDocuments: paymentCount,
        sampleFields: analyzeDoc(paymentSample),
        amountFieldCandidates: paymentSample
          ? Object.entries(paymentSample)
              .filter(([k, v]) => typeof v === 'number')
              .map(([k, v]) => ({ field: k, value: v }))
          : [],
        dateFieldCandidates: paymentSample
          ? Object.entries(paymentSample)
              .filter(([k, v]) => v instanceof Date || k.toLowerCase().includes('date') || k.toLowerCase().includes('week'))
              .map(([k, v]) => ({ field: k, value: v, IST: v ? fmtIST(v) : null }))
          : [],
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pl-debug/customers
// Lists every unique customerName in KhetOrder and KhetPayment,
// flags mismatches (case/spacing differences that prevent matching).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/customers', async (req, res) => {
  try {
    const [orderNames, paymentNames] = await Promise.all([
      KhetOrder.distinct('customerName'),
      KhetPayment.distinct('customerName'),
    ]);

    const orderSet   = new Set(orderNames.map(n => (n||'').trim()));
    const paymentSet = new Set(paymentNames.map(n => (n||'').trim()));

    const onlyInOrders   = [...orderSet].filter(n => !paymentSet.has(n));
    const onlyInPayments = [...paymentSet].filter(n => !orderSet.has(n));
    const inBoth         = [...orderSet].filter(n => paymentSet.has(n));

    // Check for names that are the same when lowercased but differ in casing/spacing
    const caseConflicts = [];
    for (const on of orderSet) {
      for (const pn of paymentSet) {
        if (on !== pn && on.toLowerCase() === pn.toLowerCase()) {
          caseConflicts.push({ inOrders: on, inPayments: pn });
        }
      }
    }

    res.json({
      message: 'Customer name audit — mismatches here mean carry-forward payments are not linked to orders',
      summary: {
        uniqueNamesInOrders:   orderSet.size,
        uniqueNamesInPayments: paymentSet.size,
        matchedNames:          inBoth.length,
        onlyInOrders:          onlyInOrders.length,
        onlyInPayments:        onlyInPayments.length,
        caseConflicts:         caseConflicts.length,
      },
      onlyInOrders,   // customers with orders but no payments — always show carry-forward
      onlyInPayments, // payments that can never be matched to any order
      caseConflicts,  // ← COMMON BUG: "Rocky monga" vs "Rocky Monga"
      inBoth,
    });
  } catch (err) {
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pl-debug/carry?name=CustomerName&from=2026-05-01&to=2026-05-31
// Deep-dives carry-forward for ONE customer against a specific P&L period.
// Shows every order and payment with IST dates and explains the calculation.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/carry', async (req, res) => {
  try {
    const { name, from, to } = req.query;
    if (!name || !from || !to) {
      return res.status(400).json({
        message: 'Pass ?name=CustomerName&from=YYYY-MM-DD&to=YYYY-MM-DD',
        example: '/api/pl-debug/carry?name=Rocky%20Monga&from=2026-05-19&to=2026-05-25',
      });
    }

    // Compute range start in IST (same logic as pl.js getRange)
    const [fy, fm, fd] = from.split('-').map(Number);
    const istMidnightUTC = (y, m, d) =>
      new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_MS);
    const rangeStart = istMidnightUTC(fy, fm - 1, fd);
    const startISTDateInt = toISTDateInt(rangeStart);

    // Fetch all docs for this customer (case-insensitive search)
    const regex = new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const [allOrders, allPayments] = await Promise.all([
      KhetOrder.find({ customerName: regex }).lean(),
      KhetPayment.find({ customerName: regex }).lean(),
    ]);

    // Annotate each doc with its IST date and whether it's before range start
    const annotateDoc = (doc) => {
      const rawDate = doc.date || doc.weekStart || doc.createdAt;
      const idDate  = new Date(parseInt(doc._id.toString().substring(0,8), 16) * 1000);
      const usedDate = rawDate || idDate;
      const istInt  = usedDate ? toISTDateInt(usedDate) : null;
      const isBeforeRange = istInt !== null && istInt < startISTDateInt;
      return {
        _id:          doc._id,
        customerName: doc.customerName,
        // All date fields found on this doc
        date:         doc.date    ? { raw: doc.date,    IST: fmtIST(doc.date) }    : undefined,
        weekStart:    doc.weekStart ? { raw: doc.weekStart, IST: fmtIST(doc.weekStart) } : undefined,
        createdAt:    doc.createdAt ? { raw: doc.createdAt, IST: fmtIST(doc.createdAt) } : undefined,
        _idTimestamp: { raw: idDate, IST: fmtIST(idDate) },
        usedDateIST:  fmtIST(usedDate),
        istDateInt:   istInt,
        isBeforeRange,
        // Amount fields
        grandTotal:   doc.grandTotal,
        totalAmount:  doc.totalAmount,
        amountPaid:   doc.amountPaid,
        amount:       doc.amount,
        // Which amount would pl.js pick?
        resolvedAmount: Number(doc.grandTotal) || Number(doc.totalAmount) || Number(doc.amountPaid) || Number(doc.amount) || 0,
      };
    };

    const annotatedOrders   = allOrders.map(annotateDoc);
    const annotatedPayments = allPayments.map(annotateDoc);

    const prevOrders   = annotatedOrders.filter(o => o.isBeforeRange);
    const prevPayments = annotatedPayments.filter(p => p.isBeforeRange);

    const prevBilled = prevOrders.reduce((s, o) => s + (Number(o.grandTotal) || Number(o.totalAmount) || 0), 0);
    const prevPaid   = prevPayments.reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
    const computedCarry = Math.max(0, prevBilled - prevPaid);

    // Also check: does this customer have ANY orders within the period?
    const [ty2, tm2, td2] = to.split('-').map(Number);
    const rangeEnd = new Date(istMidnightUTC(ty2, tm2 - 1, td2).getTime() + 24*60*60*1000 - 1);
    const endISTDateInt = toISTDateInt(rangeEnd);
    const ordersInPeriod   = annotatedOrders.filter(o => o.istDateInt >= startISTDateInt && o.istDateInt <= endISTDateInt);
    const paymentsInPeriod = annotatedPayments.filter(p => p.istDateInt >= startISTDateInt && p.istDateInt <= endISTDateInt);

    res.json({
      customer: name,
      rangeStart: { UTC: rangeStart, IST: fmtIST(rangeStart), ISTDateInt: startISTDateInt },

      // ── The carry-forward answer ──
      carryForwardCalculation: {
        prevBilled,
        prevPaid,
        computedCarry,
        explanation: `All orders before range: ₹${prevBilled} billed − ₹${prevPaid} paid = ₹${computedCarry} carry-forward`,
      },

      // ── Why it might show 0 in P&L ──
      potentialProblems: {
        noOrdersBeforeRange: prevOrders.length === 0
          ? '⚠️ No orders found before range start — carry-forward will always be 0'
          : `✅ ${prevOrders.length} order(s) found before range`,
        noOrdersInPeriod: ordersInPeriod.length === 0
          ? '⚠️ Customer has NO orders in the selected period — they would be SKIPPED by the old pl.js code (Bug 1). The fix adds them via KhetOrder.distinct(). Make sure the fixed pl.js is deployed.'
          : `✅ ${ordersInPeriod.length} order(s) in period — customer is always included`,
        dateFieldMissing: annotatedOrders.some(o => !o.date && !o.weekStart)
          ? '⚠️ Some orders have no date or weekStart field — falling back to _id timestamp, which may be wrong'
          : '✅ All orders have a date or weekStart field',
        paymentDateFieldMissing: annotatedPayments.some(p => !p.date && !p.weekStart)
          ? '⚠️ Some payments have no date or weekStart — falling back to _id timestamp'
          : '✅ All payments have a date or weekStart field',
        amountFieldMissing: prevOrders.some(o => !o.grandTotal && !o.totalAmount)
          ? '⚠️ Some orders before range have neither grandTotal nor totalAmount — their billed amount is 0'
          : '✅ All prior orders have a recognized amount field',
      },

      // ── Raw data for manual inspection ──
      allOrders:         annotatedOrders,
      allPayments:       annotatedPayments,
      ordersBeforeRange: prevOrders,
      paymentsBeforeRange: prevPayments,
      ordersInPeriod,
      paymentsInPeriod,
    });
  } catch (err) {
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pl-debug/all-carry?from=2026-05-19&to=2026-05-25
// Runs carry-forward for ALL khet customers and shows who gets 0 vs non-zero.
// Quickly spots which customers are broken and why.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all-carry', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({
        message: 'Pass ?from=YYYY-MM-DD&to=YYYY-MM-DD',
        example: '/api/pl-debug/all-carry?from=2026-05-19&to=2026-05-25',
      });
    }

    const [fy, fm, fd] = from.split('-').map(Number);
    const istMidnightUTC = (y, m, d) =>
      new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_MS);
    const rangeStart     = istMidnightUTC(fy, fm - 1, fd);
    const startISTDateInt = toISTDateInt(rangeStart);

    const [ty2, tm2, td2] = to.split('-').map(Number);
    const rangeEnd       = new Date(istMidnightUTC(ty2, tm2 - 1, td2).getTime() + 24*60*60*1000 - 1);
    const endISTDateInt  = toISTDateInt(rangeEnd);

    const allCustomerNames = await KhetOrder.distinct('customerName');

    const getDateInt = (doc) => {
      const raw = doc.date || doc.weekStart || doc.createdAt;
      if (raw) return toISTDateInt(raw);
      if (doc._id) return toISTDateInt(parseInt(doc._id.toString().substring(0,8), 16) * 1000);
      return null;
    };

    const results = await Promise.all(allCustomerNames.map(async (custName) => {
      const [allOrders, allPays] = await Promise.all([
        KhetOrder.find({ customerName: custName }).lean(),
        KhetPayment.find({ customerName: custName }).lean(),
      ]);

      const prevOrders = allOrders.filter(o => { const d = getDateInt(o); return d !== null && d < startISTDateInt; });
      const prevPays   = allPays.filter(p => { const d = getDateInt(p); return d !== null && d < startISTDateInt; });
      const inPeriodOrders = allOrders.filter(o => { const d = getDateInt(o); return d !== null && d >= startISTDateInt && d <= endISTDateInt; });

      const prevBilled = prevOrders.reduce((s, o) => s + (Number(o.grandTotal) || Number(o.totalAmount) || 0), 0);
      const prevPaid   = prevPays.reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
      const carry      = Math.max(0, prevBilled - prevPaid);

      const thisWeekBill    = inPeriodOrders.reduce((s, o) => s + (Number(o.grandTotal) || Number(o.totalAmount) || 0), 0);
      const thisWeekPays    = allPays.filter(p => { const d = getDateInt(p); return d !== null && d >= startISTDateInt && d <= endISTDateInt; });
      const thisWeekCollected = thisWeekPays.reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);
      const remaining       = Math.max(0, carry + thisWeekBill - thisWeekCollected);

      // Diagnose why carry might be 0
      const diagnosis = [];
      if (prevOrders.length === 0 && allOrders.length > 0)
        diagnosis.push('All orders are WITHIN or AFTER range start — nothing to carry forward');
      if (prevOrders.length === 0 && allOrders.length === 0)
        diagnosis.push('No orders at all');
      if (prevBilled > 0 && prevPaid >= prevBilled)
        diagnosis.push(`Fully paid before range (billed ₹${prevBilled}, paid ₹${prevPaid})`);
      if (prevOrders.some(o => !o.grandTotal && !o.totalAmount))
        diagnosis.push('Some prior orders missing grandTotal/totalAmount — amount read as 0');
      if (inPeriodOrders.length === 0)
        diagnosis.push('No orders in period — old pl.js would SKIP this customer entirely (Bug 1)');

      return {
        customerName:    custName,
        carryForward:    carry,
        thisWeekBill,
        thisWeekCollected,
        remaining,
        inPeriodOrders:  inPeriodOrders.length,
        prevOrderCount:  prevOrders.length,
        prevPayCount:    prevPays.length,
        prevBilled,
        prevPaid,
        diagnosis: diagnosis.length ? diagnosis : ['✅ Looks correct'],
      };
    }));

    // Sort: customers with remaining > 0 first
    results.sort((a, b) => b.remaining - a.remaining);

    const withCarry    = results.filter(r => r.carryForward > 0);
    const withoutCarry = results.filter(r => r.carryForward === 0);
    const skippedByOldCode = results.filter(r => r.inPeriodOrders === 0 && r.carryForward > 0);

    res.json({
      period: { from, to, startISTDateInt },
      summary: {
        totalCustomers:     results.length,
        withCarryForward:   withCarry.length,
        withoutCarryForward:withoutCarry.length,
        skippedByOldCode:   skippedByOldCode.length,
        note: skippedByOldCode.length > 0
          ? `⚠️ ${skippedByOldCode.length} customer(s) have carry-forward but NO orders this period — old pl.js dropped them. Fixed pl.js should show them.`
          : '✅ All customers with carry-forward also have orders this period',
      },
      skippedByOldCode,
      withCarryForward:    withCarry,
      withoutCarryForward: withoutCarry,
    });
  } catch (err) {
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

module.exports = router;
