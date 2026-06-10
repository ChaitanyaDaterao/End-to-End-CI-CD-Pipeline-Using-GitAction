const mongoose = require('mongoose');

const BankAccountSchema = new mongoose.Schema({
  owner: {
    type: String,
    required: true,
    enum: ['Chand Laluwale', 'Roshan Laluwale', 'Home Expenses'],
  },
  accountName: {
    type: String,
    required: true,
    trim: true,
  },
  accountNumber: {
    type: String,
    required: true,
    trim: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

module.exports = mongoose.model('BankAccount', BankAccountSchema);
