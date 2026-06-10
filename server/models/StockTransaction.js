const mongoose = require('mongoose');

const stockTransactionSchema = new mongoose.Schema({
  material:     { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
  type:         { type: String, enum: ['IN', 'OUT'], required: true },
  quantity:     { type: Number, required: true },
  pricePerUnit: { type: Number, default: 0 },
  totalAmount:  { type: Number, default: 0 },
  source:       { type: String, default: '' },      // supplier name
  destination:  { type: String, default: '' },      // delivery site
  vehicle:      { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  driver:       { type: mongoose.Schema.Types.ObjectId, ref: 'Staff',   default: null },
  note:         { type: String, default: '' },
  date:         { type: Date,   default: Date.now },
  // For OUT entries created by Khet orders
  khetOrderId:  { type: mongoose.Schema.Types.ObjectId, ref: 'KhetOrder', default: null },
  khetCustomer: { type: String, default: '' },
  billingType:  { type: String, default: '' },      // 'Trip' or 'Quantity'
  brassPerTrip: { type: Number, default: 0 },       // only for Trip type
}, { timestamps: true });

module.exports = mongoose.model('StockTransaction', stockTransactionSchema);