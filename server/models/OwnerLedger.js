const mongoose = require('mongoose');

const OwnerLedgerSchema = new mongoose.Schema({
  owner: {
    type: String,
    required: true,
    enum: ['Chand Laluwale', 'Roshan Laluwale', 'Home Expenses'],
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'Online'],
    default: 'Cash',
  },
  // Linked bank account — only used when paymentMode === 'Online'
  bankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null,
  },
  type: {
    type: String,
    enum: ['received', 'paid'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  note: {
    type: String,
    default: '',
  },
  date: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('OwnerLedger', OwnerLedgerSchema);