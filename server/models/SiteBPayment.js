const mongoose = require('mongoose');

const SiteBPaymentSchema = new mongoose.Schema({
  siteB: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SiteB',
    required: true
  },
  weekStart:  { type: Date, required: true },
  paymentFor: { type: String, enum: ['owner', 'customer'], required: true },

  // ── Bill breakdown ────────────────────────────────────────────────────────
  // Bill from this week's orders only (trips + royalty)
  currentWeekBill:  { type: Number, default: 0 },
  // Unpaid balance carried forward from the previous week
  carryForward:     { type: Number, default: 0 },
  // Total bill = currentWeekBill + carryForward
  totalBill:        { type: Number, default: 0, required: true },

  // ── Week trip & royalty totals (for display / reporting) ─────────────────
  totalTrips:        { type: Number, default: 0 },
  totalBrass:        { type: Number, default: 0 },
  totalRoyaltyCount: { type: Number, default: 0 },
  totalRoyaltyAmount:{ type: Number, default: 0 },

  // ── Payment status ────────────────────────────────────────────────────────
  amountPaid: { type: Number, default: 0 },
  isPaid:     { type: Boolean, default: false },
  isPartial:  { type: Boolean, default: false },
  isPending:  { type: Boolean, default: true },
  paidDate:   { type: Date, default: null },

  note: { type: String, default: '' }
}, { timestamps: true });

// ── Auto-update status flags ──────────────────────────────────────────────────
SiteBPaymentSchema.pre('save', function(next) {
  if (this.amountPaid >= this.totalBill && this.totalBill > 0) {
    this.isPaid    = true;
    this.isPending = false;
    this.isPartial = false;
  } else if (this.amountPaid > 0) {
    this.isPaid    = false;
    this.isPending = true;
    this.isPartial = true;
  } else {
    this.isPaid    = false;
    this.isPending = true;
    this.isPartial = false;
  }
  next();
});

// One 'owner' record AND one 'customer' record per site per week
SiteBPaymentSchema.index({ siteB: 1, weekStart: 1, paymentFor: 1 }, { unique: true });

module.exports = mongoose.models.SiteBPayment
    || mongoose.model('SiteBPayment', SiteBPaymentSchema);