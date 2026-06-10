const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
  customer:       { type: String, required: true, trim: true },
  address:        { type: String, default: '' },
  startDate:      { type: Date },
  endDate:        { type: Date },
  note:           { type: String, default: '' },
  totalAmount:    { type: Number, default: 0 },
  totalAdvance:   { type: Number, default: 0 },
  pendingAmount:  { type: Number, default: 0 },
  status:         { type: String, enum: ['open', 'closed', 'paid'], default: 'open' },
  isDeleted:      { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Bill', billSchema);
