const mongoose = require('mongoose');

const vehicleExpenseSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  date: { type: Date, default: Date.now },
  expenseType: {
    type: String,
    enum: ['Diesel', 'Maintenance', 'Tyre', 'Oil Change', 'Repair', 'Driver Payment', 'Other'],
    required: true
  },
  amount: { type: Number, required: true },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('VehicleExpense', vehicleExpenseSchema);
