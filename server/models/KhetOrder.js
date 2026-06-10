const mongoose = require('mongoose');

const khetVehicleSchema = new mongoose.Schema({
  vehicle:         { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  vehicleNumber:   { type: String, default: '' },

  driver:          { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  driverName:      { type: String, default: '' },

  conductor:       { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductorName:   { type: String, default: '' },

  numberOfTrips:   { type: Number, default: 0 },
  quantity:        { type: Number, default: 0 },
  brassPerTrip:    { type: Number, default: 0 },
  rateApplied:     { type: Number, default: 0 },
  totalAmount:     { type: Number, default: 0 },

  hasRoyalty:      { type: Boolean, default: false },
  royaltyQuantity: { type: Number, default: 0 },
  royaltyRate:     { type: Number, default: 0 },
  royaltyAmount:   { type: Number, default: 0 },
}, { _id: false });


const khetOrderSchema = new mongoose.Schema({
  date:          { type: Date, required: true },
  customerName:  { type: String, default: '' },
  customerPhone: {
    type: String,
    default: '',
    validate: {
      // Allows empty string, but if data is entered, it must be exactly 10 digits
      validator: function(v) {
        return v === '' || /^\d{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  billingType:   { type: String, enum: ['Trip','Quantity'], required: true },
  quantityUnit:  { type: String, default: 'brass' },
  material:      { type: String, default: '' },
  destination:   { type: String, default: '' },
  vehicles:      [khetVehicleSchema],
  totalAmount:      { type: Number, default: 0 },
  royaltyQuantity:  { type: Number, default: 0 },
  royaltyRate:      { type: Number, default: 0 },
  totalRoyalty:     { type: Number, default: 0 },
  grandTotal:       { type: Number, default: 0 },
  note:          { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('KhetOrder', khetOrderSchema);