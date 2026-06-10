const mongoose = require('mongoose');

const billOrderSchema = new mongoose.Schema({
  bill:           { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
  vehicle:        { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  date:           { type: Date, required: true },
  material:       { type: String, required: true, trim: true },
  numberOfTrips:  { type: Number, required: true, default: 0 },
  ratePerTrip:    { type: Number, required: true, default: 0 },
  totalAmount:    { type: Number, default: 0 },
  advanceAmount:  { type: Number, default: 0 },
  driverName:     { type: String, default: '' },
  note:           { type: String, default: '' },
  isDeleted:      { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('BillOrder', billOrderSchema);
