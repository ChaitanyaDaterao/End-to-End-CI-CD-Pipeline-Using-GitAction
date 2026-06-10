const express = require('express');
const router  = express.Router();
const VehicleExpense = require('../models/VehicleExpense');
const { protect } = require('../middleware/auth');

router.use(protect);

// POST — create a single expense record (called by inline edits in Weekly Summary)
router.post('/', async (req, res) => {
  try {
    const expense = await VehicleExpense.create(req.body);
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET — list expenses with optional filters
router.get('/', async (req, res) => {
  try {
    const { vehicleId, from, to } = req.query;
    const filter = {};
    if (vehicleId) filter.vehicle = vehicleId;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(to + 'T23:59:59');
    }
    const expenses = await VehicleExpense.find(filter).sort({ date: -1 });
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// DELETE — remove all inline-edit expense records for a vehicle+type within a week
// Must be before any /:id route to avoid the wildcard capturing "inline"
router.delete('/inline', async (req, res) => {
  try {
    const { vehicle, expenseType, weekStart, weekEnd, note } = req.body;
    if (!vehicle || !expenseType || !weekStart || !weekEnd) {
      return res.status(400).json({ message: 'vehicle, expenseType, weekStart, weekEnd are required' });
    }
    const start = new Date(weekStart); start.setHours(0, 0, 0, 0);
    const end   = new Date(weekEnd);   end.setHours(23, 59, 59, 999);
    const notePrefix = note || `Inline edit — ${expenseType}`;
    await VehicleExpense.deleteMany({
      vehicle:     vehicle,
      expenseType: expenseType,
      date:        { $gte: start, $lte: end },
      note:        notePrefix,
    });
    res.json({ message: 'Inline expense records cleared' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;