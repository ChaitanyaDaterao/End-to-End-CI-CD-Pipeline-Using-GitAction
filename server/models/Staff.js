const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    default: '',
    validate: {
      validator: function(v) {
        return v === '' || /^\d{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  role: {
    type: String,
    enum: ['Driver', 'Conductor'],
    required: true
  },
  // Driver: ₹200 per trip (default) — locked into StaffAttendance at billing time
  ratePerTrip: {
    type: Number,
    default: 200
  },
  // Conductor: ₹450 per day (default) — locked into StaffAttendance at billing time
  dailyRate: {
    type: Number,
    default: 450
  },
  isActive: {
    type: Boolean,
    default: true
  },
  note: {
    type: String,
    default: ''
  },
}, { timestamps: true });

module.exports = mongoose.model('Staff', staffSchema);