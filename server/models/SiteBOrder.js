const mongoose = require('mongoose');

// ── Per-vehicle sub-document ──────────────────────────────────────────────────
const siteBVehicleSchema = new mongoose.Schema({
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  vehicleNumber: { type: String, default: '' },
  vehicleType:   { type: String, enum: ['Own', 'Rental'], default: 'Own' },

  driver:        { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  driverName:    { type: String, default: '' },
  conductor:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductorName: { type: String, default: '' },

  numberOfTrips:     { type: Number, default: 0 },
  amountForOwner:    { type: Number, default: 0 },   // trips × rateForOwner
  amountForCustomer: { type: Number, default: 0 },   // trips × rateForCustomer

  // ── Brass ──────────────────────────────────────────────────────────────────
  // How many brass per trip for this vehicle row (manually entered or defaulted from site)
  brassPerTrip:  { type: Number, default: 0 },
  // Calculated: numberOfTrips × brassPerTrip
  totalBrass:    { type: Number, default: 0 },
}, { _id: false });


const siteBOrderSchema = new mongoose.Schema({
  siteB: { type: mongoose.Schema.Types.ObjectId, ref: 'SiteB', required: true },
  date:  { type: Date, required: true },

  // ── Multi-vehicle rows ────────────────────────────────────────────────────
  vehicles: [siteBVehicleSchema],

  // ── Rates snapshot at time of order ──────────────────────────────────────
  rateForOwner:    { type: Number, required: true, default: 0 },
  rateForCustomer: { type: Number, required: true, default: 0 },

  // ── Royalty (manually entered per order) ──────────────────────────────────
  // Number of royalty units this order
  royaltyCount:  { type: Number, default: 0 },
  // Amount per royalty unit at time of order
  royaltyRate:   { type: Number, default: 0 },
  // Calculated: royaltyCount × royaltyRate  (added to customer bill)
  royaltyAmount: { type: Number, default: 0 },

  // ── Totals (sum across all vehicles) ─────────────────────────────────────
  numberOfTrips:     { type: Number, default: 0 },
  totalBrass:        { type: Number, default: 0 },  // sum of all vehicle brass
  amountForOwner:    { type: Number, default: 0 },
  amountForCustomer: { type: Number, default: 0 },  // trips amount + royaltyAmount

  // ── Legacy single-vehicle fields (kept for backward compatibility) ─────────
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  vehicleNumber: { type: String, default: '' },
  vehicleType:   { type: String, enum: ['Own', 'Rental'], default: 'Own' },
  driver:        { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  driverName:    { type: String, default: '' },
  conductor:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductorName: { type: String, default: '' },

  note: { type: String, default: '' },
}, { timestamps: true });

// ── Auto-calculate totals before save ─────────────────────────────────────────
siteBOrderSchema.pre('save', function(next) {
  // Royalty amount
  this.royaltyAmount = (this.royaltyCount || 0) * (this.royaltyRate || 0);

  if (this.vehicles && this.vehicles.length > 0) {
    // Per-vehicle brass calculation
    this.vehicles.forEach(v => {
      v.totalBrass = (v.numberOfTrips || 0) * (v.brassPerTrip || 0);
    });

    this.numberOfTrips     = this.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0);
    this.totalBrass        = this.vehicles.reduce((s, v) => s + (v.totalBrass || 0), 0);
    this.amountForOwner    = this.vehicles.reduce((s, v) => s + (v.amountForOwner || 0), 0);
    // Customer amount = trip amounts + royalty
    this.amountForCustomer = this.vehicles.reduce((s, v) => s + (v.amountForCustomer || 0), 0)
        + this.royaltyAmount;
  } else {
    // Legacy single-vehicle path
    this.amountForOwner    = this.numberOfTrips * this.rateForOwner;
    this.amountForCustomer = (this.numberOfTrips * this.rateForCustomer) + this.royaltyAmount;
  }
  next();
});

module.exports = mongoose.models.SiteBOrder || mongoose.model('SiteBOrder', siteBOrderSchema);