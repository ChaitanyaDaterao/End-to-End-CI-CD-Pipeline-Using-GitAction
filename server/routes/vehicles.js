const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const VehicleExpense = require('../models/VehicleExpense');
const VehicleTrip = require('../models/VehicleTrip');
const VehicleRentalRate = require('../models/VehicleRentalRate');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─── Helper: get the rental rate for a vehicle on a given date ────────────────
// Checks VehicleRentalRate (daily override) first, then falls back to
// the vehicle's default rentalAmount field.
// Returns { ratePerTrip, ratePerBrass, source } for a vehicle on a given date.
// Checks VehicleRentalRate (daily override) first, falls back to vehicle defaults.
async function getRentalRatesForDate(vehicle, date) {
  const d = new Date(date);
  const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
  const dayEnd   = new Date(d); dayEnd.setHours(23,59,59,999);
  const rateDoc = await VehicleRentalRate.findOne({
    vehicle: vehicle._id,
    date: { $gte: dayStart, $lte: dayEnd },
  });
  if (rateDoc) {
    return {
      ratePerTrip:  rateDoc.ratePerTrip  || 0,
      ratePerBrass: rateDoc.ratePerBrass || 0,
      source: 'daily-override',
    };
  }
  return {
    ratePerTrip:  vehicle.rentalAmount || 0,   // legacy default
    ratePerBrass: vehicle.rentalAmountPerBrass || 0,
    source: 'vehicle-default',
  };
}

// ─── GET all trips — must be before /:id routes ───────────────────────────────
router.get('/trips/all', async (req, res) => {
  try {
    const { from, to, vehicleId } = req.query;
    const filter = {};
    if (vehicleId) filter.vehicle = new mongoose.Types.ObjectId(vehicleId);
    if (from || to) {
      filter.tripDate = {};
      if (from) filter.tripDate.$gte = new Date(from);
      if (to)   filter.tripDate.$lte = new Date(to + 'T23:59:59');
    }
    const trips = await VehicleTrip.find(filter)
        .populate('vehicle', 'vehicleNumber vehicleType ownershipType')
        .populate('material', 'name unit')
        .sort({ tripDate: -1 });
    res.json(trips);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET weekly summary — must be before /:id routes ─────────────────────────
router.get('/summary/weekly', async (req, res) => {
  try {
    const { date } = req.query;
    // Parse date as LOCAL time (not UTC) so getDay() returns the correct weekday in IST.
    // new Date('2026-05-31') parses as UTC midnight = 2026-05-30T18:30 IST → getDay() = Sat (6), WRONG.
    // Splitting and using new Date(y, m, d) gives local midnight → getDay() = Sun (0), correct.
    let d;
    if (date) {
      const [y, m, day0] = date.split('-').map(Number);
      d = new Date(y, m - 1, day0); // local midnight
    } else {
      d = new Date();
    }
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff); d.setHours(0,0,0,0);
    const weekStart = new Date(d);
    const weekEnd = new Date(d); weekEnd.setDate(d.getDate() + 6); weekEnd.setHours(23,59,59,999);

    const vehicles = await Vehicle.find({ isActive: true });
    const summary = await Promise.all(vehicles.map(async (v) => {
      const trips = await VehicleTrip.find({ vehicle: v._id, tripDate: { $gte: weekStart, $lte: weekEnd } });
      // FIX Trip-Count Mismatch: totalTrips already uses || 0 (Bug 4 fix).
      // tripCount was previously trips.length (number of VehicleTrip *documents*)
      // which is NOT the same as the sum of numberOfTrips across those documents.
      // A single VehicleTrip document can record multiple trips (numberOfTrips > 1),
      // so using trips.length understates the count compared to what billing reports.
      // Set tripCount = totalTrips so both fields agree and consumers see one truth.
      const totalTrips  = trips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);
      const totalAmount = trips.reduce((s, t) => s + t.tripAmount, 0);

      let totalDiesel = 0, totalMaintenance = 0, totalOthers = 0, totalRent = 0;

      // ── Build daily breakdown: group trips by date ────────────────────────────
      const dayMap = {};
      for (const t of trips) {
        // Normalise to YYYY-MM-DD in local time (IST) so days don't shift.
        const dateKey = new Date(t.tripDate).toLocaleDateString('en-CA'); // 'en-CA' → YYYY-MM-DD
        if (!dayMap[dateKey]) dayMap[dateKey] = { trips: 0, rentalAmount: 0, dieselAmount: 0 };
        dayMap[dateKey].trips        += (t.numberOfTrips || 0);
        dayMap[dateKey].rentalAmount += (t.rentalAmount  || 0);
        dayMap[dateKey].dieselAmount += (t.dieselAmount  || 0);
      }
      const dailyBreakdown = Object.entries(dayMap)
          .map(([date, d]) => ({ date, ...d }))
          .sort((a, b) => a.date.localeCompare(b.date));

      if (v.ownershipType === 'Own') {
        const allExpenses = await VehicleExpense.find({ vehicle: v._id, date: { $gte: weekStart, $lte: weekEnd } });
        totalDiesel      = allExpenses.filter(e => e.expenseType === 'Diesel').reduce((s, e) => s + e.amount, 0);
        totalMaintenance = allExpenses.filter(e => ['Maintenance','Tyre','Oil Change','Repair'].includes(e.expenseType)).reduce((s, e) => s + e.amount, 0);
        totalOthers      = allExpenses.filter(e => ['Driver Payment','Other'].includes(e.expenseType)).reduce((s, e) => s + e.amount, 0);
      } else {
        totalRent = trips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
      }

      return {
        vehicle: v, totalTrips, totalAmount,
        totalDiesel, totalMaintenance, totalOthers,
        totalExpenses: totalDiesel + totalMaintenance + totalOthers,
        // FIX Trip-Count Mismatch: tripCount must equal totalTrips (sum of numberOfTrips),
        // NOT trips.length (count of VehicleTrip documents). One document can hold
        // multiple trips, so trips.length < totalTrips whenever numberOfTrips > 1.
        // Billing's totalTrips is derived the same way (sum of numberOfTrips), so
        // using trips.length here would make vehicle totals < billing totals.
        totalRent, tripCount: totalTrips,
        dailyBreakdown,
      };
    }));

    const own    = summary.filter(s => s.vehicle.ownershipType === 'Own');
    const rental = summary.filter(s => s.vehicle.ownershipType === 'Rental');
    res.json({ weekStart, weekEnd, own, rental });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET all vehicles ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ isActive: true }).sort({ vehicleNumber: 1 });
    res.json(vehicles);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── POST create vehicle ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const vehicle = await Vehicle.create(req.body);
    res.status(201).json(vehicle);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// ─── GET single vehicle ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── PUT update vehicle ───────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(vehicle);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// ─── DELETE soft delete ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await Vehicle.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Vehicle removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── RENTAL RATE ROUTES ───────────────────────────────────────────────────────

// GET rate for a specific date
// Used by other modules BEFORE posting a trip so they know the current rate.
// GET /vehicles/:id/rental-rate?date=2025-04-18
router.get('/:id/rental-rate', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const date     = req.query.date ? new Date(req.query.date) : new Date();
    const rates    = await getRentalRatesForDate(vehicle, date);

    res.json({
      vehicleId:     vehicle._id,
      vehicleNumber: vehicle.vehicleNumber,
      date,
      ratePerTrip:   rates.ratePerTrip,
      ratePerBrass:  rates.ratePerBrass,
      source:        rates.source,
      defaultRatePerTrip:  vehicle.rentalAmount || 0,
      defaultRatePerBrass: vehicle.rentalAmountPerBrass || 0,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET all daily rate records for a vehicle
// GET /vehicles/:id/rental-rates?from=&to=
router.get('/:id/rental-rates', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { vehicle: new mongoose.Types.ObjectId(req.params.id) };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(to + 'T23:59:59');
    }
    const rates = await VehicleRentalRate.find(filter).sort({ date: -1 });
    res.json(rates);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST set (upsert) rate for a specific date
// Body: { date, ratePerTrip, note }
router.post('/:id/rental-rate', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    if (vehicle.ownershipType !== 'Rental') return res.status(400).json({ message: 'Not a rental vehicle' });

    const { date, ratePerTrip, ratePerBrass, note } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required' });
    if (ratePerTrip == null && ratePerBrass == null)
      return res.status(400).json({ message: 'ratePerTrip or ratePerBrass is required' });

    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);

    const rateDoc = await VehicleRentalRate.findOneAndUpdate(
        { vehicle: vehicle._id, date: dayStart },
        {
          vehicle:      vehicle._id,
          date:         dayStart,
          ratePerTrip:  Number(ratePerTrip)  || 0,
          ratePerBrass: Number(ratePerBrass) || 0,
          note:         note || '',
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json(rateDoc);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// DELETE a specific rate record
router.delete('/:id/rental-rate/:rateId', async (req, res) => {
  try {
    await VehicleRentalRate.findByIdAndDelete(req.params.rateId);
    res.json({ message: 'Rate deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── POST add trip ────────────────────────────────────────────────────────────
// Works for the Vehicles page AND any other module posting trips for a vehicle.
// If rentalTripRate is not sent (other module), it is auto-looked up from
// VehicleRentalRate by trip date, falling back to vehicle.rentalAmount.
router.post('/:id/trips', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const {
      tripDate, source, destination, material, quantity, quantityUnit,
      billingType, rateApplied, numberOfTrips, dieselAmount,
      rentalTripRate,   // optional — auto-resolved for rental vehicles if not sent
      driverName, conductorName, note
    } = req.body;

    const tripCount        = Number(numberOfTrips) || 0;  // FIX Bug 4: default 0 not 1
    const tripDateFinal    = tripDate ? new Date(tripDate) : new Date();
    // Default billingType to 'Trip' when the calling module (e.g. orders) doesn't send it
    const resolvedBilling  = billingType === 'Quantity' ? 'Quantity' : 'Trip';
    const resolvedRate     = Number(rateApplied) || 0;
    const resolvedQuantity = Number(quantity) || 0;

    // tripAmount: how much the client is billed for this trip
    const tripAmount = resolvedBilling === 'Trip'
        ? resolvedRate * tripCount
        : resolvedQuantity * resolvedRate;

    // AUTO-LOOKUP for rental vehicles:
    // If caller sent rentalTripRate, use it directly (manual entry from Vehicles page).
    // If caller did NOT send it (another module posting trips), resolve from
    // VehicleRentalRate table for that date — falls back to vehicle.rentalAmount.
    let resolvedRentalTripRate  = 0;
    let resolvedRentalBrassRate = 0;
    if (vehicle.ownershipType === 'Rental') {
      if (rentalTripRate != null && rentalTripRate !== '') {
        // Caller explicitly provided the rate (manual entry from Vehicles page)
        resolvedRentalTripRate  = Number(rentalTripRate);
        resolvedRentalBrassRate = Number(req.body.rentalBrassRate) || 0;
      } else {
        // Auto-lookup from VehicleRentalRate table for this date
        const rates = await getRentalRatesForDate(vehicle, tripDateFinal);
        resolvedRentalTripRate  = rates.ratePerTrip;
        resolvedRentalBrassRate = rates.ratePerBrass;
      }
    }

    // Rental billing (what we owe the rental vehicle owner):
    //   Trip     → numberOfTrips × ratePerTrip
    //   Quantity → quantity      × ratePerBrass  (separate rate per brass)
    const rentalAmount = vehicle.ownershipType === 'Rental'
        ? (resolvedBilling === 'Quantity'
            ? resolvedQuantity * resolvedRentalBrassRate
            : tripCount * resolvedRentalTripRate)
        : 0;

    const trip = await VehicleTrip.create({
      vehicle: vehicle._id,
      tripDate: tripDateFinal,
      source, destination,
      material: material || null,
      quantity: resolvedQuantity,
      quantityUnit: quantityUnit || 'brass',
      numberOfTrips: tripCount,
      billingType: resolvedBilling,
      rateApplied: resolvedRate,
      tripAmount,
      dieselAmount: Number(dieselAmount) || 0,
      rentalTripRate:     resolvedBilling === 'Trip'     ? resolvedRentalTripRate  : 0,
      rentalQuantityRate: resolvedBilling === 'Quantity' ? resolvedRentalBrassRate : 0,
      rentalAmount,
      driverName: driverName || '',
      conductorName: conductorName || '',
      note,
    });

    res.status(201).json(trip);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// ─── GET trips for a vehicle ──────────────────────────────────────────────────
router.get('/:id/trips', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { vehicle: new mongoose.Types.ObjectId(req.params.id) };
    if (from || to) {
      filter.tripDate = {};
      if (from) filter.tripDate.$gte = new Date(from);
      if (to)   filter.tripDate.$lte = new Date(to + 'T23:59:59');
    }
    const trips = await VehicleTrip.find(filter)
        .populate('material', 'name unit')
        .sort({ tripDate: -1 });
    res.json(trips);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET vehicle summary ──────────────────────────────────────────────────────
router.get('/:id/summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { vehicle: new mongoose.Types.ObjectId(req.params.id) };
    if (from || to) {
      filter.tripDate = {};
      if (from) filter.tripDate.$gte = new Date(from);
      if (to)   filter.tripDate.$lte = new Date(to + 'T23:59:59');
    }
    const trips = await VehicleTrip.find(filter);
    const summary = {
      // FIX Bug 4: use || 0 consistently — matches StaffAttendance aggregation in staff.js
      totalTrips:        trips.reduce((s, t) => s + (t.numberOfTrips || 0), 0),
      totalAmount:       trips.reduce((s, t) => s + t.tripAmount, 0),
      totalDiesel:       trips.reduce((s, t) => s + t.dieselFilled, 0),
      totalDieselAmount: trips.reduce((s, t) => s + t.dieselAmount, 0),
      totalQuantity:     trips.reduce((s, t) => s + t.quantity, 0),
      totalRentalAmount: trips.reduce((s, t) => s + t.rentalAmount, 0),
    };
    res.json(summary);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── PUT summary override ─────────────────────────────────────────────────────
// For a given week, deletes only previously inline-created 'Summary edit'
// trip records, then creates ONE new record with the exact totals the user typed.
// Real trip records (from billing, orders, etc.) are NEVER touched.
//
// Strategy:
//   realTotal   = sum of numberOfTrips on real (non-Summary-edit) records
//   adjustment  = userTypedTotal - realTotal   (can be negative or zero)
//   If adjustment > 0  → create one record with adjustment trips
//   If adjustment <= 0 → store a negative-adjustment record so the net = userTypedTotal
//
// Body: { weekStart, weekEnd, numberOfTrips, dieselAmount, rentalTripRate }
router.put('/:id/trips/summary-override', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const { weekStart, weekEnd, numberOfTrips, dieselAmount, rentalTripRate } = req.body;
    if (!weekStart || !weekEnd) return res.status(400).json({ message: 'weekStart and weekEnd required' });

    const start = new Date(weekStart); start.setHours(0,0,0,0);
    const end   = new Date(weekEnd);   end.setHours(23,59,59,999);

    // 1. Delete ALL previous 'Summary edit' records for this vehicle+week
    await VehicleTrip.deleteMany({
      vehicle:  vehicle._id,
      tripDate: { $gte: start, $lte: end },
      source:   'Summary edit',
    });

    // 2. Calculate what the real trips sum to (excluding our own records)
    const realTrips = await VehicleTrip.find({
      vehicle:  vehicle._id,
      tripDate: { $gte: start, $lte: end },
    });
    const realTotal = realTrips.reduce((s, t) => s + (t.numberOfTrips || 0), 0);

    const userTotal  = Number(numberOfTrips) || 0;
    const adjustment = userTotal - realTotal; // trips adjustment (can be negative)

    // 3. Resolve rental rate & rental amount
    let resolvedRentalTripRate = 0;
    let rentalAmount = 0;

    if (vehicle.ownershipType === 'Rental') {
      resolvedRentalTripRate = rentalTripRate != null
          ? Number(rentalTripRate)
          : (vehicle.rentalAmount || 0);

      // realRentTotal = what all existing real trips already contribute
      const realRentTotal = realTrips.reduce((s, t) => s + (t.rentalAmount || 0), 0);
      // targetRentTotal = trips × rate (what the user intends for the full week)
      const targetRentTotal = userTotal * resolvedRentalTripRate;
      // rentAdjustment = what this one adjustment record must carry to make totals correct
      rentalAmount = targetRentTotal - realRentTotal;
    }

    // 4. Create the adjustment record — numberOfTrips and rentalAmount can be
    //    zero or negative; that is intentional so the weekly sum matches exactly.
    const trip = await VehicleTrip.create({
      vehicle:            vehicle._id,
      tripDate:           start,
      source:             'Summary edit',
      destination:        '',
      material:           null,
      quantity:           0,
      quantityUnit:       'brass',
      numberOfTrips:      adjustment,
      billingType:        'Trip',
      rateApplied:        0,
      tripAmount:         0,
      dieselAmount:       vehicle.ownershipType === 'Own' ? (Number(dieselAmount) || 0) : 0,
      rentalTripRate:     resolvedRentalTripRate,
      rentalQuantityRate: 0,
      rentalAmount,
      driverName:         '',
      conductorName:      '',
      note:               'Manual entry via weekly summary',
    });

    res.status(200).json({ trip, realTotal, adjustment, userTotal, rentalAmount });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// ─── DELETE all trip records for a vehicle on a specific date ─────────────────
// Used by the daily breakdown delete (🗑) button in the Weekly Summary.
// Body: { date: 'YYYY-MM-DD' }
router.delete('/:id/trips/by-date', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const { date } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required' });

    const [y, m, d] = date.split('-').map(Number);
    const dayStart  = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd    = new Date(y, m - 1, d, 23, 59, 59, 999);

    const result = await VehicleTrip.deleteMany({
      vehicle:  vehicle._id,
      tripDate: { $gte: dayStart, $lte: dayEnd },
    });

    res.json({ message: 'Deleted', deletedCount: result.deletedCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;