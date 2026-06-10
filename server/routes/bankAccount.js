const express = require('express');
const router = express.Router();
const BankAccount = require('../models/BankAccount');
const { protect } = require('../middleware/auth');

router.use(protect);

const OWNERS = ['Chand Laluwale', 'Roshan Laluwale', 'Home Expenses'];

// GET all bank accounts (optionally filter by owner)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.owner) filter.owner = req.query.owner;
    const accounts = await BankAccount.find(filter).sort({ createdAt: 1 }).lean();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create bank account
router.post('/', async (req, res) => {
  try {
    const { owner, accountName, accountNumber, balance } = req.body;
    if (!OWNERS.includes(owner))
      return res.status(400).json({ message: 'Invalid owner.' });
    if (!accountName || !accountName.trim())
      return res.status(400).json({ message: 'Account name is required.' });
    if (!accountNumber || !accountNumber.trim())
      return res.status(400).json({ message: 'Account number is required.' });

    const account = await BankAccount.create({
      owner,
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      balance: balance ? Number(balance) : 0,
    });
    res.status(201).json(account);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH update bank account details (name, number only — balance is managed by ledger)
router.patch('/:id', async (req, res) => {
  try {
    const { accountName, accountNumber } = req.body;
    const update = {};
    if (accountName  !== undefined) update.accountName  = accountName.trim();
    if (accountNumber !== undefined) update.accountNumber = accountNumber.trim();

    const account = await BankAccount.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!account) return res.status(404).json({ message: 'Bank account not found' });
    res.json(account);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE bank account
router.delete('/:id', async (req, res) => {
  try {
    await BankAccount.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
