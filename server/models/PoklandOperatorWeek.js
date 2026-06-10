const mongoose = require('mongoose');

// Weekly operator attendance + payment
const poklandOperatorWeekSchema = new mongoose.Schema({
  pokland: { type: mongoose.Schema.Types.ObjectId, ref: 'Pokland', required: true },
  operator: { type: mongoose.Schema.Types.ObjectId, ref: 'PoklandOperator', required: true },
  weekStart: { type: Date, required: true },
  weeklyAmount: { type: Number, default: 0 },  // fixed amount for the week
  daysPresent: [{ type: Date }],               // list of dates present
  cameAtAll: { type: Boolean, default: false }, // if true, pays full weekly amount
  isPaid: { type: Boolean, default: false },
  note: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('PoklandOperatorWeek', poklandOperatorWeekSchema);
