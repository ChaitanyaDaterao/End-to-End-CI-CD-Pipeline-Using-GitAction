const mongoose = require('mongoose');

const vehicleEntrySchema = new mongoose.Schema({
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  vehicleType:   { type: String, default: '' },
  driver:        { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductor:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  driverName:    { type: String, default: '' },
  conductorName: { type: String, default: '' },
  numberOfTrips: { type: Number, default: 0 },
  quantity:      { type: Number, default: 0 },
  rateApplied:   { type: Number, default: 0 },
  dailyRent:     { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },
});

const customerDeliverySchema = new mongoose.Schema({
  customer:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  date:         { type: Date, default: Date.now },
  billingType:  { type: String, enum: ['Trip', 'Quantity'], required: true },
  quantityUnit: { type: String, default: 'brass' },
  material:     { type: String, default: '' },
  destination:  { type: String, default: '' },   // ← NEW
  note:         { type: String, default: '' },
  vehicles:     [vehicleEntrySchema],
  totalAmount:  { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('CustomerDelivery', customerDeliverySchema);