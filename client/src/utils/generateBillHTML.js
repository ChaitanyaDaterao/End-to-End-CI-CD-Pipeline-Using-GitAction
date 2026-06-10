/**
 * generateBillHTML.js
 * Produces a printable "Outstanding Bill" HTML string.
 * The on-screen UI bill in Billing.js is NOT affected by this file.
 *
 * Print layout adds:
 *   - Top letterhead: RC logo, "R.C Enterprises", owner names, divider, bill title
 *   - Bill content (same structure as the on-screen card)
 *   - Bottom developer footer
 *
 * Usage:
 *   import { generateBillHTML } from '../utils/generateBillHTML';
 *   const html = generateBillHTML({ bill, billType, logoUrl: '/logo.png' });
 *   openPrintWindow(html, `Outstanding Bill — ${bill.customer.name}`);
 */

const fmt  = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtD = (d) => new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });

export function generateBillHTML({
                                   bill,
                                   billType,
                                   companyName     = 'R.C. Enterprises',
                                   companySubtitle = 'CHAND LALUWALE & ROSHAN LALUWALE',
                                   logoUrl         = '',   // e.g. '/logo.png' or a hosted URL
                                 }) {
  if (!bill) return '';

  const periodLabel = billType === 'weekly'
      ? `Period: ${fmtD(bill.weekStart)} to ${fmtD(bill.weekEnd)}`
      : `Date: ${fmtD(bill.date)}`;

  const allDeliveries = billType === 'weekly'
      ? (bill.dailyGroups || []).flatMap(g => g.deliveries || [])
      : (bill.deliveries  || []);

  const isPickup = (d) =>
      d.billingType === 'Quantity' ||
      (d.destination || '').toLowerCase().includes('pick') ||
      (d.module      || '').toLowerCase().includes('pick');

  const deliveredRows  = allDeliveries.filter(d => !isPickup(d));
  const pickupRows     = allDeliveries.filter(d =>  isPickup(d));

  const totalBilled    = bill.weekTotal ?? bill.totalAmount ?? 0;
  const totalPaid      = bill.weekPaid  ?? 0;
  const netOutstanding = Math.max(0, bill.netDue ?? (totalBilled - totalPaid));
  const deliveredTotal = deliveredRows.reduce((s, d) => s + (d.totalAmount || 0), 0);
  const pickupTotal    = pickupRows.reduce((s,   d) => s + (d.totalAmount || 0), 0);

  let rowIndex = 0;
  const buildRows = (rows) => rows.map(d => {
    rowIndex++;
    const vehs     = (d.vehicles || [])
        .map(v => `<span class="veh-badge">${v.vehicle?.vehicleNumber || v.vehicleNumber || '&mdash;'}</span>`)
        .join(' ');
    const trips    = d.vehicles?.reduce((s, v) => s + (v.numberOfTrips || 0), 0) || 0;
    const qty      = d.vehicles?.reduce((s, v) => s + (v.quantity || 0),      0) || 0;
    const tripsQty = d.billingType === 'Trip'
        ? `${trips} trip${trips !== 1 ? 's' : ''}`
        : `${qty} ${d.quantityUnit || ''}`;
    const lbl = isPickup(d) ? 'Pick - up' : 'Delivered';
    const cls = isPickup(d) ? 'badge-pickup' : 'badge-delivered';
    return `<tr>
      <td class="tc">${rowIndex}</td>
      <td>${fmtD(d.date)}</td>
      <td><span class="mod-badge ${cls}">${lbl}</span></td>
      <td>${d.material || '&mdash;'}</td>
      <td class="bold">${tripsQty}</td>
      <td>${vehs}</td>
      <td class="tr bold">&#x20B9;${fmt(d.totalAmount)}</td>
    </tr>`;
  }).join('');

  const subRow = (label, balance, total, cls) =>
      `<tr class="subtotal-row ${cls}">
      <td colspan="4" class="subtotal-label">${label}</td>
      <td colspan="2" class="subtotal-info">Paid: <span class="paid-zero">&#x20B9;0</span> | Balance: <span class="bal-red">&#x20B9;${fmt(balance)}</span></td>
      <td class="tr bold">&#x20B9;${fmt(total)}</td>
    </tr>`;

  const logoTag = logoUrl
      ? `<img src="${logoUrl}" alt="RC Logo" class="lh-logo" onerror="this.style.display='none';document.querySelector('.lh-fb').style.display='flex'"/>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Outstanding Bill &mdash; ${bill.customer?.name || ''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;font-size:13px}
  .page{max-width:820px;margin:0 auto;padding:28px 32px}

  /* LETTERHEAD */
  .letterhead{text-align:center;margin-bottom:20px}
  .lh-logo-wrap{display:inline-flex;align-items:center;justify-content:center;
    width:80px;height:80px;border-radius:50%;border:2px solid #222;
    overflow:hidden;margin:0 auto 10px;background:#111}
  .lh-logo{width:80px;height:80px;object-fit:cover;border-radius:50%}
  .lh-fb{display:none;width:80px;height:80px;border-radius:50%;background:#111;
    color:#fff;font-size:26px;font-weight:900;align-items:center;justify-content:center}
  .lh-company{font-size:22px;font-weight:900;color:#111;margin-bottom:4px}
  .lh-owners{font-size:12px;color:#444;margin-bottom:12px}
  .lh-divider{border:none;border-top:1.5px solid #ccc;width:75%;margin:0 auto 10px}
  .lh-btitle{font-size:13px;font-weight:700;color:#111}

  /* HEADER */
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .company-name{font-size:22px;font-weight:900;color:#111;letter-spacing:-0.5px}
  .company-sub{font-size:11px;color:#555;margin-top:2px;letter-spacing:0.6px}
  .bill-meta{text-align:right}
  .bill-title-lbl{font-size:15px;font-weight:800;color:#1a56db}
  .customer-name{font-size:20px;font-weight:900;color:#111;margin-top:2px}
  .bill-period{font-size:11px;color:#777;margin-top:4px}
  .divider{border:none;border-top:2px solid #111;margin:10px 0 16px}

  /* SUMMARY CARDS */
  .summary-cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px}
  .card{border-radius:6px;padding:12px 16px}
  .card-blue{background:#eff6ff;border:1px solid #bfdbfe}
  .card-green{background:#f0fdf4;border:1px solid #bbf7d0}
  .card-orange{background:#fff7ed;border:1px solid #fed7aa}
  .card-label{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:5px}
  .card-blue .card-label{color:#1a56db}
  .card-green .card-label{color:#16a34a}
  .card-orange .card-label{color:#ea580c}
  .card-value{font-size:22px;font-weight:900}
  .card-blue .card-value{color:#1e40af}
  .card-green .card-value{color:#15803d}
  .card-orange .card-value{color:#dc2626}

  /* TABLE */
  table{width:100%;border-collapse:collapse}
  thead tr{background:#111;color:#fff}
  thead th{padding:9px 11px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:left}
  thead th.tr{text-align:right}
  tbody tr{border-bottom:1px solid #e5e7eb}
  tbody td{padding:9px 11px;color:#222;vertical-align:middle}
  td.tc{text-align:center;color:#666}
  td.tr{text-align:right}
  td.bold{font-weight:700}

  /* BADGES */
  .veh-badge{display:inline-block;background:#e0e7ff;color:#3730a3;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600;margin:1px 2px}
  .mod-badge{display:inline-block;border-radius:4px;padding:2px 9px;font-size:11px;font-weight:700}
  .badge-delivered{background:#dbeafe;color:#1e40af}
  .badge-pickup{background:#fef9c3;color:#854d0e}

  /* SUB-TOTALS */
  .subtotal-row td{padding:8px 11px;font-weight:700;border-top:1px solid #d1d5db}
  .subtotal-delivered .subtotal-label{color:#1a56db}
  .subtotal-pickup    .subtotal-label{color:#ca8a04}
  .subtotal-info{color:#555;font-weight:500;font-size:12px}
  .paid-zero{color:#16a34a}
  .bal-red{color:#dc2626}

  /* FOOTER ROWS */
  .grand-row td{padding:11px 12px;font-size:14px;font-weight:800;color:#fff;background:#111}
  .total-paid-row td{padding:9px 12px;color:#16a34a;font-weight:700}
  .net-row td{padding:10px 12px;color:#dc2626;font-weight:800;font-size:14px}

  /* SIGNATURES */
  .signatures{display:flex;justify-content:space-between;margin-top:36px}
  .sig-block{text-align:center;width:200px}
  .sig-line{border-top:1px solid #aaa;padding-top:8px;font-size:12px;color:#555}

  /* DEVELOPER FOOTER */
  .dev-footer{text-align:center;font-size:11px;color:#777;margin-top:22px;padding-top:10px;border-top:1px solid #ddd}

  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{padding:14px 18px}
  }
</style>
</head>
<body>
<div class="page">

  <!-- LETTERHEAD -->
  <div class="letterhead">
    <div class="lh-logo-wrap">
      ${logoTag}
      <div class="lh-fb">RC</div>
    </div>
    <div class="lh-company">R.C Enterprises</div>
    <div class="lh-owners">Mr. Chand Laluwale &nbsp;|&nbsp; Mr. Roshan Laluwale</div>
    <hr class="lh-divider"/>
    <div class="lh-btitle">Outstanding Bill &mdash; ${bill.customer?.name || ''}</div>
  </div>

  <!-- BILL CONTENT -->
  <div class="bill-card">

    <div class="header">
      <div>
        <div class="company-name">${companyName}</div>
        <div class="company-sub">${companySubtitle}</div>
      </div>
      <div class="bill-meta">
        <div class="bill-title-lbl">Outstanding Bill</div>
        <div class="customer-name">${bill.customer?.name || ''}</div>
        <div class="bill-period">${periodLabel}</div>
      </div>
    </div>

    <hr class="divider"/>

    <div class="summary-cards">
      <div class="card card-blue">
        <div class="card-label">Total Billed</div>
        <div class="card-value">&#x20B9;${fmt(totalBilled)}</div>
      </div>
      <div class="card card-green">
        <div class="card-label">Amount Paid</div>
        <div class="card-value">&#x20B9;${fmt(totalPaid)}</div>
      </div>
      <div class="card card-orange">
        <div class="card-label">Net Outstanding</div>
        <div class="card-value">&#x20B9;${fmt(netOutstanding)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th>Date</th>
          <th>Module</th>
          <th>Material</th>
          <th>Trips / Qty</th>
          <th>Vehicles</th>
          <th class="tr">Amount (&#x20B9;)</th>
        </tr>
      </thead>
      <tbody>
        ${buildRows(deliveredRows)}
        ${deliveredRows.length > 0 ? subRow('Delivered Sub-total', deliveredTotal, deliveredTotal, 'subtotal-delivered') : ''}
        ${buildRows(pickupRows)}
        ${pickupRows.length    > 0 ? subRow('Pick - up Sub-total', pickupTotal,    pickupTotal,    'subtotal-pickup')    : ''}
      </tbody>
      <tfoot>
        <tr class="grand-row">
          <td colspan="6">GRAND TOTAL BILLED</td>
          <td class="tr">&#x20B9;${fmt(totalBilled)}</td>
        </tr>
        <tr class="total-paid-row">
          <td colspan="6">&#10003; &nbsp;Total Paid</td>
          <td class="tr">&#x20B9;${fmt(totalPaid)}</td>
        </tr>
        <tr class="net-row">
          <td colspan="6">&#x231B; &nbsp;<strong>Net Outstanding</strong></td>
          <td class="tr"><strong>&#x20B9;${fmt(netOutstanding)}</strong></td>
        </tr>
      </tfoot>
    </table>

    <div class="signatures">
      <div class="sig-block"><div class="sig-line">Customer Signature</div></div>
      <div class="sig-block"><div class="sig-line">Authorised Signature</div></div>
    </div>

  </div>

  <!-- DEVELOPER FOOTER -->
  <div class="dev-footer">
    Developed by Chaitanya H Daterao &nbsp;|&nbsp; Mob: 9766150846
  </div>

</div>
</body>
</html>`;
}