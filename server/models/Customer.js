const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    // Ensures exactly 10 digits and no other characters
    validate: {
      validator: function(v) {
        return /^\d{10}$/.test(v);
      },
      message: props => `${props.value} must be exactly 10 digits!`
    }
  },
  siteAddress: { type: String, default: '' },
  billingType: { type: String, enum: ['Trip', 'Quantity'], default: 'Trip' },
  ratePerTrip: { type: Number, default: 0 },
  ratePerQuantity: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);