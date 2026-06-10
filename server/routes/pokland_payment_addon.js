// ── POKLAND PAYMENT ENDPOINTS (add these to pokland.js) ──

const PoklandPayment = require('../models/PoklandPayment');

// POST save/update pokland payment (owner bill, operator bill, or rental bill)
router.post('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor, totalBill, amountPaid, isPaid, isPartial, note } = req.body;
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const paid = Number(amountPaid) || 0;

    let rec = await PoklandPayment.findOne({ pokland: req.params.id, weekStart: wStart, paymentFor });
    if (rec) {
      Object.assign(rec, { totalBill: Number(totalBill)||0, amountPaid: paid, isPaid: Boolean(isPaid), isPartial: Boolean(isPartial), note: note||'', paidDate: new Date() });
      await rec.save();
    } else {
      rec = await PoklandPayment.create({
        pokland: new mongoose.Types.ObjectId(req.params.id),
        weekStart: wStart, paymentFor,
        totalBill: Number(totalBill)||0, amountPaid: paid,
        isPaid: Boolean(isPaid), isPartial: Boolean(isPartial),
        note: note||'', paidDate: new Date(),
      });
    }
    res.json(rec);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// GET pokland payment status
router.get('/:id/payment', async (req, res) => {
  try {
    const { weekStart, paymentFor } = req.query;
    const wStart = new Date(weekStart); wStart.setHours(0,0,0,0);
    const rec = await PoklandPayment.findOne({ pokland: req.params.id, weekStart: wStart, paymentFor });
    res.json(rec || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});
