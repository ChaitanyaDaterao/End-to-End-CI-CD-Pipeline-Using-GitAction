const mongoose = require('mongoose');

const siteBSchema = new mongoose.Schema({
  // Owner details
  ownerName:        { type: String, required: true, trim: true },
  ownerPhone:       {
    type: String,
    default: '',
    validate: {
      validator: function(v) { return v === '' || /^\d{10}$/.test(v); },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  rateForOwner:     { type: Number, required: true, default: 0 },

  // Customer details
  customerName:     { type: String, required: true, trim: true },
  customerPhone:    {
    type: String,
    default: '',
    validate: {
      validator: function(v) { return v === '' || /^\d{10}$/.test(v); },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  rateForCustomer:  { type: Number, required: true, default: 0 },

  // Site / delivery info
  deliveryAddress:  { type: String, required: true, trim: true },

  // Vehicle type preference
  vehicleType:      { type: String, enum: ['Own', 'Rental', 'Both'], default: 'Both' },

  // ── Royalty ──────────────────────────────────────────────────────
  // Default royalty amount per unit (can be overridden per order)
  royaltyRate:      { type: Number, default: 0 },

  // ── Brass ────────────────────────────────────────────────────────
  // Default brass per trip (can be overridden per vehicle row in order)
  brassPerTrip:     { type: Number, default: 0 },

  note:             { type: String, default: '' },
  isActive:         { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.SiteB || mongoose.model('SiteB', siteBSchema);