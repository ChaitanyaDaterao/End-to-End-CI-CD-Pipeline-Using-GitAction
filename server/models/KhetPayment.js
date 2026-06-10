const mongoose = require('mongoose');

const khetPaymentSchema = new mongoose.Schema({
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  weekStart: { type: Date },
  totalBill: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false },
  isPartial: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('KhetPayment', khetPaymentSchema);