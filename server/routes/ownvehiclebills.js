const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const VehicleTrip = require('../models/VehicleTrip');
const VehicleExpense = require('../models/VehicleExpense');
const { protect } = require('../middleware/auth');

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

// GET all own vehicles
router.get('/vehicles', async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ isActive: true, ownershipType: 'Own' }).sort({ vehicleNumber: 1 });
    res.json(vehicles);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST add expense for a vehicle
router.post('/expense', async (req, res) => {
  try {
    const { vehicleId, date, expenseType, amount, note } = req.body;
    if (!vehicleId || !expenseType || !amount) {
      return res.status(400).json({ message: 'vehicleId, expenseType and amount are required' });
    }
    const expense = await VehicleExpense.create({
      vehicle: new mongoose.Types.ObjectId(vehicleId),
      date: date || Date.now(),
      expenseType, amount: Number(amount), note
    });
    res.status(201).json(expense);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// GET expenses for a vehicle
router.get('/expenses/:vehicleId', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { vehicle: new mongoose.Types.ObjectId(req.params.vehicleId) };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(to + 'T23:59:59');
    }
    const expenses = await VehicleExpense.find(filter).sort({ date: -1 });
    res.json(expenses);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE expense
router.delete('/expense/:id', async (req, res) => {
  try {
    await VehicleExpense.findByIdAndDelete(req.params.id);
    res.json({ message: 'Expense deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE a trip order directly (for removing ghost/duplicate trip entries)
router.delete('/trip/:id', async (req, res) => {
  try {
    const deleted = await VehicleTrip.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Trip not found' });
    res.json({ message: 'Trip deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET custom date range bill for an own vehicle
router.get('/custom/:vehicleId', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: 'from and to are required' });

    const fromDate = new Date(from); fromDate.setHours(0, 0, 0, 0);
    const toDate   = new Date(to);   toDate.setHours(23, 59, 59, 999);

    const vehicle = await Vehicle.findById(req.params.vehicleId);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    const trips = await VehicleTrip.find({
      vehicle: new mongoose.Types.ObjectId(req.params.vehicleId),
      tripDate: { $gte: fromDate, $lte: toDate },
    }).sort({ tripDate: 1 });

    const expenses = await VehicleExpense.find({
      vehicle: new mongoose.Types.ObjectId(req.params.vehicleId),
      date: { $gte: fromDate, $lte: toDate },
    }).sort({ date: 1 });

    // Group trips by day (same logic as weekly)
    const byDate = {};
    trips.forEach(t => {
      const d = new Date(t.tripDate).toDateString();
      if (!byDate[d]) byDate[d] = { date: t.tripDate, trips: 0, diesel: 0, orders: [] };
      byDate[d].trips += (t.numberOfTrips || 1);
      byDate[d].diesel = Math.max(byDate[d].diesel, t.dieselAmount || 0);
      byDate[d].orders.push({
        _id: t._id, source: t.source, destination: t.destination,
        numberOfTrips: t.numberOfTrips || 1, dieselAmount: t.dieselAmount || 0,
        driverName: t.driverName, note: t.note || '',
      });
    });

    const dailyTrips      = Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date));
    const totalTripCount  = dailyTrips.reduce((s, d) => s + d.trips, 0);
    const dieselFromTrips = dailyTrips.reduce((s, d) => s + d.diesel, 0);
    const dieselFromExpenses = expenses.filter(e => e.expenseType === 'Diesel').reduce((s, e) => s + e.amount, 0);
    const totalDiesel    = dieselFromTrips + dieselFromExpenses;
    const totalExpenses  = expenses.filter(e => e.expenseType !== 'Diesel').reduce((s, e) => s + e.amount, 0);

    res.json({
      vehicle, from: fromDate, to: toDate,
      totalTrips: totalTripCount,
      dailyTrips, trips, expenses,
      totalDiesel, totalExpenses,
      grandTotal: totalDiesel + totalExpenses,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly bill for an own vehicle
router.get('/weekly/:vehicleId', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd = getWeekEnd(date ? new Date(date) : new Date());

    const vehicle = await Vehicle.findById(req.params.vehicleId);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    // Hard-delete is used, so no isDeleted filter needed
    const trips = await VehicleTrip.find({
      vehicle: new mongoose.Types.ObjectId(req.params.vehicleId),
      tripDate: { $gte: weekStart, $lte: weekEnd },
    }).sort({ tripDate: 1 });

    const expenses = await VehicleExpense.find({
      vehicle: new mongoose.Types.ObjectId(req.params.vehicleId),
      date: { $gte: weekStart, $lte: weekEnd }
    }).sort({ date: 1 });

    // Group trips by day.
    // KEY FIX: Each document has numberOfTrips (e.g. 5).
    // We SUM numberOfTrips — we do NOT count documents (that was the bug).
    // We also collect per-order breakdown inside each day for the UI detail table.
    const byDate = {};
    trips.forEach(t => {
      const d = new Date(t.tripDate).toDateString();
      if (!byDate[d]) byDate[d] = { date: t.tripDate, trips: 0, diesel: 0, orders: [] };

      byDate[d].trips += (t.numberOfTrips || 1);                          // ✅ sum actual trips
      byDate[d].diesel = Math.max(byDate[d].diesel, t.dieselAmount || 0); // max diesel per day

      byDate[d].orders.push({
        _id:           t._id,
        source:        t.source,        // material name
        destination:   t.destination,   // delivery address
        numberOfTrips: t.numberOfTrips || 1,
        dieselAmount:  t.dieselAmount || 0,
        driverName:    t.driverName,
        note:          t.note || '',
      });
    });

    const dailyTrips = Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date));

    // totalTrips = sum of numberOfTrips across all orders this week
    const totalTripCount = dailyTrips.reduce((s, d) => s + d.trips, 0);

    const expenseByType = {};
    expenses.forEach(e => {
      if (!expenseByType[e.expenseType]) expenseByType[e.expenseType] = 0;
      expenseByType[e.expenseType] += e.amount;
    });

    const dieselFromTrips    = dailyTrips.reduce((s, d) => s + d.diesel, 0);
    const dieselFromExpenses = expenses
        .filter(e => e.expenseType === 'Diesel')
        .reduce((s, e) => s + e.amount, 0);
    const totalDiesel   = dieselFromTrips + dieselFromExpenses;
    const totalExpenses = expenses
        .filter(e => e.expenseType !== 'Diesel')
        .reduce((s, e) => s + e.amount, 0);
    const grandTotal = totalDiesel + totalExpenses;

    res.json({
      vehicle, weekStart, weekEnd,
      totalTrips: totalTripCount,   // ✅ correct: sum of numberOfTrips
      dailyTrips,                   // ✅ each day has .trips (sum) + .orders (per-order detail)
      trips,
      expenses,
      expenseByType,
      totalDiesel,
      totalExpenses,
      grandTotal,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET weekly bills for ALL own vehicles
router.get('/weekly/all/summary', async (req, res) => {
  try {
    const { date } = req.query;
    const weekStart = getWeekStart(date ? new Date(date) : new Date());
    const weekEnd = getWeekEnd(date ? new Date(date) : new Date());

    const vehicles = await Vehicle.find({ isActive: true, ownershipType: 'Own' });

    const summary = await Promise.all(vehicles.map(async (v) => {
      const trips = await VehicleTrip.find({
        vehicle: v._id,
        tripDate: { $gte: weekStart, $lte: weekEnd },
      });
      const expenses = await VehicleExpense.find({ vehicle: v._id, date: { $gte: weekStart, $lte: weekEnd } });

      const byDate = {};
      trips.forEach(t => {
        const d = new Date(t.tripDate).toDateString();
        if (!byDate[d]) byDate[d] = { trips: 0, diesel: 0 };
        byDate[d].trips  += (t.numberOfTrips || 1);                         // ✅ sum numberOfTrips
        byDate[d].diesel  = Math.max(byDate[d].diesel, t.dieselAmount || 0);
      });

      const totalTripCount     = Object.values(byDate).reduce((s, d) => s + d.trips, 0);
      const dieselFromTrips    = Object.values(byDate).reduce((s, d) => s + d.diesel, 0);
      const dieselFromExpenses = expenses
          .filter(e => e.expenseType === 'Diesel')
          .reduce((s, e) => s + e.amount, 0);
      const totalDiesel   = dieselFromTrips + dieselFromExpenses;
      const totalExpenses = expenses
          .filter(e => e.expenseType !== 'Diesel')
          .reduce((s, e) => s + e.amount, 0);

      return {
        vehicle: v,
        totalTrips: totalTripCount,
        totalDiesel,
        totalExpenses,
        grandTotal: totalDiesel + totalExpenses,
      };
    }));

    res.json({ weekStart, weekEnd, summary });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;