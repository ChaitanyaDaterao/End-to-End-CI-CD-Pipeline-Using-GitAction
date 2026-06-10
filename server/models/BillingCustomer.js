const mongoose = require('mongoose');

const billingCustomerSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  phone:            { type: String, default: '' },
  siteAddress:      { type: String, default: '' },
  billingType:      { type: String, enum: ['Trip', 'Quantity'], default: 'Trip' },
  ratePerTrip:      { type: Number, default: 0 },
  ratePerQuantity:  { type: Number, default: 0 },
  note:             { type: String, default: '' },
  isActive:         { type: Boolean, default: true },
}, { timestamps: true, collection: 'customers' });

module.exports = mongoose.model('BillingCustomer', billingCustomerSchema);
