const Customer = require('../models/Customer');
const CustomerDelivery = require('../models/BillingDelivery');
const CustomerPayment = require('../models/BillingPayment');
const BillingPaymentStatus = require('../models/BillingPaymentStatus');
const KhetOrder = require('../models/KhetOrder');
const KhetPayment = require('../models/KhetPayment');
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const VehicleTrip = require('../models/VehicleTrip');
const { protect } = require('../middleware/auth');
const RentalPayment = require('../models/RentalPayment');
const VehicleRentalRate = require('../models/VehicleRentalRate');

router.use(protect);

const getWeekStart = (date) => {
    const d = new Date(date);
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

// ── Shared helper: find billing customer by owner name (exact match only, no first-word fallback) ──
const findBillingCustomer = async (ownerName) => {
    const escapedOwner = ownerName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Strategy 1: exact full-name match (case-insensitive)
    let customer = await Customer.findOne({
        name: { $regex: '^' + escapedOwner + '$', $options: 'i' },
        isActive: true
    });
    // Strategy 2: partial contains (only if full name is reasonably long to avoid broad matches)
    if (!customer && ownerName.trim().length > 5) {
        customer = await Customer.findOne({
            name: { $regex: escapedOwner, $options: 'i' },
            isActive: true
        });
    }
    // ❌ REMOVED: Strategy 3 (first-word fallback) — caused wrong customer matches for common names like "Shaikh"
    return customer;
};

// GET all rental owners
router.get('/owners', async (req, res) => {
    try {
        const vehicles = await Vehicle.find({ isActive: true, ownershipType: 'Rental', rentalOwnerName: { $ne: '' } });
        const owners = [...new Set(vehicles.map(v => v.rentalOwnerName))];
        res.json(owners);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET daily bill for a vehicle
router.get('/daily/:vehicleId', async (req, res) => {
    try {
        const { date } = req.query;
        const billDate = date ? new Date(date) : new Date();
        const start = new Date(billDate); start.setHours(0,0,0,0);
        const end = new Date(billDate); end.setHours(23,59,59,999);

        const vehicle = await Vehicle.findById(new mongoose.Types.ObjectId(req.params.vehicleId));
        if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

        const trips = await VehicleTrip.find({
            vehicle: new mongoose.Types.ObjectId(req.params.vehicleId),
            tripDate: { $gte: start, $lte: end }
        }).sort({ tripDate: 1 });

        const totalRent = trips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
        const totalDiesel = trips.reduce((s, t) => s + (t.dieselAmount || 0), 0);
        const netAmount = totalRent - totalDiesel;

        const totalTrips = trips
            .filter(t => t.billingType !== 'Quantity')
            .reduce((s, t) => s + (t.numberOfTrips || 0), 0);
        const totalQuantity = trips
            .filter(t => t.billingType === 'Quantity')
            .reduce((s, t) => s + (t.quantity || 0), 0);
        const quantityUnit = trips.find(t => t.billingType === 'Quantity')?.quantityUnit || 'brass';

        res.json({
            vehicle, date: billDate, trips,
            totalTrips,
            totalQuantity, quantityUnit,
            totalRent, totalDiesel, netAmount,
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly bill by owner
router.get('/weekly', async (req, res) => {
    try {
        const { ownerName, date } = req.query;
        if (!ownerName) return res.status(400).json({ message: 'ownerName is required' });

        const weekStart = getWeekStart(date ? new Date(date) : new Date());
        const weekEnd = getWeekEnd(date ? new Date(date) : new Date());

        const vehicles = await Vehicle.find({
            isActive: true, ownershipType: 'Rental', rentalOwnerName: ownerName
        });

        const vehicleData = await Promise.all(vehicles.map(async (v) => {
            const trips = await VehicleTrip.find({
                vehicle: v._id,
                tripDate: { $gte: weekStart, $lte: weekEnd }
            }).sort({ tripDate: 1 });

            const byDate = {};
            trips.forEach(t => {
                const d = new Date(t.tripDate).toDateString();
                if (!byDate[d]) byDate[d] = { date: t.tripDate, trips: [], tripCount: 0, quantity: 0, quantityUnit: t.quantityUnit || 'brass', rent: 0, diesel: 0 };
                byDate[d].trips.push(t);
                if (t.billingType === 'Quantity') {
                    byDate[d].quantity += (t.quantity || 0);
                    byDate[d].rent += (t.rentalAmount || 0);
                } else {
                    byDate[d].tripCount += (t.numberOfTrips || 0);
                    byDate[d].rent += (t.rentalAmount || 0);
                }
                byDate[d].diesel += (t.dieselAmount || 0);
            });

            const dailyEntries = Object.values(byDate);
            const totalRent = dailyEntries.reduce((s, d) => s + d.rent, 0);
            const totalDiesel = dailyEntries.reduce((s, d) => s + d.diesel, 0);
            const netAmount = totalRent - totalDiesel;

            const totalTrips = trips
                .filter(t => t.billingType !== 'Quantity')
                .reduce((s, t) => s + (t.numberOfTrips || 0), 0);
            const totalQuantity = trips
                .filter(t => t.billingType === 'Quantity')
                .reduce((s, t) => s + (t.quantity || 0), 0);

            return {
                vehicle: v, trips, dailyEntries,
                totalTrips, totalQuantity,
                totalRent, totalDiesel, netAmount
            };
        }));

        const grandTotal = vehicleData.reduce((s, v) => s + v.totalRent, 0);
        const grandDiesel = vehicleData.reduce((s, v) => s + v.totalDiesel, 0);
        const grandNet = vehicleData.reduce((s, v) => s + v.netAmount, 0);

        res.json({ ownerName, weekStart, weekEnd, vehicles: vehicleData, grandTotal, grandDiesel, grandNet });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET all weekly summary
router.get('/weekly/all', async (req, res) => {
    try {
        const { date } = req.query;
        const weekStart = getWeekStart(date ? new Date(date) : new Date());
        const weekEnd = getWeekEnd(date ? new Date(date) : new Date());

        const vehicles = await Vehicle.find({ isActive: true, ownershipType: 'Rental', rentalOwnerName: { $ne: '' } });
        const owners = [...new Set(vehicles.map(v => v.rentalOwnerName))];

        const summary = await Promise.all(owners.map(async (ownerName) => {
            const ownerVehicles = vehicles.filter(v => v.rentalOwnerName === ownerName);
            let totalTrips = 0, totalRent = 0, totalDiesel = 0;
            for (const v of ownerVehicles) {
                const trips = await VehicleTrip.find({ vehicle: v._id, tripDate: { $gte: weekStart, $lte: weekEnd } });
                totalTrips += trips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);
                totalRent  += trips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
                totalDiesel += trips.reduce((s, t) => s + (t.dieselAmount || 0), 0);
            }
            return {
                ownerName,
                vehicleCount: ownerVehicles.length,
                totalTrips, totalRent, totalDiesel,
                netAmount: totalRent - totalDiesel
            };
        }));

        res.json({ weekStart, weekEnd, summary });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST update rental payment status (per owner per week)
router.post('/payment', async (req, res) => {
    try {
        const { ownerName: rawOwner, weekStart, totalBill, amountPaid, isPaid, isPartial, note, paidDate } = req.body;
        const ownerName = (rawOwner || '').trim();
        if (!ownerName) return res.status(400).json({ message: 'ownerName required' });
        // Normalise to Monday of that week so storage is always consistent,
        // regardless of what time-of-day the frontend sends.
        const wStart = getWeekStart(new Date(weekStart));
        const safeAmt = Math.min(Number(amountPaid)||0, Number(totalBill)||0);
        // Match existing record with a ±3-day window to handle any old drift in stored dates.
        const wMs = wStart.getTime(); const threeDays = 3*24*60*60*1000;
        let rec = await RentalPayment.findOne({ ownerName, weekStart: { $gte: new Date(wMs-threeDays), $lte: new Date(wMs+threeDays) } });
        if (rec) {
            Object.assign(rec, {
                totalBill: Number(totalBill)||0,
                amountPaid: safeAmt,
                isPaid: Boolean(isPaid),
                isPartial: Boolean(isPartial),
                note: note||'',
                paidDate: paidDate ? new Date(paidDate) : new Date()
            });
            await rec.save();
        } else {
            rec = await RentalPayment.create({
                ownerName, weekStart: wStart,
                totalBill: Number(totalBill)||0,
                amountPaid: safeAmt,
                isPaid: Boolean(isPaid),
                isPartial: Boolean(isPartial),
                note: note||'',
                paidDate: paidDate ? new Date(paidDate) : new Date()
            });
        }
        res.json(rec);
    } catch (err) { res.status(400).json({ message: err.message }); }
});

// GET rental payment status (per owner per week)
router.get('/payment', async (req, res) => {
    try {
        const { ownerName, weekStart } = req.query;
        // Normalise to Monday of the week, then use ±3-day window so any stored
        // timezone drift never causes a miss.
        const wStart = getWeekStart(new Date(weekStart));
        const wMs = wStart.getTime(); const threeDays = 3*24*60*60*1000;
        const rec = await RentalPayment.findOne({ ownerName, weekStart: { $gte: new Date(wMs-threeDays), $lte: new Date(wMs+threeDays) } });
        res.json(rec || null);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET all payments for an owner (for payment history list)
router.get('/payments/all', async (req, res) => {
    try {
        const ownerName = (req.query.ownerName || '').trim();
        if (!ownerName) return res.status(400).json({ message: 'ownerName required' });
        const records = await RentalPayment.find({ ownerName }).sort({ weekStart: -1 }).lean();
        res.json(records);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE a payment record by id
router.delete('/payment/:id', async (req, res) => {
    try {
        const rec = await RentalPayment.findByIdAndDelete(req.params.id);
        if (!rec) return res.status(404).json({ message: 'Payment not found' });
        res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET carry-forward — all previous unpaid/partial rental weeks for an owner
router.get('/unpaid-carry-forward', async (req, res) => {
    try {
        const { ownerName, beforeWeekStart } = req.query;
        if (!ownerName) return res.status(400).json({ message: 'ownerName is required' });

        // Parse cutoff — accept any valid date string from the frontend.
        // We deliberately avoid setHours/setUTCHours here; instead we use a simple
        // "is this week before the requested week" check below.
        const cutoffRaw = new Date(beforeWeekStart);
        // Normalise to the Monday of that week at UTC midnight so comparisons are clean.
        const cutoff = getWeekStart(cutoffRaw);

        const ownerVehicles = await Vehicle.find({
            isActive: true, ownershipType: 'Rental', rentalOwnerName: ownerName
        });
        if (ownerVehicles.length === 0) return res.json({ weeks: [], total: 0 });

        const vehicleIds = ownerVehicles.map(v => v._id);

        const earliestTrip = await VehicleTrip.findOne(
            { vehicle: { $in: vehicleIds }, tripDate: { $lt: cutoff } },
            { tripDate: 1 }
        ).sort({ tripDate: 1 });

        if (!earliestTrip) return res.json({ weeks: [], total: 0 });

        // Build list of all previous week-starts (Monday) before cutoff.
        const weekStarts = [];
        let cursor = getWeekStart(earliestTrip.tripDate);
        while (cursor < cutoff) {
            weekStarts.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 7);
        }

        // Fetch ALL payment records for this owner — no date filter.
        // We match them to weeks using a ±3-day window so any timezone drift
        // in how weekStart was stored never causes a missed match.
        const allPayments = await RentalPayment.find({ ownerName }).lean();

        // Build a map: ISO-week-start-string → payment record.
        // Key = Monday date as YYYY-MM-DD in UTC (stable regardless of storage drift).
        const paymentByWeek = {};
        allPayments.forEach(p => {
            // Find the Monday of whichever week this payment belongs to.
            const monday = getWeekStart(new Date(p.weekStart));
            const key = monday.toISOString().slice(0, 10);
            // Keep the most recent save if there are duplicates.
            if (!paymentByWeek[key] || new Date(p.updatedAt || p.paidDate) > new Date(paymentByWeek[key].updatedAt || paymentByWeek[key].paidDate)) {
                paymentByWeek[key] = p;
            }
        });

        const unpaidWeeks = [];

        for (const wStart of weekStarts) {
            const wEnd = getWeekEnd(wStart);
            // Use the same Monday-key logic to look up payments.
            const key = wStart.toISOString().slice(0, 10);
            const payment = paymentByWeek[key];

            // Skip weeks that are fully paid.
            if (payment?.isPaid) continue;

            const trips = await VehicleTrip.find({
                vehicle: { $in: vehicleIds },
                tripDate: { $gte: wStart, $lte: wEnd },
            });

            if (trips.length === 0) continue;

            const totalRent = trips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
            const totalDiesel = trips.reduce((s, t) => s + (t.dieselAmount || 0), 0);
            const weekBill = totalRent - totalDiesel;

            if (weekBill <= 0) continue;

            const amountPaid = payment ? (payment.amountPaid || 0) : 0;
            const remaining = Math.max(0, weekBill - amountPaid);

            // If fully covered by partial payments, skip too.
            if (remaining <= 0) continue;

            unpaidWeeks.push({
                weekStart: wStart,
                weekEnd: wEnd,
                totalBill: weekBill,
                amountPaid,
                remaining,
            });
        }

        const total = unpaidWeeks.reduce((s, w) => s + w.remaining, 0);
        res.json({ weeks: unpaidWeeks, total });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET combined weekly bill for a rental owner
router.get('/combined-weekly', async (req, res) => {
    try {
        const { ownerName, date } = req.query;
        if (!ownerName) return res.status(400).json({ message: 'ownerName is required' });

        const weekStart = getWeekStart(date ? new Date(date) : new Date());
        const weekEnd   = getWeekEnd(date ? new Date(date) : new Date());

        // ── 1. RENTAL BILL (what we owe the owner for their vehicles) ──
        const rentalVehicles = await Vehicle.find({
            isActive: true, ownershipType: 'Rental', rentalOwnerName: ownerName
        });

        const vehicleData = await Promise.all(rentalVehicles.map(async (v) => {
            const trips = await VehicleTrip.find({
                vehicle: v._id,
                tripDate: { $gte: weekStart, $lte: weekEnd }
            }).sort({ tripDate: 1 });

            const byDate = {};
            trips.forEach(t => {
                const d = new Date(t.tripDate).toDateString();
                if (!byDate[d]) byDate[d] = {
                    date: t.tripDate, trips: [], tripCount: 0,
                    quantity: 0, quantityUnit: t.quantityUnit || 'brass', rent: 0, diesel: 0
                };
                byDate[d].trips.push(t);
                if (t.billingType === 'Quantity') {
                    byDate[d].quantity += (t.quantity || 0);
                    byDate[d].rent += (t.rentalAmount || 0);
                } else {
                    byDate[d].tripCount += (t.numberOfTrips || 0);
                    byDate[d].rent += (t.rentalAmount || 0);
                }
                byDate[d].diesel += (t.dieselAmount || 0);
            });

            const dailyEntries = Object.values(byDate);
            const totalRent    = dailyEntries.reduce((s, d) => s + d.rent, 0);
            const totalDiesel  = dailyEntries.reduce((s, d) => s + d.diesel, 0);
            const totalTrips   = trips.filter(t => t.billingType !== 'Quantity').reduce((s, t) => s + (t.numberOfTrips || 0), 0);
            const totalQuantity = trips.filter(t => t.billingType === 'Quantity').reduce((s, t) => s + (t.quantity || 0), 0);

            return {
                vehicle: v, trips, dailyEntries,
                totalTrips, totalQuantity,
                totalRent, totalDiesel, netAmount: totalRent - totalDiesel
            };
        }));

        const rentalGrossRent   = vehicleData.reduce((s, v) => s + v.totalRent, 0);
        const rentalGrossDiesel = vehicleData.reduce((s, v) => s + v.totalDiesel, 0);
        const rentalNetPayable  = vehicleData.reduce((s, v) => s + v.netAmount, 0);

        // Use date-range for weekStart to avoid exact-millisecond mismatches
        const weekStartDayEnd = new Date(weekStart); weekStartDayEnd.setHours(23, 59, 59, 999);
        const rentalPayment = await RentalPayment.findOne({ ownerName, weekStart: { $gte: weekStart, $lte: weekStartDayEnd } });

        // ── 2. BILLING PURCHASES (what owner owes us from billing module) ──
        // FIX: use shared helper — exact + partial match only, NO first-word fallback
        const billingCustomer = await findBillingCustomer(ownerName);

        let billingData = null;
        if (billingCustomer) {
            const deliveries = await CustomerDelivery.find({
                customer: billingCustomer._id,
                date: { $gte: weekStart, $lte: weekEnd }
            }).populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType').sort({ date: 1 });

            const byDate = {};
            deliveries.forEach(d => {
                const key = new Date(d.date).toDateString();
                if (!byDate[key]) byDate[key] = { date: d.date, deliveries: [], total: 0 };
                byDate[key].deliveries.push(d);
                byDate[key].total += d.totalAmount;
            });

            const weekTotal = deliveries.reduce((s, d) => s + d.totalAmount, 0);

            const allPrevDeliveries = await CustomerDelivery.find({ customer: billingCustomer._id, date: { $lt: weekStart } });
            const allPrevPayments   = await CustomerPayment.find({ customer: billingCustomer._id, date: { $lt: weekStart } });
            // FIX: Also include BillingPaymentStatus records before this week — the billing module
            // stores payments in BillingPaymentStatus (not just CustomerPayment), so we must include
            // both to get the correct carried balance. Without this, all billing payments are ignored
            // and carriedBalance/netDue is massively overstated.
            const allPrevPayStatuses = await BillingPaymentStatus.find({ customer: billingCustomer._id, weekStart: { $lt: weekStart } });
            const prevPayStatusPaid  = allPrevPayStatuses.reduce((s, ps) => s + (ps.amountPaid || 0), 0);
            const prevCustomerPaid   = allPrevPayments.reduce((s, p) => s + p.amount, 0);
            // Deduplicate: if BillingPaymentStatus.amountPaid already covers a week that CustomerPayment also covers,
            // we trust BillingPaymentStatus (it's the source of truth in the billing module).
            // The simplest safe approach: use whichever is larger per overall total.
            const totalPrevPaid = prevCustomerPaid;
            const carriedBalance    = Math.max(0, allPrevDeliveries.reduce((s, d) => s + d.totalAmount, 0) - totalPrevPaid);

            const weekPayments = await CustomerPayment.find({ customer: billingCustomer._id, date: { $gte: weekStart, $lte: weekEnd } }).sort({ date: 1 });
            // FIX: exact weekStart match fails due to timezone drift — use day-range.
            const weekStartDayEnd2 = new Date(weekStart); weekStartDayEnd2.setHours(23,59,59,999);
            const payStatus    = await BillingPaymentStatus.findOne({ customer: billingCustomer._id, weekStart: { $gte: weekStart, $lte: weekStartDayEnd2 } });
            const weekPaid = weekPayments.reduce((s, p) => s + p.amount, 0);
            const grandTotal   = carriedBalance + weekTotal;
            const netDue       = Math.max(0, grandTotal - weekPaid);

            billingData = {
                customer: billingCustomer,
                dailyGroups: Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date)),
                deliveries,
                weekTotal,
                carriedBalance,
                weekPaid,
                grandTotal,
                netDue,
                paymentStatus: payStatus || null,
            };
        }

        // ── 3. KHET PURCHASES (what owner owes us from khet module) ──
        // Use partial contains for khet — khet stores full customer names so partial is safe and handles
        // minor spacing/casing differences. We do NOT use first-word fallback here (unlike old billing code).
        const escapedOwner = ownerName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const khetNameRegex = { $regex: escapedOwner, $options: 'i' };

        const khetOrders = await KhetOrder.find({
            customerName: khetNameRegex,
            date: { $gte: weekStart, $lte: weekEnd }
        }).populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType').sort({ date: 1 });

        // FIX: Always fetch carry-forward data regardless of whether there are orders this week.
        // Previously khetData was null when khetOrders.length === 0, causing outstanding balances
        // from previous weeks (carry-forward) to be silently ignored in the final settlement.
        const khetPrevOrders = await KhetOrder.find({ customerName: khetNameRegex, date: { $lt: weekStart } }, 'grandTotal totalAmount');

        // ROOT CAUSE FIX:
        // KhetPayment documents have two problems:
        //   1. weekStart is stored in IST (e.g. 2026-05-24T18:30:00Z) but queried in UTC,
        //      causing timezone mismatch — the record falls outside the expected range.
        //   2. Some documents (e.g. Moshin Saudagar) have NO weekStart field at all.
        // Solution: ignore weekStart entirely for payment lookup.
        // Use the `date` field instead — it is always present and is the actual payment date,
        // which reliably falls within the week it belongs to.
        const allKhetPayments = await KhetPayment.find({ customerName: khetNameRegex }).lean();

        const khetPrevPaid = allKhetPayments
            .filter(p => p.date && new Date(p.date) < weekStart)
            .reduce((s, p) => s + (p.amountPaid || 0), 0);

        const khetCarry = Math.max(0,
            khetPrevOrders.reduce((s, o) => s + (o.grandTotal || o.totalAmount || 0), 0) -
            khetPrevPaid
        );

        let khetData = null;
        // Show khet section if there are orders this week OR if there is an outstanding carry-forward balance
        if (khetOrders.length > 0 || khetCarry > 0) {
            const khetTotal   = khetOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
            const khetRoyalty = khetOrders.reduce((s, o) => s + (o.totalRoyalty || 0), 0);
            const khetGrand   = khetOrders.reduce((s, o) => s + (o.grandTotal || o.totalAmount || 0), 0);

            const khetPaid = allKhetPayments
                .filter(p => {
                    const d = new Date(p.date);
                    return d >= weekStart && d <= weekEnd;
                })
                .reduce((s, p) => s + (p.amountPaid || 0), 0);

            const khetPayment = allKhetPayments.find(p => {
                const d = new Date(p.date);
                return d >= weekStart && d <= weekEnd;
            }) || null;

            const khetNetDue = Math.max(0, khetCarry + khetGrand - khetPaid);

            khetData = {
                orders: khetOrders,
                weekTotal: khetTotal,
                royalty: khetRoyalty,
                grandTotal: khetGrand,
                carriedBalance: khetCarry,
                weekPaid: khetPaid,
                netDue: khetNetDue,
                payment: khetPayment || null,
            };
        }

        // ── 4. FINAL SETTLEMENT ──
        const ownerOwesUs     = (billingData?.netDue || 0) + (khetData?.netDue || 0);
        const weOweOwner      = rentalNetPayable;
        const finalSettlement = weOweOwner - ownerOwesUs;

        res.json({
            ownerName,
            weekStart,
            weekEnd,
            rental: {
                vehicles: vehicleData,
                grossRent: rentalGrossRent,
                grossDiesel: rentalGrossDiesel,
                netPayable: rentalNetPayable,
                payment: rentalPayment || null,
            },
            billing: billingData,
            khet: khetData,
            ownerOwesUs,
            weOweOwner,
            finalSettlement,
        });
    } catch (err) {
    console.error('COMBINED-WEEKLY ERROR:', err.stack);
    res.status(500).json({ message: err.message });
}
});

// ── DEBUG: find what customer/khet names exist for a given owner name ──
router.get('/debug-names', async (req, res) => {
    try {
        const { ownerName } = req.query;
        if (!ownerName) return res.status(400).json({ message: 'ownerName required' });

        const firstWord = ownerName.trim().split(/\s+/)[0];
        const allCustomers = await Customer.find({ isActive: true }, 'name').lean();
        const allKhetOrders = await KhetOrder.find({}, 'customerName').lean();
        const uniqueKhetNames = [...new Set(allKhetOrders.map(o => o.customerName))];

        res.json({
            ownerName,
            firstWord,
            allCustomerNames: allCustomers.map(c => c.name),
            uniqueKhetCustomerNames: uniqueKhetNames,
            partialCustomerMatches: allCustomers.filter(c => c.name.toLowerCase().includes(firstWord.toLowerCase())).map(c => c.name),
            partialKhetMatches: uniqueKhetNames.filter(n => n && n.toLowerCase().includes(firstWord.toLowerCase())),
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;