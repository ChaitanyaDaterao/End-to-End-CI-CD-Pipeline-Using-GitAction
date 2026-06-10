const mongoose = require('mongoose');

const billingPaymentStatusSchema = new mongoose.Schema({
  customer:   { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer', required: true },
  weekStart:  { type: Date, required: true },
  totalBill:  { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  isPaid:     { type: Boolean, default: false },
  isPartial:  { type: Boolean, default: false },
  paidDate:   { type: Date, default: null },
  note:       { type: String, default: '' },
}, { timestamps: true, collection: 'billingpaymentstatuses' });

module.exports = mongoose.model('BillingPaymentStatus', billingPaymentStatusSchema);
