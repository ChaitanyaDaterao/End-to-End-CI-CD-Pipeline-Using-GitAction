const mongoose = require('mongoose');

const staffAdvanceSchema = new mongoose.Schema({
  staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  note: { type: String, default: '' },
  weekStart: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('StaffAdvance', staffAdvanceSchema);
