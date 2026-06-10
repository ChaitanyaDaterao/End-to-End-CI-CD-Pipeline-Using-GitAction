const mongoose = require('mongoose');

const driverEntrySchema = new mongoose.Schema({
  name: { type: String, required: true },
  assignedDate: { type: Date, default: Date.now },
});

const vehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true, trim: true },
  vehicleType: { type: String, required: true, enum: ['Truck', 'Tractor', 'JCB', 'Dumper', 'Mini Truck', 'Other'] },
  ownershipType: { type: String, required: true, enum: ['Own', 'Rental'], default: 'Own' },
  drivers: [driverEntrySchema],
  conductors: [driverEntrySchema],
  rentalOwnerName: { type: String, default: '' },
  rentalDate: { type: Date, default: null },
  rentalAmount: { type: Number, default: 0 },          // default rate per trip
  rentalAmountPerBrass: { type: Number, default: 0 },   // default rate per brass (quantity billing)
  dieselAmount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Vehicle', vehicleSchema);