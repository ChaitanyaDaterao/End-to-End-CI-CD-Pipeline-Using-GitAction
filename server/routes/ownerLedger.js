const express = require('express');
const router  = express.Router();
const OwnerLedger = require('../models/OwnerLedger');
const BankAccount = require('../models/BankAccount');
const { protect } = require('../middleware/auth');

router.use(protect);

const OWNERS    = ['Chand Laluwale', 'Roshan Laluwale', 'Home Expenses'];
const PAY_MODES = ['Cash', 'Online'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Adjust a bank account's balance when an entry is created / edited / deleted.
 * @param {string|null} bankAccountId
 * @param {'received'|'paid'} type
 * @param {number} amount   positive value
 * @param {number} sign     +1 to apply, -1 to reverse
 */
async function adjustBankBalance(bankAccountId, type, amount, sign = 1) {
  if (!bankAccountId) return;
  // received → money comes IN  (+)
  // paid     → money goes OUT  (-)
  const delta = type === 'received' ? amount * sign : -amount * sign;
  await BankAccount.findByIdAndUpdate(bankAccountId, { $inc: { balance: delta } });
}

// ─── Summary ────────────────────────────────────────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    const entries = await OwnerLedger.find({}).sort({ date: -1 }).lean();

    const summary = {};
    OWNERS.forEach(o => {
      PAY_MODES.forEach(m => {
        const key = `${o}||${m}`;
        summary[key] = { owner: o, paymentMode: m, totalReceived: 0, totalPaid: 0, balance: 0 };
      });
    });

    entries.forEach(e => {
      const mode = e.paymentMode || 'Cash';
      const key  = `${e.owner}||${mode}`;
      if (!summary[key]) return;
      if (e.type === 'received') summary[key].totalReceived += e.amount;
      else                       summary[key].totalPaid     += e.amount;
    });

    Object.values(summary).forEach(s => { s.balance = s.totalReceived - s.totalPaid; });
    res.json(Object.values(summary));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Entries ────────────────────────────────────────────────────────────────

// GET entries: ?owner=...&paymentMode=...&from=...&to=...
router.get('/entries', async (req, res) => {
  try {
    const { owner, paymentMode, from, to } = req.query;
    const filter = {};
    if (owner) filter.owner = owner;
    if (paymentMode) {
      if (paymentMode === 'Cash') {
        filter.$or = [
          { paymentMode: 'Cash' },
          { paymentMode: { $exists: false } },
          { paymentMode: null },
        ];
      } else {
        filter.paymentMode = paymentMode;
      }
    }
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(to + 'T23:59:59');
    }
    const entries = await OwnerLedger.find(filter)
        .sort({ date: -1 })
        .populate('bankAccountId', 'accountName accountNumber')
        .lean();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Add Entry ───────────────────────────────────────────────────────────────

// POST /entry  { owner, paymentMode, bankAccountId?, type, amount, note, date }
router.post('/entry', async (req, res) => {
  try {
    const { owner, type, amount, note, date, paymentMode, bankAccountId } = req.body;

    if (!OWNERS.includes(owner))
      return res.status(400).json({ message: 'Invalid owner.' });
    if (!['received', 'paid'].includes(type))
      return res.status(400).json({ message: 'type must be received or paid.' });
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ message: 'Amount must be greater than 0.' });

    const resolvedMode = PAY_MODES.includes(paymentMode) ? paymentMode : 'Cash';

    // Validate bank account belongs to owner when Online
    let resolvedBankId = null;
    if (resolvedMode === 'Online' && bankAccountId) {
      const bank = await BankAccount.findById(bankAccountId);
      if (!bank || bank.owner !== owner)
        return res.status(400).json({ message: 'Invalid bank account for this owner.' });
      resolvedBankId = bank._id;
    }

    const entry = await OwnerLedger.create({
      owner,
      type,
      amount:        Number(amount),
      note:          note || '',
      date:          date ? new Date(date) : new Date(),
      paymentMode:   resolvedMode,
      bankAccountId: resolvedBankId,
    });

    // Update linked bank balance
    await adjustBankBalance(resolvedBankId, type, Number(amount), +1);

    const populated = await entry.populate('bankAccountId', 'accountName accountNumber');
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Delete Entry ─────────────────────────────────────────────────────────────

router.delete('/entry/:id', async (req, res) => {
  try {
    const entry = await OwnerLedger.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Entry not found' });

    // Reverse bank balance before deleting
    await adjustBankBalance(entry.bankAccountId, entry.type, entry.amount, -1);

    await entry.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Edit Entry ───────────────────────────────────────────────────────────────

router.patch('/entry/:id', async (req, res) => {
  try {
    const { amount, note, date, paymentMode, type, bankAccountId } = req.body;

    const existing = await OwnerLedger.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Entry not found' });

    // Reverse old bank balance effect
    await adjustBankBalance(existing.bankAccountId, existing.type, existing.amount, -1);

    const update = {};
    if (amount      !== undefined) update.amount      = Number(amount);
    if (note        !== undefined) update.note        = note;
    if (date        !== undefined) update.date        = new Date(date);
    if (paymentMode !== undefined && PAY_MODES.includes(paymentMode)) update.paymentMode = paymentMode;
    if (type        !== undefined && ['received', 'paid'].includes(type)) update.type = type;

    // Resolve new bank account
    const newMode = update.paymentMode || existing.paymentMode;
    if (newMode === 'Online' && bankAccountId !== undefined) {
      if (bankAccountId) {
        const bank = await BankAccount.findById(bankAccountId);
        if (!bank || bank.owner !== existing.owner)
          return res.status(400).json({ message: 'Invalid bank account for this owner.' });
        update.bankAccountId = bank._id;
      } else {
        update.bankAccountId = null;
      }
    } else if (newMode === 'Cash') {
      update.bankAccountId = null;
    }

    const updatedEntry = await OwnerLedger.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true, runValidators: true }
    ).populate('bankAccountId', 'accountName accountNumber');

    // Apply new bank balance effect
    const finalType   = updatedEntry.type;
    const finalAmount = updatedEntry.amount;
    await adjustBankBalance(updatedEntry.bankAccountId, finalType, finalAmount, +1);

    res.json(updatedEntry);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;