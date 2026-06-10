const logo = require('../assets/logo.jpg');
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { RC_PRINT_CSS, rcBillHeader, RC_FOOTER } from '../utils/rcPrint';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt     = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });

const SOURCE_STYLE = {
  Billing: { bg: 'rgba(99,102,241,0.15)',  color: '#818cf8', border: '#818cf8' },
  Khet:    { bg: 'rgba(234,179,8,0.15)',   color: '#eab308', border: '#eab308' },
  'Site B':{ bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', border: '#4ade80' },
  Pokland: { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7', border: '#a855f7' },
};

const SourceBadge = ({ source }) => {
  const s = SOURCE_STYLE[source] || { bg: 'rgba(255,255,255,0.1)', color: '#ccc', border: '#ccc' };
  return (
      <span style={{
        padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
        marginRight: 4, display: 'inline-block',
      }}>
      {source}
    </span>
  );
};

// ── Shared bill HTML builder — used by printCustomerBill AND shareCustomerBillAsPdf ──
// Returns the complete <html>…</html> string. Both functions call this so they
// always produce identical output and can never diverge.
const buildCustomerBillHtml = (customer, periodLabel) => {
  const customerName = customer.name || customer.customer?.name || '—';
  const allOrders = (customer.sources || []).flatMap(src =>
      (src.orders || []).map(o => ({ ...o, source: src.source }))
  ).sort((a, b) => new Date(a.date) - new Date(b.date));

  const sourceLabel = (src) => src === 'Billing' ? 'Delivered' : src === 'Khet' ? 'Pick - up' : src;
  const sourceColor = (src) => src === 'Billing' ? '#1d4ed8' : src === 'Khet' ? '#92400e' : '#374151';
  const sourceBg    = (src) => src === 'Billing' ? '#eff6ff' : src === 'Khet' ? '#fffbeb' : '#f9fafb';
  const sourceBorder= (src) => src === 'Billing' ? '#bfdbfe' : src === 'Khet' ? '#fde68a' : '#e5e7eb';

  // ── Compute amounts ──
  const prevOutstanding    = customer.prevOutstanding || 0;
  const thisWeekBill       = customer.thisWeekBill    || 0;
  const thisWeekCollected  = customer.thisWeekCollected || 0;
  const totalDue           = prevOutstanding + thisWeekBill;   // gross amount owed
  const netOutstanding     = customer.remaining || 0;          // after deducting collected

  // ── Compute trip totals split by source ──
  const deliveryTrips = allOrders.reduce((sum, o) => {
    if (o.source === 'Billing' && o.billingType === 'Trip') return sum + (Number(o.trips) || 0);
    return sum;
  }, 0);
  const pickupTrips = allOrders.reduce((sum, o) => {
    if (o.source === 'Khet' && o.billingType === 'Trip') return sum + (Number(o.trips) || 0);
    return sum;
  }, 0);
  const totalTrips = deliveryTrips + pickupTrips;

  const rowsHtml = allOrders.map((o, i) => {
    const tripQty   = o.billingType === 'Trip'
        ? `${o.trips} trip${o.trips !== 1 ? 's' : ''}`
        : `${o.qty} ${o.quantityUnit || 'units'}`;
    const vehiclesHtml = o.vehicles && o.vehicles.length > 0
        ? o.vehicles.map(v => `<span style="display:inline-block;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:3px;padding:1px 6px;font-size:10px;color:#334155;margin:1px 2px 1px 0;font-family:monospace;letter-spacing:0.3px;">${v}</span>`).join('')
        : '<span style="color:#94a3b8;">—</span>';
    const addressDisplay = (o.destination && o.destination.trim()) ? o.destination.trim() : '—';
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    return `
      <tr style="background:${rowBg};border-bottom:1px solid #e2e8f0;">
        <td style="padding:9px 10px;color:#94a3b8;font-size:11px;text-align:center;">${i + 1}</td>
        <td style="padding:9px 10px;font-size:12px;color:#374151;white-space:nowrap;">${fmtDate(o.date)}</td>
        <td style="padding:9px 10px;">
          <span style="display:inline-block;background:${sourceBg(o.source)};color:${sourceColor(o.source)};border:1px solid ${sourceBorder(o.source)};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:0.3px;">${sourceLabel(o.source)}</span>
        </td>
        <td style="padding:9px 10px;font-size:12px;color:#374151;font-weight:500;">${addressDisplay}</td>
        <td style="padding:9px 10px;font-size:12px;color:#1e40af;font-weight:700;text-align:center;">${tripQty}</td>
        <td style="padding:9px 10px;">${vehiclesHtml}</td>
        <td style="padding:9px 10px;font-weight:700;text-align:right;font-size:13px;color:#111827;">₹${fmt(o.amount)}</td>
      </tr>`;
  }).join('');

  // Per-source sub-total blocks
  const sourceSubtotals = (customer.sources || []).map(src => `
    <tr style="background:${sourceBg(src.source)};border-top:2px solid ${sourceBorder(src.source)};">
      <td colspan="6" style="padding:9px 12px;font-weight:700;font-size:12px;color:${sourceColor(src.source)};letter-spacing:0.3px;">
        ${sourceLabel(src.source)} Sub-total
      </td>
      <td style="padding:9px 12px;font-weight:800;text-align:right;font-size:13px;color:${sourceColor(src.source)};">
        ₹${fmt(src.totalBill)}
      </td>
    </tr>`).join('');

  const html = `
    <html><head><title>Outstanding Bill — ${customerName}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 28px 32px; min-width: 900px; }
      table { width: 100%; border-collapse: collapse; }

      /* ── Header ── */
      .bill-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 3px solid #111827; }
      .company-name { font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; }
      .company-sub  { font-size: 11px; color: #6b7280; margin-top: 3px; letter-spacing: 0.5px; text-transform: uppercase; }
      .bill-meta    { text-align: right; }
      .bill-title   { font-size: 17px; font-weight: 700; color: #1e40af; margin-bottom: 6px; }
      .bill-customer{ font-size: 20px; font-weight: 800; color: #111827; margin-bottom: 4px; }
      .bill-period  { font-size: 11px; color: #6b7280; }

      /* ── Summary chips ── */
      .summary-bar { display: flex; gap: 12px; margin-bottom: 16px; }
      .chip { flex: 1; border-radius: 8px; padding: 12px 16px; text-align: center; }
      .chip-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 4px; }
      .chip-value { font-size: 18px; font-weight: 800; }



      /* ── Table ── */
      .data-table th { background: #111827; color: #f9fafb; padding: 10px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
      .data-table th:last-child { text-align: right; }
      .data-table th:first-child { text-align: center; width: 36px; }

      /* ── Footer rows ── */
      .row-trips td  { padding: 10px 12px; font-size: 13px; font-weight: 700; background: #f0f9ff; color: #0369a1; border-bottom: 1px solid #bae6fd; }
      .row-total td  { padding: 11px 12px; font-size: 14px; font-weight: 700; background: #111827; color: #f9fafb; }
      .row-prev td   { padding: 10px 12px; font-size: 13px; font-weight: 700; background: #fff7ed; color: #c2410c; border-bottom: 1px solid #fed7aa; }
      .row-week td   { padding: 10px 12px; font-size: 13px; font-weight: 700; background: #eff6ff; color: #1d4ed8; border-bottom: 1px solid #bfdbfe; }
      .row-gross td  { padding: 11px 12px; font-size: 14px; font-weight: 800; background: #fef3c7; color: #92400e; border-bottom: 2px solid #f59e0b; }
      .row-paid td   { padding: 10px 12px; font-size: 13px; font-weight: 700; background: #f0fdf4; color: #15803d; border-bottom: 1px solid #bbf7d0; }
      .row-due td    { padding: 13px 12px; font-size: 15px; font-weight: 800; background: #fff1f2; color: #be123c; }

      /* ── Signatures ── */
      .sig-row { display: flex; justify-content: space-between; margin-top: 52px; padding-top: 0; }
      .sig-box { text-align: center; width: 200px; }
      .sig-line { border-top: 1.5px solid #9ca3af; padding-top: 8px; font-size: 11px; color: #6b7280; letter-spacing: 0.3px; }

      /* ── Print ── */
      tfoot { display: table-row-group !important; }
      @media print {
        body { padding: 16px 20px; }
        .summary-bar, .calc-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .data-table th, .row-total td, .row-gross td, .row-due td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style></head>
    <body>

      <!-- HEADER -->
      <div class="bill-header">
        <div style="display:flex;align-items:center;gap:14px;">
          <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
          <div>
            <div class="company-name">R.C. Enterprises</div>
            <div class="company-sub">Chand Laluwale &amp; Roshan Laluwale</div>
          </div>
        </div>
        <div class="bill-meta">
          <div class="bill-title">Outstanding Bill</div>
          <div class="bill-customer">${customerName}</div>
          <div class="bill-period">Period: ${periodLabel}</div>
        </div>
      </div>

      <!-- SUMMARY CHIPS -->
      <div class="summary-bar">
        <div class="chip" style="background:#fff7ed;border:1.5px solid #fed7aa;">
          <div class="chip-label" style="color:#c2410c;">Previous Pending</div>
          <div class="chip-value" style="color:#c2410c;">₹${fmt(prevOutstanding)}</div>
        </div>
        <div class="chip" style="background:#eff6ff;border:1.5px solid #bfdbfe;">
          <div class="chip-label" style="color:#1e40af;">This Week's Bill</div>
          <div class="chip-value" style="color:#1e40af;">₹${fmt(thisWeekBill)}</div>
        </div>
        ${thisWeekCollected > 0 ? `
        <div class="chip" style="background:#f0fdf4;border:1.5px solid #bbf7d0;">
          <div class="chip-label" style="color:#15803d;">Collected This Week</div>
          <div class="chip-value" style="color:#15803d;">₹${fmt(thisWeekCollected)}</div>
        </div>` : ''}
        <div class="chip" style="background:#fff1f2;border:1.5px solid #fecdd3;">
          <div class="chip-label" style="color:#be123c;">Net Outstanding</div>
          <div class="chip-value" style="color:#be123c;">₹${fmt(netOutstanding)}</div>
        </div>
      </div>



      <!-- ORDERS TABLE -->
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th style="width:100px;">Date</th>
            <th style="width:90px;">Module</th>
            <th>Address</th>
            <th style="width:90px;text-align:center;">Trips / Qty</th>
            <th>Vehicles</th>
            <th style="width:110px;text-align:right;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          ${sourceSubtotals}
          ${deliveryTrips > 0 ? `<tr class="row-trips" style="background:#eff6ff;">
            <td colspan="4" style="letter-spacing:0.5px;color:#1d4ed8;">🚛 &nbsp;Delivery Trips <span style="font-size:10px;font-weight:500;opacity:0.7;">(Billing)</span></td>
            <td style="text-align:center;font-size:14px;font-weight:800;color:#1d4ed8;">${deliveryTrips} trip${deliveryTrips !== 1 ? 's' : ''}</td>
            <td colspan="2"></td>
          </tr>` : ''}
          ${pickupTrips > 0 ? `<tr class="row-trips" style="background:#fffbeb;">
            <td colspan="4" style="letter-spacing:0.5px;color:#92400e;">📦 &nbsp;Pick-up Trips <span style="font-size:10px;font-weight:500;opacity:0.7;">(Khet)</span></td>
            <td style="text-align:center;font-size:14px;font-weight:800;color:#92400e;">${pickupTrips} trip${pickupTrips !== 1 ? 's' : ''}</td>
            <td colspan="2"></td>
          </tr>` : ''}
          <tr class="row-trips" style="background:#f0f9ff;border-top:2px solid #0369a1;">
            <td colspan="4" style="letter-spacing:0.5px;color:#0369a1;font-weight:800;">🔢 &nbsp;Total Trips</td>
            <td style="text-align:center;font-size:14px;font-weight:800;color:#0369a1;">${totalTrips} trip${totalTrips !== 1 ? 's' : ''}</td>
            <td colspan="2"></td>
          </tr>
          ${prevOutstanding > 0 ? `
          <tr class="row-prev">
            <td colspan="6" style="letter-spacing:0.5px;">⏳ &nbsp;Previous Pending Amount</td>
            <td style="text-align:right;">₹${fmt(prevOutstanding)}</td>
          </tr>` : ''}
          <tr class="row-week">
            <td colspan="6" style="letter-spacing:0.5px;">📋 &nbsp;This Week's Bill</td>
            <td style="text-align:right;">₹${fmt(thisWeekBill)}</td>
          </tr>
          <tr class="row-gross">
            <td colspan="6" style="letter-spacing:1px;">
              ${prevOutstanding > 0 ? 'Previous Pending + This Week' : 'TOTAL BILLED'}
            </td>
            <td style="text-align:right;font-size:15px;">₹${fmt(totalDue)}</td>
          </tr>
          ${thisWeekCollected > 0 ? `
          <tr class="row-paid">
            <td colspan="6">✓ &nbsp;Collected This Week</td>
            <td style="text-align:right;">₹${fmt(thisWeekCollected)}</td>
          </tr>` : ''}
          <tr class="row-due">
            <td colspan="6" style="letter-spacing:0.5px;">🔴 &nbsp;Net Amount Due</td>
            <td style="text-align:right;font-size:17px;">₹${fmt(netOutstanding)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- SIGNATURES -->
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line">Customer Signature</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">Authorised Signature</div>
        </div>
      </div>

    </body></html>`;

  return html; // shared builder returns the full HTML string
};

// ── Per-customer print bill popup ──
// Thin wrapper: builds HTML via the shared helper then opens the browser print dialog.
const printCustomerBill = (customer, periodLabel) => {
  const html = buildCustomerBillHtml(customer, periodLabel);
  const customerName = customer.name || customer.customer?.name || '—';

  let iframe = document.getElementById('__print_iframe__');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '__print_iframe__';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
  }
  const iDoc = iframe.contentWindow.document;
  iDoc.open(); iDoc.write(html); iDoc.close();
  setTimeout(() => {
    const prevTitle = document.title;
    document.title = customerName;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => { document.title = prevTitle; }, 1000);
  }, 400);
};

// ── Share customer bill as PDF via WhatsApp ──
// Reuses the exact same HTML that printCustomerBill generates.
// Renders it inside a hidden iframe sized to 900 px wide, waits for full
// layout, reads the iframe body's scrollHeight so nothing is cropped, then
// captures with html2canvas and exports as a single-page PDF.
const shareCustomerBillAsPdf = async (customer, periodLabel) => {
  const customerName = customer.name || customer.customer?.name || '—';

  // Build the HTML and inject a no-overflow CSS rule so nothing gets clipped
  let html = buildCustomerBillHtml(customer, periodLabel);
  // Inject overflow-fix styles before </style> so the table never exceeds the page width
  html = html.replace('</style>', `
    body { overflow-x: hidden !important; }
    table { table-layout: fixed !important; width: 100% !important; word-break: break-word !important; }
    td, th { overflow-wrap: break-word !important; word-break: break-word !important; }
  </style>`);

  try {
    // --- 1. Create a hidden iframe — start at 1200px so wide tables fit ---
    const BILL_WIDTH = 1200;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${BILL_WIDTH}px;height:1px;border:none;visibility:hidden;`;
    document.body.appendChild(iframe);

    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(html); iDoc.close();

    // --- 2. Wait for fonts + layout to settle ---
    await new Promise(r => setTimeout(r, 800));

    const iBody = iDoc.body;
    const iHtml = iDoc.documentElement;

    // Measure true content width — use scrollWidth to catch any overflow
    const fullWidth = Math.max(
        iBody.scrollWidth,
        iHtml.scrollWidth,
        BILL_WIDTH,
    );

    // Measure true content height
    const fullHeight = Math.max(
        iBody.scrollHeight,
        iHtml.scrollHeight,
        iBody.offsetHeight,
    );

    // Resize iframe to exact content dimensions so html2canvas sees everything
    iframe.style.width  = `${fullWidth}px`;
    iframe.style.height = `${fullHeight}px`;

    // Extra pause for reflow at new size
    await new Promise(r => setTimeout(r, 300));

    // --- 3. Capture at 2× resolution ---
    const canvas = await html2canvas(iBody, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width:        fullWidth,
      height:       fullHeight,
      scrollX:      0,
      scrollY:      0,
      windowWidth:  fullWidth,
      windowHeight: fullHeight,
    });

    document.body.removeChild(iframe);

    // --- 4. Build PDF exactly sized to captured content (no cropping) ---
    const imgData  = canvas.toDataURL('image/jpeg', 0.95);
    const mmWidth  = (fullWidth  * 25.4) / 96;
    const mmHeight = (fullHeight * 25.4) / 96;
    const pdf = new jsPDF({ orientation: mmWidth > mmHeight ? 'landscape' : 'portrait', unit: 'mm', format: [mmWidth, mmHeight] });
    pdf.addImage(imgData, 'JPEG', 0, 0, mmWidth, mmHeight);

    const pdfBlob = pdf.output('blob');
    const pdfName = `Bill_${customerName.replace(/\s+/g, '_')}.pdf`;
    const pdfFile = new File([pdfBlob], pdfName, { type: 'application/pdf' });

    // --- 5. Share via Web Share API (mobile) or download (desktop) ---
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      try { await navigator.share({ files: [pdfFile], title: `Bill — ${customerName}` }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url; a.download = pdfName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('PDF downloaded — open WhatsApp and attach the file');
  } catch (err) { toast.error('Failed to generate PDF'); console.error(err); }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
// Parse YYYY-MM-DD as LOCAL date (avoids UTC midnight → previous day in IST)
const parseLocal = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const toIsoLocal = (date) => {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getWeekStart = (iso) => {
  const date = parseLocal(iso);
  const day  = date.getDay();                   // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;        // shift to Monday
  date.setDate(date.getDate() + diff);
  return toIsoLocal(date);
};

const getMonthStart = (iso) => {
  const date = parseLocal(iso);
  return toIsoLocal(new Date(date.getFullYear(), date.getMonth(), 1));
};

const addWeeks = (iso, n) => {
  const d = parseLocal(iso);
  d.setDate(d.getDate() + n * 7);
  return toIsoLocal(d);
};

const addMonths = (iso, n) => {
  const d = parseLocal(iso);
  d.setMonth(d.getMonth() + n);
  return toIsoLocal(d);
};

const shortWeekLabel = (iso) => {
  return parseLocal(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
};
const shortMonthLabel = (iso) => {
  return parseLocal(iso).toLocaleDateString('en-IN',{month:'short',year:'2-digit'});
};

const pct = (curr, prev) => {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
};

const GrowthBadge = ({ curr, prev, label }) => {
  const p = pct(curr, prev);
  const up = p >= 0;
  return (
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <span style={{fontSize:11,color:'#666'}}>{label}</span>
        <span style={{
          fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:20,
          background: up ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
          color: up ? '#4ade80' : '#f87171',
          border: `1px solid ${up ? '#4ade80' : '#f87171'}`,
        }}>
        {up ? '▲' : '▼'} {Math.abs(p)}%
      </span>
      </div>
  );
};

// Custom tooltip for the charts
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
      <div style={{background:'#1a1a2e',border:'1px solid #2a2a4a',borderRadius:8,padding:'10px 14px',fontSize:12}}>
        <div style={{color:'#ccc',marginBottom:6,fontWeight:600}}>{label}</div>
        {payload.map((p, i) => (
            <div key={i} style={{color:p.color,display:'flex',justifyContent:'space-between',gap:16}}>
              <span>{p.name}</span>
              <span style={{fontWeight:700}}>₹{Number(p.value||0).toLocaleString('en-IN')}</span>
            </div>
        ))}
      </div>
  );
};

function SalesChartModal({ onClose }) {
  const [mode, setMode]           = useState('weekly');
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [anchorDate, setAnchorDate] = useState(toIsoLocal(new Date()));

  const fetchChartData = useCallback(async (m, d) => {
    setLoading(true);
    try {
      const today    = toIsoLocal(new Date());
      // Never fetch beyond today's week/month
      const cappedD  = d > today ? today : d;

      const periods  = m === 'weekly' ? 8 : 6;
      const requests = [];

      for (let i = periods - 1; i >= 0; i--) {
        const anchor = m === 'weekly'
            ? addWeeks(getWeekStart(cappedD), -i)
            : addMonths(getMonthStart(cappedD), -i);

        // Skip any anchor that is in the future (beyond today's period start)
        const periodStart = m === 'weekly' ? getWeekStart(today) : getMonthStart(today);
        if (anchor > periodStart) continue;

        requests.push(
            api.get(`/pl/report?type=${m === 'weekly' ? 'weekly' : 'monthly'}&date=${anchor}`)
                .then(r => ({ anchor, data: r.data }))
                .catch(() => ({ anchor, data: null }))
        );
      }

      const results = await Promise.all(requests);

      const rows = results.map(({ anchor, data }) => {
        const label = m === 'weekly'
            ? shortWeekLabel(anchor)
            : shortMonthLabel(anchor);
        return {
          label,
          anchor,
          Billing : data?.income?.billing?.amount  || 0,
          Khet    : data?.income?.khet?.amount      || 0,
          SiteB   : data?.income?.siteB?.amount     || 0,
          Total   : data?.income?.total             || 0,
        };
      });

      setChartData(rows);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchChartData(mode, anchorDate); }, [mode, anchorDate, fetchChartData]);

  // Current and previous period values
  const curr = chartData[chartData.length - 1];
  const prev = chartData[chartData.length - 2];
  const prevPrev = chartData[chartData.length - 3];

  // Month-over-month: compare curr to 4 weeks ago (for weekly), or prev month
  const currMonthAgg = chartData.slice(-4).reduce((s,r)=>({
    Billing: s.Billing+r.Billing, Khet: s.Khet+r.Khet, SiteB: s.SiteB+r.SiteB, Total: s.Total+r.Total
  }), { Billing:0, Khet:0, SiteB:0, Total:0 });
  const prevMonthAgg = chartData.slice(-8,-4).reduce((s,r)=>({
    Billing: s.Billing+r.Billing, Khet: s.Khet+r.Khet, SiteB: s.SiteB+r.SiteB, Total: s.Total+r.Total
  }), { Billing:0, Khet:0, SiteB:0, Total:0 });

  const SOURCE_COLORS = {
    Billing: '#818cf8',
    Khet:    '#eab308',
    SiteB:   '#4ade80',
    Total:   '#fb923c',
  };

  const periodWord = mode === 'weekly' ? 'week' : 'month';
  const compareWord = mode === 'weekly' ? 'prev week' : 'prev month';

  return (
      <div className="modal-overlay" onClick={onClose}
           style={{zIndex:1100, alignItems:'flex-start', paddingTop:40, overflowY:'auto'}}>
        <div className="modal" onClick={e=>e.stopPropagation()}
             style={{maxWidth:860, width:'95%', background:'#0e0e0e', border:'1px solid #2a2a2a', borderRadius:14, padding:0, overflow:'hidden'}}>

          {/* Header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 22px',borderBottom:'1px solid #1e1e1e',flexWrap:'wrap',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <span style={{fontSize:18,fontWeight:700,color:'#f0f0f0'}}>📊 Sales Chart</span>
              <div style={{display:'flex',gap:6}}>
                {['weekly','monthly'].map(m=>(
                    <button key={m} onClick={()=>setMode(m)}
                            style={{padding:'4px 14px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',border:'none',
                              background: mode===m ? '#2563eb' : '#1a1a2e',
                              color: mode===m ? '#fff' : '#818cf8'}}>
                      {m==='weekly' ? '📅 Weekly' : '🗓️ Monthly'}
                    </button>
                ))}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px',whiteSpace:'nowrap'}}>
                  {mode==='weekly' ? 'Any date in week' : 'Any date in month'}
                </label>
                <input
                    type="date"
                    value={anchorDate}
                    onChange={e => setAnchorDate(e.target.value)}
                    style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'5px 10px',color:'#e0e0e0',fontSize:13,outline:'none'}}
                />
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:'#666',cursor:'pointer',fontSize:20,lineHeight:1}}>✕</button>
          </div>

          {loading ? (
              <div style={{padding:60,textAlign:'center',color:'#444',fontSize:14}}>Loading chart data…</div>
          ) : chartData.length === 0 ? (
              <div style={{padding:60,textAlign:'center',color:'#444',fontSize:14}}>No data available</div>
          ) : (
              <div style={{padding:'20px 22px'}}>

                {/* ── Growth badges ── */}
                {curr && prev && (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
                      {[
                        {key:'Billing', label:'Billing', color:'#818cf8'},
                        {key:'Khet',    label:'Khet',    color:'#eab308'},
                        {key:'SiteB',   label:'Site B',  color:'#4ade80'},
                        {key:'Total',   label:'Total',   color:'#fb923c'},
                      ].map(({ key, label, color }) => {
                        const c = curr[key] || 0;
                        const p = prev[key] || 0;
                        const growth = pct(c, p);
                        const up = growth >= 0;
                        // Monthly comparison (last 4 weeks vs prior 4 weeks)
                        const cm = currMonthAgg[key] || 0;
                        const pm = prevMonthAgg[key] || 0;
                        const mGrowth = pct(cm, pm);
                        const mUp = mGrowth >= 0;
                        return (
                            <div key={key} style={{background:'#141414',border:`1px solid ${color}33`,borderRadius:10,padding:'12px 14px'}}>
                              <div style={{fontSize:11,color,textTransform:'uppercase',letterSpacing:'0.6px',fontWeight:700,marginBottom:6}}>{label}</div>
                              <div style={{fontSize:18,fontWeight:700,color:'#f0f0f0',marginBottom:8}}>₹{Number(c).toLocaleString('en-IN')}</div>
                              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                  <span style={{fontSize:10,color:'#555'}}>vs {compareWord}</span>
                                  <span style={{fontSize:11,fontWeight:700,padding:'1px 6px',borderRadius:20,
                                    background: up ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                                    color: up ? '#4ade80' : '#f87171',
                                    border: `1px solid ${up ? '#4ade8040' : '#f8717140'}`,
                                  }}>
                            {up ? '▲' : '▼'} {Math.abs(growth)}%
                          </span>
                                </div>
                                {mode === 'weekly' && (
                                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                      <span style={{fontSize:10,color:'#555'}}>vs prev 4wk avg</span>
                                      <span style={{fontSize:11,fontWeight:700,padding:'1px 6px',borderRadius:20,
                                        background: mUp ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                                        color: mUp ? '#4ade80' : '#f87171',
                                        border: `1px solid ${mUp ? '#4ade8040' : '#f8717140'}`,
                                      }}>
                              {mUp ? '▲' : '▼'} {Math.abs(mGrowth)}%
                            </span>
                                    </div>
                                )}
                              </div>
                            </div>
                        );
                      })}
                    </div>
                )}

                {/* ── Stacked Bar Chart — individual sources ── */}
                <div style={{background:'#141414',borderRadius:10,padding:'16px 12px',marginBottom:16}}>
                  <div style={{fontSize:12,color:'#888',fontWeight:600,marginBottom:12,textTransform:'uppercase',letterSpacing:'0.6px'}}>
                    Sales by Source — Last {chartData.length} {mode === 'weekly' ? 'Weeks' : 'Months'}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{top:4,right:12,left:10,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false}/>
                      <XAxis dataKey="label" tick={{fill:'#666',fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:'#555',fontSize:10}} axisLine={false} tickLine={false}
                             tickFormatter={v=>v>=100000?`${(v/100000).toFixed(1)}L`:v>=1000?`${(v/1000).toFixed(0)}K`:v}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Legend wrapperStyle={{fontSize:11,color:'#888',paddingTop:8}}/>
                      <Bar dataKey="Billing" stackId="a" fill={SOURCE_COLORS.Billing} radius={[0,0,0,0]}/>
                      <Bar dataKey="Khet"    stackId="a" fill={SOURCE_COLORS.Khet}    radius={[0,0,0,0]}/>
                      <Bar dataKey="SiteB"   stackId="a" fill={SOURCE_COLORS.SiteB}   name="Site B" radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* ── Line Chart — total trend ── */}
                <div style={{background:'#141414',borderRadius:10,padding:'16px 12px'}}>
                  <div style={{fontSize:12,color:'#888',fontWeight:600,marginBottom:12,textTransform:'uppercase',letterSpacing:'0.6px'}}>
                    Total Revenue Trend
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{top:4,right:12,left:10,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false}/>
                      <XAxis dataKey="label" tick={{fill:'#666',fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:'#555',fontSize:10}} axisLine={false} tickLine={false}
                             tickFormatter={v=>v>=100000?`${(v/100000).toFixed(1)}L`:v>=1000?`${(v/1000).toFixed(0)}K`:v}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Line type="monotone" dataKey="Billing" stroke={SOURCE_COLORS.Billing} strokeWidth={2} dot={{r:3,fill:SOURCE_COLORS.Billing}} activeDot={{r:5}}/>
                      <Line type="monotone" dataKey="Khet"    stroke={SOURCE_COLORS.Khet}    strokeWidth={2} dot={{r:3,fill:SOURCE_COLORS.Khet}}    activeDot={{r:5}}/>
                      <Line type="monotone" dataKey="SiteB"   stroke={SOURCE_COLORS.SiteB}   strokeWidth={2} dot={{r:3,fill:SOURCE_COLORS.SiteB}}   activeDot={{r:5}} name="Site B"/>
                      <Line type="monotone" dataKey="Total"   stroke={SOURCE_COLORS.Total}   strokeWidth={2.5} strokeDasharray="5 3" dot={{r:3,fill:SOURCE_COLORS.Total}} activeDot={{r:5}}/>
                      <Legend wrapperStyle={{fontSize:11,color:'#888',paddingTop:8}}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>

              </div>
          )}
        </div>
      </div>
  );
}

export default function PL() {
  const [periodType, setPeriodType] = useState('weekly');
  const [date,       setDate]       = useState(new Date().toISOString().slice(0,10));
  const [fromDate,   setFrom]       = useState(new Date().toISOString().slice(0,10));
  const [toDate,     setTo]         = useState(new Date().toISOString().slice(0,10));
  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [showChart,  setShowChart]  = useState(false);
  const [ytrSearch,  setYtrSearch]  = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const printRef = useRef();

  const loadReport = async () => {
    setLoading(true);
    setExpandedIdx(null);
    setYtrSearch('');
    try {
      let url = `/pl/report?type=${periodType}`;
      if (periodType === 'custom') url += `&from=${fromDate}&to=${toDate}`;
      else url += `&date=${date}`;
      const { data } = await api.get(url);
      setReport(data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load report');
    } finally { setLoading(false); }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const periodLabel = 'Profit & Loss Report — ' +
        (report?.period?.type?.charAt(0).toUpperCase() + report?.period?.type?.slice(1) || '') +
        ' | ' + fmtDate(report.period.start) + ' to ' + fmtDate(report.period.end);
    const html = '<html><head><title>P&L Report</title><style>' +
        RC_PRINT_CSS +
        '.profit{color:#166534!important;font-weight:bold;}' +
        '.loss{color:#991b1b!important;font-weight:bold;}' +
        '.carry-box{background:#fff8e1;border:1px solid #e0a000;padding:10px 16px;margin-bottom:14px;border-radius:4px;}' +
        '.no-print{display:none!important;}' +
        '</style></head><body>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
        '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div>' +
        '</div>' +
        '<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">' + periodLabel + '</div></div>' +
        '</div>' +
        content +
        RC_FOOTER +
        '</body></html>';
    let iframe = document.getElementById('__pl_print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__pl_print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(html); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 500);
  };

  const sharePdfFromHtml = async (fullHtml, pdfName = 'report.pdf') => {
    try {
      // Inject into a hidden same-document div — no popup, no iframe, no cropping
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:absolute;top:0;left:-9999px;width:900px;z-index:-9999;pointer-events:none;';
      document.body.appendChild(wrapper);

      const container = document.createElement('div');
      container.style.cssText = 'width:900px;background:#fff;';

      const bodyMatch  = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const styleMatch = fullHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      const styleEl = document.createElement('style');
      styleEl.textContent = styleMatch ? styleMatch[1] : '';
      document.head.appendChild(styleEl);

      container.id = '__pl_capture__';
      container.innerHTML = bodyMatch ? bodyMatch[1] : fullHtml;
      wrapper.appendChild(container);

      await new Promise(r => setTimeout(r, 800));

      const fullWidth  = container.offsetWidth  || 900;
      const fullHeight = container.offsetHeight || 1200;

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: fullWidth,
        height: fullHeight,
        scrollX: 0,
        scrollY: 0,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
      });

      document.body.removeChild(wrapper);
      document.head.removeChild(styleEl);

      const imgData  = canvas.toDataURL('image/jpeg', 0.95);
      const mmWidth  = (fullWidth  * 25.4) / 96;
      const mmHeight = (fullHeight * 25.4) / 96;
      const pdf = new jsPDF({ orientation: mmHeight >= mmWidth ? 'portrait' : 'landscape', unit: 'mm', format: [mmWidth, mmHeight] });
      pdf.addImage(imgData, 'JPEG', 0, 0, mmWidth, mmHeight);
      const pdfBlob = pdf.output('blob');
      const pdfFile = new File([pdfBlob], pdfName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try { await navigator.share({ files: [pdfFile], title: pdfName.replace('.pdf', '') }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url; a.download = pdfName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded — attach it in WhatsApp');
      setTimeout(() => {
        const app = document.createElement('a'); app.href = 'whatsapp://open'; app.click();
        setTimeout(() => window.open('https://web.whatsapp.com', '_blank'), 1500);
      }, 800);
    } catch (err) { toast.error('Failed to generate PDF'); console.error(err); }
  };

  const handleSharePdfReport = () => {
    if (!printRef.current || !report) return;

    let content = printRef.current.innerHTML;

    // React serializes JSX style objects as rgb() in the DOM — replace all dark rgb values
    const replacements = [
      // Dark backgrounds → light
      ['rgb(10, 26, 10)','#f0fdf4'],['rgb(26, 10, 10)','#fff1f2'],
      ['rgb(26, 0, 0)','#fff1f2'],['rgb(10, 26, 0)','#f0fdf4'],
      ['rgb(22, 10, 0)','#fff7ed'],['rgb(26, 26, 0)','#fefce8'],
      ['rgb(20, 20, 20)','#f9fafb'],['rgb(14, 14, 14)','#f9fafb'],
      ['rgb(13, 13, 26)','#eef2ff'],['rgb(26, 13, 0)','#fff7ed'],
      ['rgb(26, 12, 0)','#fff7ed'],['rgb(26, 18, 0)','#fefce8'],
      ['rgb(17, 10, 0)','#fff7ed'],['rgb(26, 16, 0)','#fff7ed'],
      ['rgb(26, 21, 0)','#fefce8'],['rgb(22, 22, 22)','#f3f4f6'],
      ['rgb(26, 26, 46)','#eef2ff'],['rgb(30, 30, 30)','#f3f4f6'],
      ['rgb(42, 42, 42)','#e5e7eb'],['rgb(30, 24, 0)','#fefce8'],
      ['rgb(26, 24, 0)','#fefce8'],['rgb(42, 32, 0)','#fef9c3'],
      // Neon text colors → dark readable versions
      ['rgb(74, 222, 128)','#15803d'],['rgb(248, 113, 113)','#dc2626'],
      ['rgb(251, 146, 60)','#c2410c'],['rgb(249, 115, 22)','#c2410c'],
      ['rgb(251, 191, 36)','#92400e'],['rgb(234, 179, 8)','#92400e'],
      ['rgb(129, 140, 248)','#4338ca'],['rgb(168, 85, 247)','#7e22ce'],
      ['rgb(110, 231, 183)','#065f46'],
      ['rgb(240, 240, 240)','#111827'],['rgb(224, 224, 224)','#111827'],
      ['rgb(204, 204, 204)','#374151'],['rgb(170, 170, 170)','#374151'],
      ['rgb(136, 136, 136)','#4b5563'],['rgb(102, 102, 102)','#4b5563'],
      ['rgb(85, 85, 85)','#6b7280'],['rgb(68, 68, 68)','#6b7280'],
      // Also hex fallbacks
      ['#0a1a0a','#f0fdf4'],['#1a0a0a','#fff1f2'],['#1a0000','#fff1f2'],
      ['#160a00','#fff7ed'],['#141414','#f9fafb'],['#0e0e0e','#f9fafb'],
      ['#1a0d00','#fff7ed'],['#1a0c00','#fff7ed'],['#161616','#f3f4f6'],
      ['#1a1a2e','#eef2ff'],['#2a2a2a','#d1d5db'],['#1e1e1e','#e5e7eb'],
      ['#4ade80','#15803d'],['#f87171','#dc2626'],['#fb923c','#c2410c'],
      ['#f97316','#c2410c'],['#fbbf24','#92400e'],['#eab308','#92400e'],
      ['#818cf8','#4338ca'],['#f0f0f0','#111827'],['#e0e0e0','#111827'],
    ];
    replacements.forEach(([from, to]) => {
      content = content.split(from).join(to);
    });

    const periodLabelTitle = 'PnL_Report_' + fmtDate(report.period.start).replace(/\//g, '-') + '_to_' + fmtDate(report.period.end).replace(/\//g, '-') + '.pdf';
    const periodLabelHeader = 'Profit & Loss Report — ' +
        (report?.period?.type?.charAt(0).toUpperCase() + report?.period?.type?.slice(1) || '') +
        ' | ' + fmtDate(report.period.start) + ' to ' + fmtDate(report.period.end);
    const html = '<html><head><title>P&L Report</title><style>' +
        RC_PRINT_CSS +
        'body{background:#fff!important;color:#111827!important;}' +
        '.card{background:#fff!important;border:1px solid #e5e7eb!important;}' +
        '.profit{color:#166534!important;font-weight:bold;}' +
        '.loss{color:#991b1b!important;font-weight:bold;}' +
        '.carry-box{background:#fff8e1;border:1px solid #e0a000;padding:10px 16px;margin-bottom:14px;border-radius:4px;}' +
        '.no-print{display:none!important;}' +
        '</style></head><body>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
        '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div>' +
        '</div>' +
        '<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">' + periodLabelHeader + '</div></div>' +
        '</div>' +
        content +
        RC_FOOTER +
        '</body></html>';
    sharePdfFromHtml(html, periodLabelTitle);
  };

  const isProfit = report && report.netProfit >= 0;

  const incomeRows = report ? [
    report.income.billing,
    report.income.khet,
    report.income.siteB,
  ].filter(Boolean) : [];

  const expenseRows = report ? [
    report.expenses.material,
    report.expenses.ownVehicle,
    report.expenses.ownPoklandDiesel,
    report.expenses.ownPoklandMaintenance,
    report.expenses.rentalVehicle,
    report.expenses.rentalPokland,
    report.expenses.operator,
    report.expenses.staff,
    report.expenses.siteB,
  ].filter(Boolean) : [];

  // Use new merged list from backend
  const ytrCustomers     = [...(report?.pending?.yetToReceive?.mergedCustomers || [])].sort((a, b) => {
    const nameA = (a.name || a.customer?.name || '').toLowerCase();
    const nameB = (b.name || b.customer?.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
  const totalYetToReceive = report?.pending?.yetToReceive?.total || 0;
  const yetToPay          = report?.pending?.yetToPay || {};

  const periodLabel = report
      ? `${fmtDate(report.period.start)} to ${fmtDate(report.period.end)}`
      : '';

  useEffect(() => {
    const onBefore = () => setIsPrinting(true);
    const onAfter  = () => setIsPrinting(false);
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint',  onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint',  onAfter);
    };
  }, []);

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">📈 P&amp;L Report</h1>
          {report && (
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button className="btn btn-secondary" onClick={handlePrint}>🖨️ Print Report</button>
                <button onClick={handleSharePdfReport} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                  <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                  WhatsApp
                </button>
              </div>
          )}
        </div>

        {/* Controls */}
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            {[
              {val:'weekly',  label:'📅 Weekly'},
              {val:'monthly', label:'🗓️ Monthly'},
              {val:'custom',  label:'📆 Custom'},
            ].map(pt=>(
                <button key={pt.val} className={`btn ${periodType===pt.val?'btn-primary':'btn-secondary'}`}
                        onClick={()=>setPeriodType(pt.val)}>
                  {pt.label}
                </button>
            ))}
            <button className="btn btn-secondary" onClick={()=>setShowChart(true)}
                    style={{marginLeft:'auto',background:'rgba(99,102,241,0.15)',border:'1px solid #818cf8',color:'#818cf8'}}>
              📊 Sales Chart
            </button>
          </div>
          <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
            {periodType !== 'custom' ? (
                <div className="form-group" style={{marginBottom:0}}>
                  <label>{periodType==='weekly'?'Any date in that week':'Any date in that month'}</label>
                  <input type="date" value={date} onChange={e=>setDate(e.target.value)}
                         style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                </div>
            ) : (
                <>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label>From</label>
                    <input type="date" value={fromDate} onChange={e=>setFrom(e.target.value)}
                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label>To</label>
                    <input type="date" value={toDate} onChange={e=>setTo(e.target.value)}
                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                  </div>
                </>
            )}
            <button className="btn btn-primary" onClick={loadReport} disabled={loading} style={{padding:'10px 20px'}}>
              {loading ? 'Loading...' : '📊 Generate Report'}
            </button>
          </div>
        </div>

        {!report && !loading && (
            <div className="card" style={{textAlign:'center',padding:48,color:'#444'}}>
              <div style={{fontSize:48,marginBottom:16}}>📈</div>
              <div style={{fontSize:16,color:'#555'}}>Select a period and click Generate Report</div>
            </div>
        )}

        {report && (
            <div ref={printRef}>
              <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:16,marginBottom:24}}>
                <div style={{fontSize:22,fontWeight:700,color:'#f0f0f0',fontFamily:'Syne,sans-serif'}}>
                  R.C Enterprises — Profit &amp; Loss Report
                </div>
                <div style={{fontSize:13,color:'#888',marginTop:4}}>Chand Laluwale &amp; Roshan Laluwale</div>
                <div style={{fontSize:13,color:'#666',marginTop:4}}>
                  Period: <strong style={{color:'#ccc'}}>{fmtDate(report.period.start)}</strong> to{' '}
                  <strong style={{color:'#ccc'}}>{fmtDate(report.period.end)}</strong>
                  &nbsp;·&nbsp;<span style={{textTransform:'capitalize'}}>{report.period.type}</span>
                </div>
              </div>

              {report.carryForward && report.carryForward.length > 0 && (
                  <div style={{background:'#1a1500',border:'1px solid #b45309',borderRadius:10,padding:'14px 20px',marginBottom:20}}>
                    <div style={{fontSize:13,fontWeight:700,color:'#fbbf24',marginBottom:8}}>⚠️ Carry-Forward Payments Included This Week</div>
                    {report.carryForward.map((cf, i) => (
                        <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#fbbf24',padding:'4px 0',borderTop:'1px solid #2a2000'}}>
                          <span>↩ {cf.label}</span>
                          <span style={{fontWeight:600}}>₹{fmt(cf.amount)}</span>
                        </div>
                    ))}
                  </div>
              )}

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:28}}>
                <div style={{background:'#0a1a0a',border:'2px solid #16a34a',borderRadius:12,padding:24,textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#16a34a',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:10}}>💰 Total Income</div>
                  <div style={{fontSize:30,fontWeight:700,color:'#4ade80',fontFamily:'Syne,sans-serif'}}>₹{fmt(report.income.total)}</div>
                </div>
                <div style={{background:'#1a0a0a',border:'2px solid #dc2626',borderRadius:12,padding:24,textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#dc2626',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:10}}>💸 Total Expenses</div>
                  <div style={{fontSize:30,fontWeight:700,color:'#f87171',fontFamily:'Syne,sans-serif'}}>₹{fmt(report.expenses.total)}</div>
                </div>
                <div style={{background:isProfit?'#0a1a0a':'#1a0a00',border:`2px solid ${isProfit?'#16a34a':'#ea580c'}`,borderRadius:12,padding:24,textAlign:'center'}}>
                  <div style={{fontSize:12,color:isProfit?'#16a34a':'#ea580c',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:10}}>
                    {isProfit ? '📈 Net Profit' : '📉 Net Loss'}
                  </div>
                  <div style={{fontSize:30,fontWeight:700,color:isProfit?'#4ade80':'#f97316',fontFamily:'Syne,sans-serif'}}>
                    {isProfit?'+':''}₹{fmt(report.netProfit)}
                  </div>
                  <div style={{fontSize:12,color:'#555',marginTop:8}}>Margin: {isProfit?'+':''}{report.profitMargin}%</div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
                <div className="card">
                  <div style={{fontSize:15,fontWeight:700,color:'#4ade80',marginBottom:16}}>💰 Income (Collected)</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead><tr>
                      <th style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Source</th>
                      <th style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'right',fontSize:11,textTransform:'uppercase'}}>Amount (₹)</th>
                    </tr></thead>
                    <tbody>
                    {incomeRows.map((row, i) => (
                        <tr key={i}>
                          <td style={{padding:'11px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{row.icon} {row.label}</td>
                          <td style={{padding:'11px 12px',color:row.amount>0?'#4ade80':'#555',fontWeight:row.amount>0?600:400,borderBottom:'1px solid #161616',textAlign:'right'}}>₹{fmt(row.amount)}</td>
                        </tr>
                    ))}
                    </tbody>
                    <tfoot><tr style={{borderTop:'2px solid #2a2a2a'}}>
                      <td style={{padding:'12px',color:'#f0f0f0',fontWeight:700}}>Total Income</td>
                      <td style={{padding:'12px',color:'#4ade80',fontWeight:700,fontSize:16,textAlign:'right'}}>₹{fmt(report.income.total)}</td>
                    </tr></tfoot>
                  </table>
                </div>

                <div className="card">
                  <div style={{fontSize:15,fontWeight:700,color:'#f87171',marginBottom:16}}>💸 Expenses (Paid)</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                    <thead><tr>
                      <th style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Category</th>
                      <th style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'right',fontSize:11,textTransform:'uppercase'}}>Amount (₹)</th>
                    </tr></thead>
                    <tbody>
                    {expenseRows.map((row, i) => (
                        <React.Fragment key={i}>
                          <tr>
                            <td style={{padding:'11px 12px',color:row.amount>0?'#ccc':'#444',borderBottom:row.breakdown?'none':'1px solid #161616'}}>{row.icon} {row.label}</td>
                            <td style={{padding:'11px 12px',color:row.amount>0?'#f87171':'#444',fontWeight:row.amount>0?600:400,borderBottom:row.breakdown?'none':'1px solid #161616',textAlign:'right'}}>₹{fmt(row.amount)}</td>
                          </tr>
                          {row.breakdown && Object.entries(row.breakdown).map(([k, v]) => (
                              <tr key={k}>
                                <td style={{padding:'5px 12px 5px 28px',color:'#555',fontSize:12,borderBottom:'1px solid #111'}}>↳ {k}</td>
                                <td style={{padding:'5px 12px',color:'#666',fontSize:12,borderBottom:'1px solid #111',textAlign:'right'}}>₹{fmt(v)}</td>
                              </tr>
                          ))}
                        </React.Fragment>
                    ))}
                    </tbody>
                    <tfoot><tr style={{borderTop:'2px solid #2a2a2a'}}>
                      <td style={{padding:'12px',color:'#f0f0f0',fontWeight:700}}>Total Expenses</td>
                      <td style={{padding:'12px',color:'#f87171',fontWeight:700,fontSize:16,textAlign:'right'}}>₹{fmt(report.expenses.total)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </div>

              {/* ── YET TO RECEIVE — merged per customer ── */}
              <div className="card" style={{marginBottom:20}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#fb923c'}}>⏳ Yet to Receive (Outstanding)</div>
                  <div style={{background:'#1a0c00',border:'1px solid #c2410c',borderRadius:8,padding:'6px 16px',fontSize:14,fontWeight:700,color:'#fb923c'}}>
                    Total: ₹{fmt(totalYetToReceive)}
                  </div>
                </div>

                {/* Search bar */}
                {ytrCustomers.length > 0 && !isPrinting && (
                    <div className="no-print" style={{marginBottom:14,position:'relative'}}>
                      <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#555',fontSize:14,pointerEvents:'none'}}>🔍</span>
                      <input
                          type="text"
                          placeholder="Search customer name…"
                          value={ytrSearch}
                          onChange={e => { setYtrSearch(e.target.value); setExpandedIdx(null); }}
                          style={{width:'100%',boxSizing:'border-box',background:'#141414',border:'1px solid #2a2a2a',borderRadius:8,padding:'8px 12px 8px 32px',color:'#e0e0e0',fontSize:13,outline:'none'}}
                      />
                      {ytrSearch && (
                          <button
                              onClick={() => { setYtrSearch(''); setExpandedIdx(null); }}
                              style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:16,lineHeight:1}}
                          >✕</button>
                      )}
                    </div>
                )}

                {ytrCustomers.length === 0 ? (
                    <div style={{textAlign:'center',padding:'28px 0',color:'#555',fontSize:13}}>
                      ✅ No outstanding billing — all customers have fully paid
                    </div>
                ) : (
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                      <thead>
                      <tr style={{background:'#160a00'}}>
                        <th style={{padding:'9px 10px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'left',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>#</th>
                        <th style={{padding:'9px 10px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'left',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>Customer</th>
                        <th style={{padding:'9px 10px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'left',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>Modules</th>
                        <th style={{padding:'9px 10px',color:'#f97316',borderBottom:'1px solid #2a2a2a',textAlign:'right',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>↩ Carry Forward</th>
                        <th style={{padding:'9px 10px',color:'#818cf8',borderBottom:'1px solid #2a2a2a',textAlign:'right',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>This Week Bill</th>
                        <th style={{padding:'9px 10px',color:'#4ade80',borderBottom:'1px solid #2a2a2a',textAlign:'right',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>Collected</th>
                        <th style={{padding:'9px 10px',color:'#fb923c',borderBottom:'1px solid #2a2a2a',textAlign:'right',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>Net Due</th>
                        {!isPrinting && <th className="no-print" style={{padding:'9px 10px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'center',fontSize:11,textTransform:'uppercase',letterSpacing:'0.6px'}}>Actions</th>}
                      </tr>
                      </thead>
                      <tbody>
                      {(() => {
                        const getName = (c) => c.name || c.customer?.name || '';
                        const filtered = ytrSearch.trim()
                            ? ytrCustomers.filter(c => getName(c).toLowerCase().includes(ytrSearch.trim().toLowerCase()))
                            : ytrCustomers;
                        if (filtered.length === 0) return (
                            <tr><td colSpan={8} style={{padding:'24px',textAlign:'center',color:'#555',fontSize:13}}>
                              No customers match "{ytrSearch}"
                            </td></tr>
                        );
                        return filtered.map((c, i) => (
                            <React.Fragment key={i}>
                              {/* ── Main customer row ── */}
                              <tr
                                  style={{borderBottom: expandedIdx === i ? 'none' : '1px solid #161616', cursor:'pointer', transition:'background 0.15s', background: expandedIdx === i ? '#1a1000' : 'transparent'}}
                                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                                  onMouseEnter={e => { if (expandedIdx !== i) e.currentTarget.style.background='#1a0d00'; }}
                                  onMouseLeave={e => { if (expandedIdx !== i) e.currentTarget.style.background='transparent'; }}
                              >
                                <td style={{padding:'11px 10px',color:'#555',fontSize:12}}>{i + 1}</td>
                                <td style={{padding:'11px 10px',color:'#e0e0e0',fontWeight:600}}>
                                  <span style={{marginRight:6}}>{expandedIdx === i ? '▾' : '▸'}</span>
                                  {getName(c)}
                                </td>
                                <td style={{padding:'11px 10px'}}>
                                  {(c.sources || []).map((src, si) => (
                                      <SourceBadge key={si} source={src.source} />
                                  ))}
                                </td>
                                {/* Carry Forward (all previous pending) */}
                                <td style={{padding:'11px 10px',textAlign:'right'}}>
                                  {(c.prevOutstanding > 0)
                                      ? <span style={{
                                        background:'#1a0d00',border:'1px solid #f9731650',
                                        borderRadius:6,padding:'3px 10px',
                                        color:'#f97316',fontWeight:700,fontSize:13,
                                        display:'inline-block'
                                      }}>↩ ₹{fmt(c.prevOutstanding)}</span>
                                      : <span style={{color:'#333',fontSize:12}}>—</span>
                                  }
                                </td>
                                {/* This Week Bill */}
                                <td style={{padding:'11px 10px',color:'#818cf8',textAlign:'right',fontWeight:500}}>
                                  ₹{fmt(c.thisWeekBill)}
                                </td>
                                {/* Collected this week */}
                                <td style={{padding:'11px 10px',color:'#4ade80',textAlign:'right',fontWeight:500}}>
                                  {(c.thisWeekCollected > 0)
                                      ? `₹${fmt(c.thisWeekCollected)}`
                                      : <span style={{color:'#444'}}>₹0</span>
                                  }
                                </td>
                                {/* Net Due */}
                                <td style={{padding:'11px 10px',textAlign:'right'}}>
                                <span style={{background:'#1a0c00',border:'1px solid #9a3412',borderRadius:6,padding:'3px 10px',color:'#fb923c',fontWeight:700,fontSize:13}}>
                                  ₹{fmt(c.remaining)}
                                </span>
                                </td>
                                {!isPrinting && (
                                    <td className="no-print" style={{padding:'11px 10px',textAlign:'center'}} onClick={e => e.stopPropagation()}>
                                      <div style={{display:'flex',gap:6,justifyContent:'center'}}>
                                        <button
                                            className="btn btn-secondary"
                                            style={{padding:'4px 10px',fontSize:11,whiteSpace:'nowrap'}}
                                            onClick={() => printCustomerBill(c, periodLabel)}
                                        >
                                          🖨️ Print Bill
                                        </button>
                                        <button
                                            onClick={() => shareCustomerBillAsPdf(c, periodLabel)}
                                            style={{display:'flex',alignItems:'center',gap:4,background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
                                        >
                                          <svg width="13" height="13" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                                          WA
                                        </button>
                                      </div>
                                    </td>
                                )}
                              </tr>

                              {/* ── Expanded: per-source breakdown ── */}
                              {expandedIdx === i && (
                                  <tr style={{borderBottom:'1px solid #161616'}}>
                                    <td colSpan={8} style={{padding:'0 14px 14px 40px',background:'#110a00'}}>

                                      {/* ── Outstanding summary mini-bar ── */}
                                      <div style={{display:'flex',gap:10,margin:'12px 0 4px',flexWrap:'wrap'}}>
                                        {c.prevOutstanding > 0 && (
                                            <div style={{background:'#1a0d00',border:'1px solid #f9731640',borderRadius:8,padding:'8px 14px',minWidth:140}}>
                                              <div style={{fontSize:10,color:'#f97316',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>↩ Carry Forward</div>
                                              <div style={{fontSize:15,fontWeight:700,color:'#f97316'}}>₹{fmt(c.prevOutstanding)}</div>
                                            </div>
                                        )}
                                        <div style={{background:'#0d0d1a',border:'1px solid #818cf840',borderRadius:8,padding:'8px 14px',minWidth:140}}>
                                          <div style={{fontSize:10,color:'#818cf8',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>This Week Bill</div>
                                          <div style={{fontSize:15,fontWeight:700,color:'#818cf8'}}>₹{fmt(c.thisWeekBill)}</div>
                                        </div>
                                        {c.thisWeekCollected > 0 && (
                                            <div style={{background:'#0a1a0a',border:'1px solid #4ade8040',borderRadius:8,padding:'8px 14px',minWidth:140}}>
                                              <div style={{fontSize:10,color:'#4ade80',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>Collected This Week</div>
                                              <div style={{fontSize:15,fontWeight:700,color:'#4ade80'}}>− ₹{fmt(c.thisWeekCollected)}</div>
                                            </div>
                                        )}
                                        <div style={{background:'#1a0c00',border:'1px solid #fb923c80',borderRadius:8,padding:'8px 14px',minWidth:140}}>
                                          <div style={{fontSize:10,color:'#fb923c',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>Net Due</div>
                                          <div style={{fontSize:15,fontWeight:700,color:'#fb923c'}}>₹{fmt(c.remaining)}</div>
                                        </div>
                                        {(() => {
                                          const _orders = (c.sources||[]).flatMap(s=>(s.orders||[]).map(o=>({...o,_src:s.source})));
                                          const _del = _orders.reduce((s,o)=>o._src==='Billing'&&o.billingType==='Trip'?s+(Number(o.trips)||0):s,0);
                                          const _pick= _orders.reduce((s,o)=>o._src==='Khet'   &&o.billingType==='Trip'?s+(Number(o.trips)||0):s,0);
                                          const _tot = _del + _pick;
                                          if(_tot===0) return null;
                                          return (
                                              <div style={{background:'#001a2c',border:'1px solid #38bdf880',borderRadius:8,padding:'8px 14px',minWidth:140}}>
                                                <div style={{fontSize:10,color:'#38bdf8',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>🔢 Total Trips</div>
                                                <div style={{fontSize:15,fontWeight:700,color:'#38bdf8'}}>{_tot} trip{_tot!==1?'s':''}</div>
                                                <div style={{fontSize:10,color:'#888',marginTop:3}}>
                                                  {_del>0&&<span style={{marginRight:8}}>🚛 {_del} del</span>}
                                                  {_pick>0&&<span>📦 {_pick} pick</span>}
                                                </div>
                                              </div>
                                          );
                                        })()}
                                      </div>

                                      {(c.sources || []).map((src, si) => {
                                        const srcStyle = SOURCE_STYLE[src.source] || { color: '#ccc', border: '#555' };
                                        return (
                                            <div key={si} style={{marginTop:12,border:`1px solid ${srcStyle.border}22`,borderRadius:8,overflow:'hidden'}}>
                                              {/* Source header */}
                                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                                                background:`${srcStyle.bg}`,padding:'8px 14px',borderBottom:`1px solid ${srcStyle.border}33`,flexWrap:'wrap',gap:6}}>
                                              <span style={{fontWeight:700,color:srcStyle.color,fontSize:13}}>
                                                <SourceBadge source={src.source} /> {src.source} Orders
                                              </span>
                                                <span style={{fontSize:12,color:'#aaa',display:'flex',gap:12,flexWrap:'wrap'}}>
                                                {src.prevOutstanding > 0 && (
                                                    <span>↩ Carry Fwd: <b style={{color:'#f97316'}}>₹{fmt(src.prevOutstanding)}</b></span>
                                                )}
                                                  <span>This Week: <b style={{color:'#818cf8'}}>₹{fmt(src.thisWeekBill != null ? src.thisWeekBill : src.totalBill)}</b></span>
                                                <span>Collected: <b style={{color:'#4ade80'}}>₹{fmt(src.thisWeekCollected != null ? src.thisWeekCollected : src.amountPaid)}</b></span>
                                                <span>Net Due: <b style={{color:'#fb923c'}}>₹{fmt(src.remaining)}</b></span>
                                              </span>
                                              </div>

                                              {/* Orders table */}
                                              {src.orders && src.orders.length > 0 ? (
                                                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                    <thead>
                                                    <tr style={{background:'#1a1200'}}>
                                                      <th style={{padding:'7px 12px',color:'#666',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Date</th>
                                                      <th style={{padding:'7px 12px',color:'#666',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Address</th>
                                                      <th style={{padding:'7px 12px',color:'#666',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Trips / Qty</th>
                                                      <th style={{padding:'7px 12px',color:'#666',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Vehicles</th>
                                                      <th style={{padding:'7px 12px',color:'#666',textAlign:'right',fontSize:11,textTransform:'uppercase'}}>Amount (₹)</th>
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                    {src.orders.sort((a,b)=>new Date(a.date)-new Date(b.date)).map((o, oi) => {
                                                      const tripQty = o.billingType === 'Trip'
                                                          ? `${o.trips} trips`
                                                          : `${o.qty} ${o.quantityUnit || 'units'}`;
                                                      const addressVal = (o.destination && o.destination.trim()) ? o.destination.trim() : '—';
                                                      return (
                                                          <tr key={oi} style={{borderTop:'1px solid #1e1800'}}>
                                                            <td style={{padding:'7px 12px',color:'#ccc'}}>{fmtDate(o.date)}</td>
                                                            <td style={{padding:'7px 12px',color:'#888'}}>{addressVal}</td>
                                                            <td style={{padding:'7px 12px',color:'#fff',fontWeight:600}}>{tripQty}</td>
                                                            <td style={{padding:'7px 12px',color:'#888'}}>
                                                              {o.vehicles && o.vehicles.length > 0
                                                                  ? o.vehicles.map((v, vi) => (
                                                                      <span key={vi} style={{background:'#1e2a1e',border:'1px solid #2a3a2a',borderRadius:4,padding:'1px 6px',fontSize:10,color:'#6ee7b7',marginRight:4,display:'inline-block'}}>
                                                                      {v}
                                                                    </span>
                                                                  ))
                                                                  : <span style={{color:'#444'}}>—</span>
                                                              }
                                                            </td>
                                                            <td style={{padding:'7px 12px',color:'#eab308',fontWeight:600,textAlign:'right'}}>₹{fmt(o.amount)}</td>
                                                          </tr>
                                                      );
                                                    })}
                                                    </tbody>
                                                    <tfoot>
                                                    <tr style={{background:'#1a1a00',borderTop:'1px solid #2a2a00'}}>
                                                      <td colSpan={4} style={{padding:'8px 12px',color:'#eab308',fontWeight:700,fontSize:12}}>
                                                        {src.source} This Week Total
                                                      </td>
                                                      <td style={{padding:'8px 12px',color:'#eab308',fontWeight:700,fontSize:13,textAlign:'right'}}>
                                                        ₹{fmt(src.thisWeekBill != null ? src.thisWeekBill : src.totalBill)}
                                                      </td>
                                                    </tr>
                                                    </tfoot>
                                                  </table>
                                              ) : (
                                                  <div style={{padding:'12px 14px',color:'#555',fontSize:12,fontStyle:'italic'}}>No order details available for this source.</div>
                                              )}
                                            </div>
                                        );
                                      })}
                                    </td>
                                  </tr>
                              )}
                            </React.Fragment>
                        ));
                      })()}
                      </tbody>
                      <tfoot>
                      <tr style={{borderTop:'2px solid #2a2a2a',background:'#160a00'}}>
                        <td colSpan={3} style={{padding:'12px 14px',color:'#f0f0f0',fontWeight:700}}>Totals</td>
                        <td style={{padding:'12px 10px',color:'#f97316',textAlign:'right',fontWeight:700}}>
                          ↩ ₹{fmt(ytrCustomers.reduce((s,c)=>s+(c.prevOutstanding||0),0))}
                        </td>
                        <td style={{padding:'12px 10px',color:'#818cf8',textAlign:'right',fontWeight:700}}>
                          ₹{fmt(ytrCustomers.reduce((s,c)=>s+(c.thisWeekBill||0),0))}
                        </td>
                        <td style={{padding:'12px 10px',color:'#4ade80',textAlign:'right',fontWeight:700}}>
                          ₹{fmt(ytrCustomers.reduce((s,c)=>s+(c.thisWeekCollected||0),0))}
                        </td>
                        <td style={{padding:'12px 10px',color:'#fb923c',fontWeight:700,fontSize:15,textAlign:'right'}}>
                          ₹{fmt(totalYetToReceive)}
                        </td>
                        <td></td>
                      </tr>
                      </tfoot>
                    </table>
                )}
              </div>

              {/* Yet to Pay */}
              {yetToPay && yetToPay.total > 0 && (
                  <div className="card" style={{marginBottom:20}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                      <div style={{fontSize:15,fontWeight:700,color:'#f87171'}}>💸 Yet to Pay (Outstanding)</div>
                      <div style={{background:'#1a0000',border:'1px solid #7f1d1d',borderRadius:8,padding:'6px 16px',fontSize:14,fontWeight:700,color:'#f87171'}}>
                        Total: ₹{fmt(yetToPay.total)}
                      </div>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                      <thead><tr style={{background:'#1a0000'}}>
                        <th style={{padding:'9px 14px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>Category</th>
                        <th style={{padding:'9px 14px',color:'#888',borderBottom:'1px solid #2a2a2a',textAlign:'right',fontSize:11,textTransform:'uppercase'}}>Amount (₹)</th>
                      </tr></thead>
                      <tbody>
                      {[yetToPay.staff, yetToPay.rentalVehicle, yetToPay.rentalPokland, yetToPay.operator, yetToPay.siteB]
                          .filter(row => row && typeof row === 'object' && Number(row.amount) > 0)
                          .map((row, i) => (
                              <React.Fragment key={i}>
                                <tr style={{borderBottom: row.grossAmount != null ? 'none' : '1px solid #161616'}}>
                                  <td style={{padding:'11px 14px',color:'#ccc'}}>{row.icon || ''} {row.label || ''}</td>
                                  <td style={{padding:'11px 14px',color:'#f87171',fontWeight:600,textAlign:'right'}}>₹{fmt(row.amount)}</td>
                                </tr>
                                {/* Rental vehicle deduction breakdown: rentalBill - billing - khet */}
                                {row.grossAmount != null && (
                                    <>
                                      <tr style={{borderBottom:'none'}}>
                                        <td style={{padding:'4px 14px 4px 28px',color:'#666',fontSize:12}}>↳ 🚛 Rental Bill (gross)</td>
                                        <td style={{padding:'4px 14px',color:'#888',fontSize:12,textAlign:'right'}}>₹{fmt(row.grossAmount)}</td>
                                      </tr>
                                      {Number(row.ownerBillingDue) > 0 && (
                                          <tr style={{borderBottom:'none'}}>
                                            <td style={{padding:'4px 14px 4px 28px',color:'#818cf8',fontSize:12}}>↳ 🧾 Owner Billing Due (deducted)</td>
                                            <td style={{padding:'4px 14px',color:'#818cf8',fontSize:12,textAlign:'right'}}>− ₹{fmt(row.ownerBillingDue)}</td>
                                          </tr>
                                      )}
                                      {Number(row.ownerKhetDue) > 0 && (
                                          <tr style={{borderBottom:'1px solid #161616'}}>
                                            <td style={{padding:'4px 14px 4px 28px',color:'#eab308',fontSize:12}}>↳ 🌾 Owner Khet Due (deducted)</td>
                                            <td style={{padding:'4px 14px',color:'#eab308',fontSize:12,textAlign:'right'}}>− ₹{fmt(row.ownerKhetDue)}</td>
                                          </tr>
                                      )}
                                      {Number(row.ownerBillingDue) === 0 && Number(row.ownerKhetDue) === 0 && (
                                          <tr style={{borderBottom:'1px solid #161616'}}>
                                            <td colSpan={2} style={{padding:'2px 14px 6px 28px',color:'#444',fontSize:11,fontStyle:'italic'}}>No Billing / Khet deductions for this owner</td>
                                          </tr>
                                      )}
                                    </>
                                )}
                              </React.Fragment>
                          ))}
                      </tbody>
                      <tfoot><tr style={{borderTop:'2px solid #2a2a2a',background:'#1a0000'}}>
                        <td style={{padding:'12px 14px',color:'#f0f0f0',fontWeight:700}}>Total Yet to Pay</td>
                        <td style={{padding:'12px 14px',color:'#f87171',fontWeight:700,fontSize:16,textAlign:'right'}}>₹{fmt(yetToPay.total)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
              )}

              <div className="card">
                <div style={{fontSize:15,fontWeight:700,color:'#f0f0f0',marginBottom:16}}>📊 Profit &amp; Loss Summary</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <tbody>
                  {incomeRows.map((row, i) => (
                      <tr key={`inc-${i}`} style={{borderBottom:'1px solid #111'}}>
                        <td style={{padding:'9px 16px',color:'#888'}}>{row.icon} {row.label}</td>
                        <td style={{padding:'9px 16px',color:row.amount>0?'#4ade80':'#555',textAlign:'right'}}>{row.amount > 0 ? `+ ₹${fmt(row.amount)}` : '₹0'}</td>
                      </tr>
                  ))}
                  <tr style={{borderTop:'1px solid #2a2a2a',borderBottom:'2px solid #2a2a2a',background:'#0a1a0a'}}>
                    <td style={{padding:'12px 16px',color:'#4ade80',fontWeight:700}}>Total Income</td>
                    <td style={{padding:'12px 16px',color:'#4ade80',fontWeight:700,textAlign:'right',fontSize:15}}>₹{fmt(report.income.total)}</td>
                  </tr>
                  <tr><td colSpan={2} style={{padding:4}}></td></tr>
                  {expenseRows.map((row, i) => (
                      <tr key={`exp-${i}`} style={{borderBottom:'1px solid #111'}}>
                        <td style={{padding:'9px 16px',color:row.amount>0?'#888':'#444'}}>{row.icon} {row.label}</td>
                        <td style={{padding:'9px 16px',color:row.amount>0?'#f87171':'#444',textAlign:'right'}}>{row.amount > 0 ? `− ₹${fmt(row.amount)}` : '₹0'}</td>
                      </tr>
                  ))}
                  <tr style={{borderTop:'1px solid #2a2a2a',borderBottom:'2px solid #2a2a2a',background:'#1a0a0a'}}>
                    <td style={{padding:'12px 16px',color:'#f87171',fontWeight:700}}>Total Expenses</td>
                    <td style={{padding:'12px 16px',color:'#f87171',fontWeight:700,textAlign:'right',fontSize:15}}>₹{fmt(report.expenses.total)}</td>
                  </tr>
                  <tr style={{borderBottom:'1px solid #2a2a2a',background:'#160a00'}}>
                    <td style={{padding:'12px 16px',color:'#fb923c',fontWeight:700}}>⏳ Yet to Receive</td>
                    <td style={{padding:'12px 16px',color:'#fb923c',fontWeight:700,textAlign:'right',fontSize:15}}>₹{fmt(totalYetToReceive)}</td>
                  </tr>
                  <tr style={{background:isProfit?'#0a1a0a':'#1a0a00'}}>
                    <td style={{padding:'18px 16px',color:isProfit?'#4ade80':'#f97316',fontWeight:700,fontSize:17}}>{isProfit ? '📈 Net Profit' : '📉 Net Loss'}</td>
                    <td style={{padding:'18px 16px',color:isProfit?'#4ade80':'#f97316',fontWeight:700,textAlign:'right',fontSize:22}}>{isProfit?'+':''}₹{fmt(report.netProfit)}</td>
                  </tr>
                  <tr>
                    <td style={{padding:'8px 16px',color:'#555',fontSize:12}}>Profit Margin</td>
                    <td style={{padding:'8px 16px',color:isProfit?'#4ade80':'#f97316',textAlign:'right',fontSize:13,fontWeight:600}}>{isProfit?'+':''}{report.profitMargin}%</td>
                  </tr>
                  </tbody>
                </table>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',marginTop:50,paddingTop:20}}>
                <div style={{textAlign:'center',width:200}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Chand Laluwale</div></div>
                <div style={{textAlign:'center',width:200}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Roshan Laluwale</div></div>
              </div>
            </div>
        )}
        {showChart && <SalesChartModal onClose={()=>setShowChart(false)}/>}
      </div>
  );
}