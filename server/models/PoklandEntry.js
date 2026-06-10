const mongoose = require('mongoose');

const poklandEntrySchema = new mongoose.Schema({
  pokland:      { type: mongoose.Schema.Types.ObjectId, ref: 'Pokland', required: true },
  date:         { type: Date, default: Date.now },
  // Own: Trip only. Rental: Hourly, Daily, Brass, Trip (all four)
  entryType:    { type: String, enum: ['Trip', 'Hourly', 'Daily', 'Brass'], required: true },
  // Trip fields (Own pokland)
  numberOfTrips: { type: Number, default: 0 },
  pricePerTrip:  { type: Number, default: 0 },
  // Hourly fields (Rental)
  hoursUsed:   { type: Number, default: 0 },
  hourlyRate:  { type: Number, default: 0 },
  // Daily fields (Rental)
  dailyCharge: { type: Number, default: 0 },
  // Brass fields (Rental)
  brassQuantity: { type: Number, default: 0 },
  brassRate:     { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },
  // Filled manually by owner — deducted from net payable (both Own & Rental)
  dieselCost:       { type: Number, default: 0 },
  maintenanceCost:  { type: Number, default: 0 },
  note:          { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('PoklandEntry', poklandEntrySchema);