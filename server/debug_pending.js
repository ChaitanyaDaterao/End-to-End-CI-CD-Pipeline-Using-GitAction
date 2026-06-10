require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const BillingPaymentStatus = require('./models/BillingPaymentStatus');
  const KhetPayment          = require('./models/KhetPayment');
  const CustomerDelivery     = require('./models/CustomerDelivery');
  const Customer             = require('./models/Customer');

  const now   = new Date();
  const day   = now.getDay();
  const diff  = (day === 0 ? -6 : 1 - day);
  const start = new Date(now); start.setDate(now.getDate() + diff); start.setHours(0,0,0,0);
  const end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  const weekStartFrom = new Date(start.getTime() - 6 * 60 * 60 * 1000);

  console.log('Week:', start.toDateString(), '→', end.toDateString());

  // Check BillingPaymentStatus
  const bps = await BillingPaymentStatus.find({
    weekStart: { $gte: weekStartFrom, $lte: end },
  }).populate('customer', 'name').lean();

  console.log('\n--- BillingPaymentStatus this week ---');
  console.log('Count:', bps.length);
  bps.forEach(b => console.log(
    ' -', b.customer?.name || 'UNKNOWN',
    '| totalBill:', b.totalBill,
    '| amountPaid:', b.amountPaid,
    '| isPaid:', b.isPaid,
    '| isPartial:', b.isPartial,
    '| weekStart:', b.weekStart?.toISOString().split('T')[0]
  ));

  // Check KhetPayment
  const kp = await KhetPayment.find({
    weekStart: { $gte: weekStartFrom, $lte: end },
  }).lean();

  console.log('\n--- KhetPayment this week ---');
  console.log('Count:', kp.length);
  kp.forEach(k => console.log(
    ' -', k.customerName,
    '| totalBill:', k.totalBill,
    '| amountPaid:', k.amountPaid,
    '| isPaid:', k.isPaid,
    '| weekStart:', k.weekStart?.toISOString().split('T')[0]
  ));

  // Check what deliveries exist this week (to see if totalBill should be non-zero)
  const deliveries = await CustomerDelivery.find({
    date: { $gte: start, $lte: end },
  }).populate('customer', 'name').lean();

  console.log('\n--- CustomerDeliveries this week ---');
  console.log('Count:', deliveries.length);
  deliveries.forEach(d => console.log(
    ' -', d.customer?.name || 'UNKNOWN',
    '| totalAmount:', d.totalAmount,
    '| date:', d.date?.toISOString().split('T')[0]
  ));

  mongoose.disconnect();
});
