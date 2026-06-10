const mongoose = require('mongoose');

const staffAttendanceSchema = new mongoose.Schema({
  staff:         { type: mongoose.Schema.Types.ObjectId, ref: 'Staff',   required: true },
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  date:          { type: Date, required: true },

  // Driver fields
  numberOfTrips: { type: Number, default: 0 },
  ratePerTrip:   { type: Number, default: 0 },  // locked at billing time

  // Conductor fields
  present:       { type: Boolean, default: true },
  dailyRate:     { type: Number, default: 0 },  // locked at billing time

  // Earned pay for this record — trips * ratePerTrip  OR  dailyRate if present
  earnedAmount:  { type: Number, default: 0 },

  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('StaffAttendance', staffAttendanceSchema);