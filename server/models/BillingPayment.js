const mongoose = require('mongoose');

const billingPaymentSchema = new mongoose.Schema({
  customer:  { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer', required: true },
  amount:    { type: Number, required: true },
  date:      { type: Date, default: Date.now },
  weekStart: { type: Date, default: null },
  note:      { type: String, default: '' },
}, { timestamps: true, collection: 'customerpayments' });

module.exports = mongoose.model('BillingPayment', billingPaymentSchema);
