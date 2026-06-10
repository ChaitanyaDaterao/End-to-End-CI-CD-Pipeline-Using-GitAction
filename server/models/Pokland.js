const mongoose = require('mongoose');

const poklandSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  ownershipType: { type: String, enum: ['Own', 'Rental'], required: true },
  // Own pokland
  pricePerTrip: { type: Number, default: 0 },
  // Rental pokland
  rentalOwnerName: { type: String, default: '' },
  rentalOwnerPhone: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Pokland', poklandSchema);
