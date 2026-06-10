const mongoose = require('mongoose');
const rentalPaymentSchema = new mongoose.Schema({
  ownerName: { type: String, required: true },
  weekStart: { type: Date, required: true },
  totalBill: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false },
  isPartial: { type: Boolean, default: false },
  paidDate: { type: Date, default: null },
  note: { type: String, default: '' },
}, { timestamps: true });
module.exports = mongoose.model('RentalPayment', rentalPaymentSchema);
