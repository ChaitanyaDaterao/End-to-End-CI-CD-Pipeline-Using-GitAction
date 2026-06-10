const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');

// ── Models ────────────────────────────────────────────────────────────────
const BillingCustomer       = require('../models/BillingCustomer');
const BillingDelivery       = require('../models/BillingDelivery');
const BillingPayment        = require('../models/BillingPayment');
const BillingPaymentStatus  = require('../models/BillingPaymentStatus');
const Vehicle               = require('../models/Vehicle');
const Staff                 = require('../models/Staff');
const VehicleTrip           = require('../models/VehicleTrip');
const StaffAttendance       = require('../models/StaffAttendance');

router.use(protect);

// ── Date helpers ──────────────────────────────────────────────────────────
const parseLocalDate = (str) => {
  if (!str) return new Date();
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // noon — prevents IST→UTC date rollback
};

const weekBounds = (dateStr) => {
  const ref  = parseLocalDate(dateStr);
  const dow  = ref.getDay();
  const start = new Date(ref);
  start.setDate(ref.getDate() - (dow === 0 ? 6 : dow - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const monthBounds = (monthStr) => {
  const [y, m] = String(monthStr).split('-').map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end   = new Date(y, m,     0, 23, 59, 59, 999);
  return { start, end };
};

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/customers', async (req, res) => {
  try {
    const customers = await BillingCustomer.find({ isActive: { $ne: false } }).sort({ name: 1 });
    res.json(customers);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/customers', async (req, res) => {
  try {
    const customer = await BillingCustomer.create(req.body);
    res.status(201).json(customer);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.put('/customers/:id', async (req, res) => {
  try {
    const customer = await BillingCustomer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    await BillingCustomer.findByIdAndUpdate(req.params.id, { isActive: false });
    await BillingDelivery.deleteMany({ customer: req.params.id });
    await BillingPayment.deleteMany({ customer: req.params.id });
    await BillingPaymentStatus.deleteMany({ customer: req.params.id });
    res.json({ message: 'Customer removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Support endpoints ─────────────────────────────────────────────────────

router.get('/order-vehicles', async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ isActive: true }).sort({ vehicleNumber: 1 });
    res.json(vehicles);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find({ isActive: true }).sort({ name: 1 });
    res.json(staff);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERIES
// ═══════════════════════════════════════════════════════════════════════════

router.post('/deliveries', async (req, res) => {
  try {
    const { customerId, date, billingType, quantityUnit, material, destination, note, vehicles: vehicleRows } = req.body;

    const customer = await BillingCustomer.findById(customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const deliveryDate = parseLocalDate(date);

    const vehicleDocs = [];
    for (const row of vehicleRows) {
      const driverId    = row.driver    || row.driverId    || null;
      const conductorId = row.conductor || row.conductorId || null;

      const trips  = Number(row.numberOfTrips) || 0;
      const qty    = Number(row.quantity) || 0;
      const rate   = Number(row.rateApplied) || 0;
      const amount = billingType === 'Trip' ? trips * rate : qty * rate;

      let driverName = row.driverName || '';
      if (!driverName && driverId) {
        const staffDoc = await Staff.findById(driverId);
        driverName = staffDoc?.name || '';
      }

      let conductorName = row.conductorName || '';
      if (!conductorName && conductorId) {
        const staffDoc = await Staff.findById(conductorId);
        conductorName = staffDoc?.name || '';
      }

      vehicleDocs.push({
        vehicle:       row.vehicleId ? new mongoose.Types.ObjectId(row.vehicleId) : null,
        vehicleType:   row.vehicleType || '',
        numberOfTrips: trips,
        quantity:      qty,
        rateApplied:   rate,
        totalAmount:   amount,
        dailyRent:     Number(row.dailyRent) || 0,
        driver:        driverId    ? new mongoose.Types.ObjectId(driverId)    : null,
        conductor:     conductorId ? new mongoose.Types.ObjectId(conductorId) : null,
        driverName,
        conductorName,
      });
    }

    const totalAmount = vehicleDocs.reduce((s, v) => s + v.totalAmount, 0);

    const delivery = await BillingDelivery.create({
      customer:     customerId,
      date:         deliveryDate,
      billingType,
      quantityUnit: quantityUnit || '',
      material:     material || '',
      destination:  destination || '',
      note:         note || '',
      vehicles:     vehicleDocs,
      totalAmount,
    });

    // ── Side-effects: VehicleTrip + StaffAttendance ───────────────────────
    const dayStart = new Date(deliveryDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(deliveryDate); dayEnd.setHours(23, 59, 59, 999);
    // Store at UTC noon — matches the convention used by staff.js manual attendance
    // so that billing-created and manually-created records share the same date value
    const [ay, am, ad] = deliveryDate.toISOString().slice(0,10).split('-').map(Number);
    const attendDate = new Date(Date.UTC(ay, am - 1, ad, 12, 0, 0, 0));

    // Re-aggregate ALL of today's deliveries for accurate per-pair totals
    const allTodayDeliveries = await BillingDelivery.find({
      date: { $gte: dayStart, $lte: dayEnd }
    });

    const pairMap       = {};
    const rentalOnlyMap = {};

    for (const d of allTodayDeliveries) {
      for (const v of d.vehicles) {
        if (!v.vehicle) continue;

        const vTrips     = v.numberOfTrips || 0;
        const vQty       = v.quantity || 0;
        const vDailyRent = Number(v.dailyRent) || 0;
        const rentAmt    = vDailyRent > 0
            ? (d.billingType === 'Quantity' ? vDailyRent * vQty : vDailyRent * vTrips)
            : 0;

        if (v.driver) {
          let ownershipType = v.ownershipType || '';
          if (!ownershipType && v.vehicle) {
            const vDoc = await Vehicle.findById(v.vehicle).select('ownershipType');
            ownershipType = vDoc?.ownershipType || '';
          }
          const key = `${v.vehicle}|${v.driver}`;
          if (!pairMap[key]) {
            pairMap[key] = {
              vehicleId:     v.vehicle,
              driverId:      v.driver,
              conductorId:   v.conductor || null,
              driverName:    v.driverName || '',
              ownershipType,
              trips:         0,
              rent:          0,
              material:      d.material || material || '',
              destination:   d.destination || customer.siteAddress || '',
            };
          }
          pairMap[key].trips += vTrips;
          pairMap[key].rent  += rentAmt;
          if (v.driverName) pairMap[key].driverName = v.driverName;
          if (v.conductor)  pairMap[key].conductorId = v.conductor;

        } else {
          let ownershipType = v.ownershipType || '';
          if (!ownershipType && v.vehicle) {
            const vDoc = await Vehicle.findById(v.vehicle).select('ownershipType');
            ownershipType = vDoc?.ownershipType || '';
          }
          if (ownershipType !== 'Rental') continue;

          const key = String(v.vehicle);
          if (!rentalOnlyMap[key]) {
            rentalOnlyMap[key] = {
              vehicleId:   v.vehicle,
              trips:       0,
              rent:        0,
              material:    d.material || material || '',
              destination: d.destination || customer.siteAddress || '',
            };
          }
          rentalOnlyMap[key].trips += vTrips;
          rentalOnlyMap[key].rent  += rentAmt;
        }
      }
    }

    // ── Write VehicleTrip + StaffAttendance for driver pairs ─────────────
    for (const pair of Object.values(pairMap)) {
      const { vehicleId, driverId, conductorId, driverName, trips, rent } = pair;

      // VehicleTrip
      // FIXED: look up by driverId (ObjectId), not driverName string, to avoid
      // mismatches when driverName is blank or differently spelled on different submissions
      const vtExisting = await VehicleTrip.findOne({
        vehicle:  vehicleId,
        driver:   new mongoose.Types.ObjectId(driverId),
        tripDate: { $gte: dayStart, $lte: dayEnd },
      });
      if (vtExisting) {
        vtExisting.numberOfTrips = trips;
        vtExisting.rentalAmount  = rent;
        vtExisting.driverName    = driverName || vtExisting.driverName;
        await vtExisting.save();
      } else {
        await VehicleTrip.create({
          vehicle:       vehicleId,
          driver:        new mongoose.Types.ObjectId(driverId),
          tripDate:      deliveryDate,
          source:        pair.material,
          destination:   pair.destination,
          numberOfTrips: trips,
          dieselAmount:  0,
          rentalAmount:  rent,
          driverName,
          note:          note || '',
        });
      }

      // ── DRIVER StaffAttendance — Own vehicles only ────────────────────
      if (pair.ownershipType === 'Own') {
        const driverObjId = new mongoose.Types.ObjectId(driverId);
        const existing = await StaffAttendance.findOne({
          staff:   driverObjId,
          vehicle: vehicleId,
          date:    { $gte: dayStart, $lte: dayEnd },
          note:    { $ne: 'Summary override' },
        });

        if (existing) {
          // Update trip count and recalculate earned using the already-locked rate
          existing.numberOfTrips = trips;
          existing.earnedAmount  = trips * existing.ratePerTrip;
          await existing.save();
        } else {
          // First entry today — look up rate and lock it in
          const driverDoc  = await Staff.findById(driverId).select('ratePerTrip');
          const rate       = driverDoc?.ratePerTrip ?? 200;
          await StaffAttendance.create({
            staff:         driverObjId,
            vehicle:       vehicleId,
            date:          attendDate,
            numberOfTrips: trips,
            ratePerTrip:   rate,          // locked at billing time
            present:       true,
            earnedAmount:  trips * rate,
            note:          note || '',
          });
        }
      }

      // ── CONDUCTOR StaffAttendance — mark present once per day ────────
      if (conductorId) {
        const conductorObjId = new mongoose.Types.ObjectId(conductorId);
        const condExisting = await StaffAttendance.findOne({
          staff:   conductorObjId,
          vehicle: vehicleId,
          date:    { $gte: dayStart, $lte: dayEnd },
          note:    { $ne: 'Summary override' },
        });
        if (!condExisting) {
          // First entry today — look up rate and lock it in
          const condDoc   = await Staff.findById(conductorId).select('dailyRate');
          const dailyRate = condDoc?.dailyRate ?? 450;
          await StaffAttendance.create({
            staff:         conductorObjId,
            vehicle:       vehicleId,
            date:          attendDate,
            numberOfTrips: 0,
            present:       true,
            dailyRate,                    // locked at billing time
            earnedAmount:  dailyRate,     // flat per day regardless of trips
            note:          note || '',
          });
        }
        // Already present today → nothing to update (flat daily rate)
      }
    }

    // ── VehicleTrip only for Rental-without-driver rows ──────────────────
    for (const rEntry of Object.values(rentalOnlyMap)) {
      const { vehicleId, trips, rent } = rEntry;
      const vtExisting = await VehicleTrip.findOne({
        vehicle:    vehicleId,
        driverName: '',
        tripDate:   { $gte: dayStart, $lte: dayEnd },
      });
      if (vtExisting) {
        vtExisting.numberOfTrips = trips;
        vtExisting.rentalAmount  = rent;
        await vtExisting.save();
      } else {
        await VehicleTrip.create({
          vehicle:       vehicleId,
          tripDate:      deliveryDate,
          source:        rEntry.material,
          destination:   rEntry.destination,
          numberOfTrips: trips,
          dieselAmount:  0,
          rentalAmount:  rent,
          driverName:    '',
          note:          note || '',
        });
      }
    }

    const populated = await BillingDelivery.findById(delivery._id)
        .populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType')
        .populate('vehicles.driver', 'name')
        .populate('customer', 'name siteAddress billingType ratePerTrip ratePerQuantity');
    res.status(201).json(populated);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/deliveries/:id', async (req, res) => {
  try {
    const delivery = await BillingDelivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

    const deliveryDate = delivery.date;
    const dayStart = new Date(deliveryDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(deliveryDate); dayEnd.setHours(23, 59, 59, 999);
    const attendDate = new Date(dayStart);

    // Delete the delivery first, then recalculate from remaining
    await BillingDelivery.findByIdAndDelete(req.params.id);

    const remainingAll = await BillingDelivery.find({ date: { $gte: dayStart, $lte: dayEnd } });

    const pairMap       = {};
    const rentalOnlyMap = {};

    for (const d of remainingAll) {
      for (const v of d.vehicles) {
        if (!v.vehicle) continue;

        const vTrips     = v.numberOfTrips || 0;
        const vQty       = v.quantity || 0;
        const vDailyRent = Number(v.dailyRent) || 0;
        const rentAmt    = vDailyRent > 0
            ? (d.billingType === 'Quantity' ? vDailyRent * vQty : vDailyRent * vTrips)
            : 0;

        if (v.driver) {
          const key = `${v.vehicle}|${v.driver}`;
          let ownershipType = v.ownershipType || '';
          if (!ownershipType && v.vehicle) {
            const vDoc = await Vehicle.findById(v.vehicle).select('ownershipType');
            ownershipType = vDoc?.ownershipType || '';
          }
          if (!pairMap[key]) {
            pairMap[key] = {
              vehicleId:     v.vehicle,
              driverId:      v.driver,
              conductorId:   v.conductor || null,
              driverName:    v.driverName || '',
              ownershipType,
              trips:         0,
              rent:          0,
            };
          }
          pairMap[key].trips += vTrips;
          pairMap[key].rent  += rentAmt;
          if (v.driverName) pairMap[key].driverName = v.driverName;
          if (v.conductor)  pairMap[key].conductorId = v.conductor;

        } else {
          let ownershipType = v.ownershipType || '';
          if (!ownershipType && v.vehicle) {
            const vDoc = await Vehicle.findById(v.vehicle).select('ownershipType');
            ownershipType = vDoc?.ownershipType || '';
          }
          if (ownershipType !== 'Rental') continue;

          const key = String(v.vehicle);
          if (!rentalOnlyMap[key]) {
            rentalOnlyMap[key] = { vehicleId: v.vehicle, trips: 0, rent: 0 };
          }
          rentalOnlyMap[key].trips += vTrips;
          rentalOnlyMap[key].rent  += rentAmt;
        }
      }
    }

    // Collect affected pairs from the deleted delivery
    const deletedDriverPairs = delivery.vehicles
        .filter(v => v.vehicle && v.driver)
        .map(v => ({
          key:        `${v.vehicle}|${v.driver}`,
          vehicleId:  v.vehicle,
          driverId:   v.driver,
          driverName: v.driverName || '',
        }));

    const deletedRentalOnly = delivery.vehicles
        .filter(v => v.vehicle && !v.driver)
        .map(v => ({ vehicleId: v.vehicle, ownershipType: v.ownershipType || '' }));

    // ── Update or delete VehicleTrip for driver pairs ─────────────────
    for (const dp of deletedDriverPairs) {
      const pair = pairMap[dp.key];
      const vt = await VehicleTrip.findOne({
        vehicle:  dp.vehicleId,
        driver:   new mongoose.Types.ObjectId(dp.driverId),
        tripDate: { $gte: dayStart, $lte: dayEnd },
      });
      if (vt) {
        if (!pair || pair.trips === 0) {
          await VehicleTrip.findByIdAndDelete(vt._id);
        } else {
          vt.numberOfTrips = pair.trips;
          vt.rentalAmount  = pair.rent;
          await vt.save();
        }
      }
    }

    // ── Update or delete VehicleTrip for rental-without-driver rows ───
    for (const dr of deletedRentalOnly) {
      let ownershipType = dr.ownershipType;
      if (!ownershipType) {
        const vDoc = await Vehicle.findById(dr.vehicleId).select('ownershipType');
        ownershipType = vDoc?.ownershipType || '';
      }
      if (ownershipType !== 'Rental') continue;

      const remaining = rentalOnlyMap[String(dr.vehicleId)];
      const vt = await VehicleTrip.findOne({
        vehicle:    dr.vehicleId,
        driverName: '',
        tripDate:   { $gte: dayStart, $lte: dayEnd },
      });
      if (vt) {
        if (!remaining || remaining.trips === 0) {
          await VehicleTrip.findByIdAndDelete(vt._id);
        } else {
          vt.numberOfTrips = remaining.trips;
          vt.rentalAmount  = remaining.rent;
          await vt.save();
        }
      }
    }

    // ── Update or delete StaffAttendance for Own-vehicle drivers ─────
    const deletedOwnPairs = [];
    for (const dp of deletedDriverPairs) {
      let ownershipType = pairMap[dp.key]?.ownershipType || '';
      if (!ownershipType) {
        const vDoc = await Vehicle.findById(dp.vehicleId).select('ownershipType');
        ownershipType = vDoc?.ownershipType || '';
      }
      if (ownershipType === 'Own') {
        deletedOwnPairs.push({ key: dp.key, driverId: dp.driverId, vehicleId: dp.vehicleId });
      }
    }

    // Process per vehicle|driver pair with date range query (not exact date match)
    for (const { key, driverId, vehicleId } of deletedOwnPairs) {
      const remainingTrips = pairMap[key]?.trips || 0;

      const att = await StaffAttendance.findOne({
        staff:   new mongoose.Types.ObjectId(driverId),
        vehicle: vehicleId,
        date:    { $gte: dayStart, $lte: dayEnd },
        note:    { $ne: 'Summary override' },
      });
      if (att) {
        if (remainingTrips === 0) {
          await StaffAttendance.findByIdAndDelete(att._id);
        } else {
          att.numberOfTrips = remainingTrips;
          att.earnedAmount  = remainingTrips * att.ratePerTrip;
          await att.save();
        }
      }
    }

    // ── Update or delete StaffAttendance for conductors ───────────────
    const deletedConductorIds = new Set(
        delivery.vehicles
            .filter(v => v.vehicle && v.conductor)
            .map(v => String(v.conductor))
    );
    for (const conductorId of deletedConductorIds) {
      const stillActive = Object.values(pairMap).some(
          p => p.conductorId && String(p.conductorId) === conductorId
      );
      const att = await StaffAttendance.findOne({
        staff:   new mongoose.Types.ObjectId(conductorId),
        date:    { $gte: dayStart, $lte: dayEnd },
        present: true,
        note:    { $ne: 'Summary override' },
      });
      if (att && !stillActive) {
        await StaffAttendance.findByIdAndDelete(att._id);
      }
    }

    res.json({ message: 'Delivery deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/billing/history/:customerId
router.get('/history/:customerId', async (req, res) => {
  try {
    const deliveries = await BillingDelivery.find({ customer: req.params.customerId })
        .populate('vehicles.vehicle', 'vehicleNumber vehicleType')
        .populate('vehicles.driver', 'name')
        .sort({ date: -1 });
    res.json(deliveries);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════

router.post('/payments', async (req, res) => {
  try {
    const { customerId, amount, date, note } = req.body;
    const payment = await BillingPayment.create({
      customer: customerId,
      amount:   Number(amount),
      date:     date ? parseLocalDate(date) : new Date(),
      note:     note || '',
    });
    res.status(201).json(payment);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/payments/:id', async (req, res) => {
  try {
    await BillingPayment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/billing/payments/sync-status
router.post('/payments/sync-status', async (req, res) => {
  try {
    const { customerId, date } = req.body;
    if (!customerId || !date) return res.status(400).json({ message: 'customerId and date required' });

    const { start, end } = weekBounds(date);
    const ws = start;

    const payments  = await BillingPayment.find({ customer: customerId, date: { $gte: start, $lte: end } });
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);

    const ps = await BillingPaymentStatus.findOne({ customer: customerId, weekStart: ws });
    if (ps) {
      ps.amountPaid = totalPaid;
      if (totalPaid <= 0) { ps.isPaid = false; ps.isPartial = false; }
      await ps.save();
    }

    res.json({ synced: true, totalPaid });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT STATUS
// ═══════════════════════════════════════════════════════════════════════════

router.post('/payment-status', async (req, res) => {
  try {
    const { customerId, date, totalBill, amountPaid, isPaid, isPartial, note, paidDate } = req.body;
    const { start: ws } = weekBounds(date || paidDate || new Date().toISOString().slice(0, 10));

    let ps = await BillingPaymentStatus.findOne({ customer: customerId, weekStart: ws });
    if (!ps) ps = new BillingPaymentStatus({ customer: customerId, weekStart: ws });

    const previousPaid = ps.amountPaid || 0;
    const increment    = Number(amountPaid) || 0;
    ps.amountPaid = previousPaid + increment;
    ps.totalBill  = Number(totalBill) || ps.totalBill;
    ps.isPaid     = !!isPaid;
    ps.isPartial  = !isPaid && !!isPartial;
    ps.note       = note || ps.note;
    ps.paidDate   = paidDate ? parseLocalDate(paidDate) : (ps.paidDate || new Date());
    await ps.save();

    if (increment > 0) {
      const paymentNote = isPaid
          ? `__auto__: ${note || 'Full payment'}`
          : `__auto__: ${note || 'Partial payment'}`;
      await BillingPayment.create({
        customer:  customerId,
        amount:    increment,
        date:      paidDate ? parseLocalDate(paidDate) : new Date(),
        weekStart: ws,
        note:      paymentNote,
      });
    }

    res.json(ps);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.delete('/payment-status/:customerId', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'date query required' });

    const { start: ws, end } = weekBounds(date);
    await BillingPaymentStatus.findOneAndDelete({ customer: req.params.customerId, weekStart: ws });

    const start = ws;
    await BillingPayment.deleteMany({
      customer: req.params.customerId,
      date:     { $gte: start, $lte: end },
      note:     /^__auto__/,
    });

    res.json({ message: 'Payment record deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// BILL VIEWS — weekly and daily
// ═══════════════════════════════════════════════════════════════════════════

router.get('/weekly/:customerId', async (req, res) => {
  try {
    const { date } = req.query;
    const { start, end } = weekBounds(date);

    const customer = await BillingCustomer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const deliveries = await BillingDelivery.find({
      customer: req.params.customerId,
      date:     { $gte: start, $lte: end },
    })
        .populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType')
        .populate('vehicles.driver', 'name')
        .sort({ date: 1 });

    const weekTotal = deliveries.reduce((s, d) => s + (d.totalAmount || 0), 0);

    const dayMap = {};
    for (const d of deliveries) {
      const key = d.date.toISOString().slice(0, 10);
      if (!dayMap[key]) dayMap[key] = [];
      dayMap[key].push(d);
    }
    const dailyGroups = Object.entries(dayMap).map(([date, deliveries]) => ({ date, deliveries }));

    const allPrevDeliveries = await BillingDelivery.find({ customer: req.params.customerId, date: { $lt: start } });
    const allPrevTotal      = allPrevDeliveries.reduce((s, d) => s + (d.totalAmount || 0), 0);
    const allPrevPayments   = await BillingPayment.find({ customer: req.params.customerId, date: { $lt: start } });
    const allPrevPaid       = allPrevPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const carriedBalance    = Math.max(0, allPrevTotal - allPrevPaid);
    const weekPayments = await BillingPayment.find({
      customer: req.params.customerId,
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 });

    const allEverPaid = await BillingPayment.find({ customer: req.params.customerId });
    const totalEverPaid = allEverPaid.reduce((s, p) => s + (p.amount || 0), 0);
    const grandTotal  = carriedBalance + weekTotal;
    const totalPaid   = weekPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const netDue      = Math.max(0, (carriedBalance + weekTotal) - totalEverPaid);

    const paymentStatus = await BillingPaymentStatus.findOne({
      customer:  req.params.customerId,
      weekStart: start,
    });

    res.json({
      customer,
      weekStart:     start,
      weekEnd:       end,
      deliveries,
      dailyGroups,
      weekTotal,
      carriedBalance,
      grandTotal,
      weekPayments,
      totalPaid,
      netDue,
      paymentStatus: paymentStatus || null,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/daily/:customerId', async (req, res) => {
  try {
    const { date } = req.query;
    const dayStart = parseLocalDate(date);
    const dayEnd   = new Date(dayStart); dayEnd.setHours(23, 59, 59, 999);

    const customer = await BillingCustomer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const deliveries = await BillingDelivery.find({
      customer: req.params.customerId,
      date:     { $gte: dayStart, $lte: dayEnd },
    })
        .populate('vehicles.vehicle', 'vehicleNumber vehicleType ownershipType')
        .populate('vehicles.driver', 'name')
        .sort({ date: 1 });

    const totalAmount = deliveries.reduce((s, d) => s + (d.totalAmount || 0), 0);

    res.json({ customer, date: dayStart, deliveries, totalAmount });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

router.get('/earnings/summary', async (req, res) => {
  try {
    const { type, date, month, startDate, endDate } = req.query;
    let start, end, weekStart, weekEnd, monthLabel;

    if (type === 'monthly') {
      const m = month || new Date().toISOString().slice(0, 7);
      ({ start, end } = monthBounds(m));
      monthLabel = new Date(start).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    } else if (type === 'custom') {
      start = parseLocalDate(startDate);
      end   = parseLocalDate(endDate); end.setHours(23, 59, 59, 999);
    } else if (type === 'daily') {
      start = parseLocalDate(date);
      end   = new Date(start); end.setHours(23, 59, 59, 999);
    } else {
      ({ start, end } = weekBounds(date));
      weekStart = start;
      weekEnd   = end;
    }

    const deliveries = await BillingDelivery.find({ date: { $gte: start, $lte: end } })
        .populate('customer', 'name siteAddress billingType ratePerTrip ratePerQuantity isActive')
        .populate('vehicles.vehicle', 'ownershipType')
        .sort({ date: 1 });

    const custMap = {};
    for (const d of deliveries) {
      if (!d.customer) continue;
      if (d.customer.isActive === false) continue;
      const cid = String(d.customer._id);
      if (!custMap[cid]) {
        custMap[cid] = {
          customer:     d.customer,
          deliveries:   [],
          tripAmount:   0,
          qtyAmount:    0,
          total:        0,
          totalTrips:   0,
          totalQty:     0,
          rateApplied:  d.customer.ratePerTrip || d.customer.ratePerQuantity || 0,
          quantityUnit: '',
        };
      }
      custMap[cid].deliveries.push(d);
      for (const v of d.vehicles) {
        const ownershipType       = v.vehicle?.ownershipType || '';
        const isOwn               = ownershipType === 'Own';
        const hasDriver           = !!v.driver;
        const countsInVehicleTrip = hasDriver || !isOwn;

        if (d.billingType === 'Trip') {
          custMap[cid].tripAmount += v.totalAmount || 0;
          if (countsInVehicleTrip) custMap[cid].totalTrips += v.numberOfTrips || 0;
        } else {
          custMap[cid].qtyAmount  += v.totalAmount || 0;
          custMap[cid].totalQty   += v.quantity || 0;
          if (countsInVehicleTrip) custMap[cid].totalTrips += v.numberOfTrips || 0;
          custMap[cid].quantityUnit = d.quantityUnit || custMap[cid].quantityUnit;
        }
        custMap[cid].total += v.totalAmount || 0;
      }
    }

    const customerRows = [];
    for (const cid of Object.keys(custMap)) {
      const row = custMap[cid];

      const payments  = await BillingPayment.find({ customer: cid, date: { $gte: start, $lte: end } }).sort({ date: 1 });
      const collected = payments.reduce((s, p) => s + (p.amount || 0), 0);

      let paymentStatus = null;
      if (type === 'weekly' || !type) {
        paymentStatus = await BillingPaymentStatus.findOne({ customer: cid, weekStart });
      }
      let carriedBalance = 0;
      {
        const allPrevDels  = await BillingDelivery.find({ customer: cid, date: { $lt: start } });
        const allPrevTotal = allPrevDels.reduce((s, d) => s + (d.totalAmount || 0), 0);
        const allPrevPays  = await BillingPayment.find({ customer: cid, date: { $lt: start } });
        const allPrevPaid  = allPrevPays.reduce((s, p) => s + (p.amount || 0), 0);
        carriedBalance     = Math.max(0, allPrevTotal - allPrevPaid);
      }

      const grandTotal = carriedBalance + row.total;
      const netDue     = paymentStatus?.isPaid ? 0 : Math.max(0, grandTotal - collected);

      customerRows.push({
        customer:     row.customer,
        tripAmount:   row.tripAmount,
        qtyAmount:    row.qtyAmount,
        total:        row.total,
        totalTrips:   row.totalTrips,
        totalQty:     row.totalQty,
        rateApplied:  row.rateApplied,
        quantityUnit: row.quantityUnit,
        collected,
        carriedBalance,
        grandTotal,
        netDue,
        paymentStatus: paymentStatus || null,
        payments,
      });
    }

    const tripTotal      = customerRows.reduce((s, c) => s + c.tripAmount,     0);
    const qtyTotal       = customerRows.reduce((s, c) => s + c.qtyAmount,      0);
    const grandTotal     = customerRows.reduce((s, c) => s + c.total,          0);
    const totalCarried   = customerRows.reduce((s, c) => s + c.carriedBalance, 0);
    const totalCollected = customerRows.reduce((s, c) => s + c.collected,      0);
    const totalNetDue    = customerRows.reduce((s, c) => s + c.netDue,         0);

    res.json({
      type:           type || 'weekly',
      weekStart:      weekStart  || null,
      weekEnd:        weekEnd    || null,
      monthLabel:     monthLabel || null,
      tripTotal,
      qtyTotal,
      grandTotal,
      totalCarried,
      totalCollected,
      totalNetDue,
      totalRemaining: totalNetDue,
      customers:      customerRows,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;