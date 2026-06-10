const mongoose = require('mongoose');

const vehicleTripSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerDelivery', default: null },
  tripDate: { type: Date, default: Date.now },
  source: { type: String, default: '' },
  destination: { type: String, default: '' },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null },
  quantity: { type: Number, default: 0 },
  quantityUnit: { type: String, default: 'brass' },
  numberOfTrips: { type: Number, default: 1 },
  billingType: { type: String, enum: ['Trip', 'Quantity'], default: 'Trip' },
  rateApplied: { type: Number, default: 0 },
  tripAmount: { type: Number, default: 0 },
  dieselFilled: { type: Number, default: 0 },
  dieselAmount: { type: Number, default: 0 },
  rentalTripRate: { type: Number, default: 0 },   // rate per trip (used when billingType === 'Trip')
  rentalQuantityRate: { type: Number, default: 0 }, // rate per unit (used when billingType === 'Quantity')
  rentalAmount: { type: Number, default: 0 },
  driverName: { type: String, default: '' },
  conductorName: { type: String, default: '' },
  note: { type: String, default: '' },
  isPaid: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('VehicleTrip', vehicleTripSchema);