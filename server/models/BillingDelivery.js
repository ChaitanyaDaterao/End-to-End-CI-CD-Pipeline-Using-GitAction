const mongoose = require('mongoose');

const vehicleEntrySchema = new mongoose.Schema({
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  vehicleType:   { type: String, default: '' },          // 'Own' | 'Rental' — stored in DB
  numberOfTrips: { type: Number, default: 0 },
  quantity:      { type: Number, default: 0 },
  rateApplied:   { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },
  dailyRent:     { type: Number, default: 0 },
  // ── driver / conductor stored as name strings (not ObjectId refs) ──────────
  driver:        { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductor:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  driverName:    { type: String, default: '' },
  conductorName: { type: String, default: '' },
});

const billingDeliverySchema = new mongoose.Schema({
  customer:     { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer', required: true },
  date:         { type: Date, required: true },
  billingType:  { type: String, enum: ['Trip', 'Quantity'], default: 'Trip' },
  quantityUnit: { type: String, default: '' },
  material:     { type: String, default: '' },
  destination:  { type: String, default: '' },
  note:         { type: String, default: '' },
  vehicles:     [vehicleEntrySchema],
  totalAmount:  { type: Number, default: 0 },
}, { timestamps: true, collection: 'customerdeliveries' });

module.exports = mongoose.model('BillingDelivery', billingDeliverySchema);
