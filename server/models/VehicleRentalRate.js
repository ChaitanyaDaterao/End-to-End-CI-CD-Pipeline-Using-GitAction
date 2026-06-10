const mongoose = require('mongoose');

// Stores the rental rate (per trip) for a specific vehicle on a specific date.
// When any module posts a trip for a rental vehicle, the backend looks up this
// collection by (vehicle + date) to find the correct rate for that day.
// If no rate is found for that exact date, it falls back to the vehicle's
// default rentalAmount field.

const vehicleRentalRateSchema = new mongoose.Schema({
  vehicle:      { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  date:         { type: Date, required: true },        // store as date-only (midnight UTC)
  ratePerTrip:  { type: Number, default: 0 },          // ₹ per trip for this day (Trip billing)
  ratePerBrass: { type: Number, default: 0 },          // ₹ per brass for this day (Quantity billing)
  note:         { type: String, default: '' },
}, { timestamps: true });

// Unique index: one rate record per vehicle per day
vehicleRentalRateSchema.index({ vehicle: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('VehicleRentalRate', vehicleRentalRateSchema);