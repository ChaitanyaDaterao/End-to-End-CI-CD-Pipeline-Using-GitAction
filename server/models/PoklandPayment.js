const mongoose = require('mongoose');

const poklandPaymentSchema = new mongoose.Schema({
  pokland: { type: mongoose.Schema.Types.ObjectId, ref: 'Pokland', required: true },
  paymentFor: { type: String, enum: ['owner', 'operator', 'rental'], required: true },
  weekStart: { type: Date, required: true },
  totalBill: { type: Number, default: 0, required: true },
  dieselDeduction:      { type: Number, default: 0 }, // cumulative diesel cost for the week
  maintenanceDeduction: { type: Number, default: 0 }, // cumulative maintenance cost for the week
  amountPaid: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false },
  isPartial: { type: Boolean, default: false },
  // Added to explicitly track if the record should show in "Yet to Receive"
  isPending: { type: Boolean, default: true },
  paidDate: { type: Date, default: null },
  note: { type: String, default: '' },
}, { timestamps: true });

// Pre-save middleware to automatically update isPaid status based on amounts
poklandPaymentSchema.pre('save', function(next) {
  if (this.amountPaid >= this.totalBill && this.totalBill > 0) {
    this.isPaid = true;
    this.isPending = false;
    this.isPartial = false;
  } else if (this.amountPaid > 0) {
    this.isPaid = false;
    this.isPending = true;
    this.isPartial = true;
  } else {
    this.isPaid = false;
    this.isPending = true;
    this.isPartial = false;
  }
  next();
});

module.exports = mongoose.model('PoklandPayment', poklandPaymentSchema);