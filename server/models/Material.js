const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  unit:          { type: String, required: true, enum: ['brass','trip','ton','kg','bag','cubic ft','piece','litre'], default: 'brass' },
  currentStock:  { type: Number, default: 0 },   // can go negative — shows real deficit
  lowStockAlert: { type: Number, default: 10 },
  pricePerUnit:  { type: Number, default: 0 },
  description:   { type: String, default: '' },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Material', materialSchema);