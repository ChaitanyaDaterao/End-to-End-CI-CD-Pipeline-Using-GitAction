const mongoose = require('mongoose');

const staffPaymentSchema = new mongoose.Schema({
  staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  weekStart: { type: Date, required: true },
  grossPay: { type: Number, default: 0 },
  totalAdvance: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false },
  isPartial: { type: Boolean, default: false },
  paidDate: { type: Date, default: null },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('StaffPayment', staffPaymentSchema);
