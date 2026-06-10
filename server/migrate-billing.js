/**
 * migrate-billing.js
 * One-time migration: Bill + BillOrder  →  BillingCustomer + BillingDelivery
 *
 * Run from your project root:
 *   node migrate-billing.js
 *
 * Safe to run multiple times — skips customers/deliveries already migrated
 * (detected by a matching migratedFromBill flag).
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ── Old models (inline so this script is self-contained) ──────────────────
const Bill = mongoose.model('Bill', new mongoose.Schema({
  customer:      String,
  address:       String,
  startDate:     Date,
  endDate:       Date,
  note:          String,
  totalAmount:   Number,
  totalAdvance:  Number,
  pendingAmount: Number,
  status:        String,
  isDeleted:     Boolean,
}, { timestamps: true, strict: false }));

const BillOrder = mongoose.model('BillOrder', new mongoose.Schema({
  bill:          { type: mongoose.Schema.Types.ObjectId, ref: 'Bill' },
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  date:          Date,
  material:      String,
  numberOfTrips: Number,
  ratePerTrip:   Number,
  totalAmount:   Number,
  advanceAmount: Number,
  driverName:    String,
  note:          String,
  isDeleted:     Boolean,
}, { timestamps: true, strict: false }));

// ── New models ─────────────────────────────────────────────────────────────
const vehicleEntrySchema = new mongoose.Schema({
  vehicle:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  numberOfTrips: { type: Number, default: 0 },
  quantity:      { type: Number, default: 0 },
  rateApplied:   { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },
  driverId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  conductorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
  dailyRent:     { type: Number, default: 0 },
}, { _id: false });

const BillingCustomer = mongoose.model('BillingCustomer', new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  phone:           { type: String, default: '' },
  siteAddress:     { type: String, default: '' },
  billingType:     { type: String, default: 'Trip' },
  ratePerTrip:     { type: Number, default: 0 },
  ratePerQuantity: { type: Number, default: 0 },
  note:            { type: String, default: '' },
  isActive:        { type: Boolean, default: true },
  migratedFromBill:{ type: Boolean, default: false }, // migration marker
}, { timestamps: true }));

const BillingDelivery = mongoose.model('BillingDelivery', new mongoose.Schema({
  customer:           { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer', required: true },
  date:               { type: Date, required: true },
  billingType:        { type: String, default: 'Trip' },
  quantityUnit:       { type: String, default: '' },
  material:           { type: String, default: '' },
  destination:        { type: String, default: '' },
  note:               { type: String, default: '' },
  vehicles:           [vehicleEntrySchema],
  totalAmount:        { type: Number, default: 0 },
  migratedFromOrder:  mongoose.Schema.Types.ObjectId, // keeps old BillOrder _id for dedup
}, { timestamps: true }));

const BillingPayment = mongoose.model('BillingPayment', new mongoose.Schema({
  customer:  { type: mongoose.Schema.Types.ObjectId, ref: 'BillingCustomer' },
  amount:    Number,
  date:      { type: Date, default: Date.now },
  weekStart: { type: Date, default: null },
  note:      { type: String, default: '' },
}, { timestamps: true }));

// ── Migration ──────────────────────────────────────────────────────────────
async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Load all non-deleted bills
  const bills = await Bill.find({ isDeleted: { $ne: true } });
  console.log(`📋 Found ${bills.length} bills to migrate`);

  let custCreated = 0, custReused = 0, delivCreated = 0, payCreated = 0, skipped = 0;

  // Build a name→BillingCustomer map so duplicate customer names share one record
  const custCache = {};

  // Pre-load any already-migrated customers to avoid duplication on re-run
  const existingMigrated = await BillingCustomer.find({ migratedFromBill: true });
  for (const c of existingMigrated) {
    custCache[c.name.trim().toLowerCase()] = c;
  }

  for (const bill of bills) {
    const nameKey = (bill.customer || 'Unknown').trim().toLowerCase();

    // ── 1. Find or create BillingCustomer ─────────────────────────────
    let customer = custCache[nameKey];
    if (!customer) {
      customer = await BillingCustomer.create({
        name:            bill.customer.trim(),
        siteAddress:     bill.address || '',
        note:            bill.note || '',
        billingType:     'Trip',
        migratedFromBill: true,
      });
      custCache[nameKey] = customer;
      custCreated++;
      console.log(`  👤 Created customer: ${customer.name}`);
    } else {
      custReused++;
    }

    // ── 2. Migrate orders as BillingDeliveries ────────────────────────
    const orders = await BillOrder.find({ bill: bill._id, isDeleted: { $ne: true } });

    for (const order of orders) {
      // Dedup: skip if we already migrated this BillOrder
      const alreadyMigrated = await BillingDelivery.findOne({ migratedFromOrder: order._id });
      if (alreadyMigrated) { skipped++; continue; }

      const vehicleEntry = {
        vehicle:       order.vehicle || null,
        numberOfTrips: order.numberOfTrips || 0,
        quantity:      0,
        rateApplied:   order.ratePerTrip || 0,
        totalAmount:   order.totalAmount || 0,
        driverId:      null,   // old schema stored driverName as string, no ObjectId
        conductorId:   null,
        dailyRent:     0,
      };

      await BillingDelivery.create({
        customer:          customer._id,
        date:              order.date,
        billingType:       'Trip',
        material:          order.material || '',
        destination:       bill.address || '',
        note:              order.note || '',
        vehicles:          [vehicleEntry],
        totalAmount:       order.totalAmount || 0,
        migratedFromOrder: order._id,
      });
      delivCreated++;
    }

    // ── 3. Migrate advance amounts as BillingPayments ─────────────────
    // Old schema stored advance per-order, not as a separate payment document.
    // We roll them up into one payment per bill to avoid duplicating.
    const totalAdvance = orders.reduce((s, o) => s + (o.advanceAmount || 0), 0);
    if (totalAdvance > 0) {
      // Check if we already created a payment for this bill
      const alreadyPaid = await BillingPayment.findOne({
        customer: customer._id,
        note:     `migrated:bill:${bill._id}`,
      });
      if (!alreadyPaid) {
        await BillingPayment.create({
          customer:  customer._id,
          amount:    totalAdvance,
          date:      bill.endDate || bill.startDate || bill.createdAt || new Date(),
          note:      `migrated:bill:${bill._id}`,
        });
        payCreated++;
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Migration complete`);
  console.log(`   Customers created : ${custCreated}`);
  console.log(`   Customers reused  : ${custReused}`);
  console.log(`   Deliveries created: ${delivCreated}`);
  console.log(`   Payments migrated : ${payCreated}`);
  console.log(`   Orders skipped (already migrated): ${skipped}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
