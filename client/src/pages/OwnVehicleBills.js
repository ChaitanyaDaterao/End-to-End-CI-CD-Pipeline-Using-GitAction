const logo = require('../assets/logo.jpg');
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { printSection } from '../utils/printHelper';
import toast from 'react-hot-toast';
import { generateBillHTML } from '../utils/generateBillHTML';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit' });

const EXPENSE_TYPES = ['Diesel', 'Maintenance', 'Tyre', 'Oil Change', 'Repair', 'Driver Payment', 'Other'];

const emptyExpense = {
  vehicleId: '', date: new Date().toISOString().slice(0, 10),
  expenseType: 'Maintenance', amount: '', note: ''
};

export default function OwnVehicleBills() {
  const [tab, setTab] = useState('weekly');
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [weeklyBill, setWeeklyBill] = useState(null);
  const [allSummary, setAllSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [saving, setSaving] = useState(false);
  // Track which day rows are expanded to show per-order breakdown
  const [expandedDays, setExpandedDays] = useState({});
  const printRef = useRef();

  // ── Custom date range state ──
  const [rangeMode,      setRangeMode]      = useState('week');   // 'week' | 'custom'
  const [customFrom,     setCustomFrom]     = useState('');
  const [customTo,       setCustomTo]       = useState('');
  const [customBill,     setCustomBill]     = useState(null);
  const [customLoading,  setCustomLoading]  = useState(false);
  const [showCalendar,   setShowCalendar]   = useState(false);
  const [calMonth,       setCalMonth]       = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [calPickTarget,  setCalPickTarget]  = useState('from'); // 'from' | 'to'

  const loadVehicles = useCallback(async () => {
    try {
      const { data } = await api.get('/ownvehiclebills/vehicles');
      setVehicles(data);
      if (data.length > 0) setSelectedVehicle(data[0]._id);
    } catch { toast.error('Failed to load vehicles'); }
  }, []);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  const loadWeekly = async () => {
    if (!selectedVehicle) return toast.error('Select a vehicle');
    setLoading(true);
    setExpandedDays({});
    try {
      const { data } = await api.get(`/ownvehiclebills/weekly/${selectedVehicle}?date=${selectedDate}`);
      setWeeklyBill(data);
    } catch { toast.error('Failed to generate bill'); }
    finally { setLoading(false); }
  };

  const loadAllSummary = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/ownvehiclebills/weekly/all/summary?date=${selectedDate}`);
      setAllSummary(data);
    } catch { toast.error('Failed to load summary'); }
    finally { setLoading(false); }
  };

  const loadCustomRange = async () => {
    if (!selectedVehicle) return toast.error('Select a vehicle');
    if (!customFrom || !customTo) return toast.error('Select both From and To dates');
    if (customFrom > customTo) return toast.error('From date must be before To date');
    setCustomLoading(true);
    setCustomBill(null);
    try {
      const { data } = await api.get(`/ownvehiclebills/custom/${selectedVehicle}?from=${customFrom}&to=${customTo}`);
      setCustomBill(data);
    } catch { toast.error('Failed to load custom range'); }
    finally { setCustomLoading(false); }
  };

  // Calendar helpers
  const calDays = (year, month) => {
    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);
    const startDow = first.getDay(); // 0=Sun
    const days = [];
    for (let i = 0; i < (startDow === 0 ? 6 : startDow - 1); i++) days.push(null); // Mon-start padding
    for (let d = 1; d <= last.getDate(); d++) days.push(d);
    return days;
  };
  const toISO = (year, month, day) => `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const pickCalDay = (day) => {
    if (!day) return;
    const iso = toISO(calMonth.year, calMonth.month, day);
    if (calPickTarget === 'from') { setCustomFrom(iso); setCalPickTarget('to'); }
    else { setCustomTo(iso); setShowCalendar(false); setCalPickTarget('from'); }
  };
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_NAMES   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const openExpenseModal = (vehicleId = '') => {
    setExpenseForm({ ...emptyExpense, vehicleId: vehicleId || (vehicles[0]?._id || '') });
    setExpenseModal(true);
  };

  const handleAddExpense = async () => {
    if (!expenseForm.vehicleId) return toast.error('Select a vehicle');
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) return toast.error('Enter valid amount');
    setSaving(true);
    try {
      await api.post('/ownvehiclebills/expense', expenseForm);
      toast.success('Expense added');
      setExpenseModal(false);
      // Refresh the weekly bill so the new expense + note appear immediately
      if (weeklyBill) await loadWeekly();
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await api.delete(`/ownvehiclebills/expense/${id}`);
      toast.success('Deleted');
      loadWeekly();
    } catch { toast.error('Error deleting'); }
  };

  const printViaIframe = (title, htmlContent) => {
    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(htmlContent); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  const sharedCSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:30px 36px;color:#111827;background:#fff;font-size:13px;}
    table{width:100%;border-collapse:collapse;}
    th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
    th.r{text-align:right;}th.c{text-align:center;}
    td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
    tr:nth-child(even) td{background:#f8fafc;}
    tfoot{display:table-row-group!important;}
    @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:16px 22px;}}
  `;

  // ── Shared: render full HTML in iframe → capture full height → PDF ──
  const sharePdfFromHtml = async (fullHtml, pdfName = 'bill.pdf') => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:0;left:-9999px;width:900px;height:1px;border:none;visibility:hidden;';
      document.body.appendChild(iframe);
      await new Promise(resolve => { iframe.onload = resolve; iframe.srcdoc = fullHtml; });
      await new Promise(r => setTimeout(r, 800));
      const iframeBody = (iframe.contentDocument || iframe.contentWindow.document).body;
      const fullWidth  = 900;
      const fullHeight = iframeBody.scrollHeight;
      iframe.style.height = fullHeight + 'px';
      await new Promise(r => setTimeout(r, 100));
      const canvas = await html2canvas(iframeBody, {
        scale: 2, useCORS: true, allowTaint: true,
        backgroundColor: '#ffffff', logging: false,
        width: fullWidth, height: fullHeight,
        scrollX: 0, scrollY: 0,
        windowWidth: fullWidth, windowHeight: fullHeight,
      });
      document.body.removeChild(iframe);
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

  // Per-vehicle weekly bill HTML builder
  const buildWeeklyBillHtml = () => {
    if (!weeklyBill) return '';
    const v = weeklyBill.vehicle;
    const totalDiesel = weeklyBill.expenses.filter(e => e.expenseType === 'Diesel').reduce((s, e) => s + e.amount, 0);
    const totalExpenses = weeklyBill.expenses.filter(e => e.expenseType !== 'Diesel').reduce((s, e) => s + e.amount, 0);
    const grandTotal = weeklyBill.totalDiesel + weeklyBill.totalExpenses;
    const tripRows = weeklyBill.dailyTrips.map(d =>
        '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(d.date) + '</td>' +
        '<td style="color:#64748b;">' + (d.orders?.length||0) + ' order' + ((d.orders?.length||0)!==1?'s':'') + '</td>' +
        '<td style="color:#1d4ed8;font-weight:700;text-align:center;">' + d.trips + '</td></tr>'
    ).join('');
    const expRows = weeklyBill.expenses.map(e =>
        '<tr><td style="color:#475569;">' + fmtDay(e.date) + '</td>' +
        '<td><span style="display:inline-block;background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700;">' + e.expenseType + '</span></td>' +
        '<td style="color:#64748b;font-size:11px;">' + (e.note || '—') + '</td>' +
        '<td style="color:#b45309;font-weight:700;text-align:right;">&#8377;' + fmt(e.amount) + '</td></tr>'
    ).join('');
    const htmlContent = `<html><head><title>Own Vehicle Weekly Bill - ${v.vehicleNumber}</title><style>${sharedCSS}</style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:3px solid #0f172a;">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
          <div>
            <div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
            <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;text-transform:uppercase;letter-spacing:0.4px;">Chand Laluwale &amp; Roshan Laluwale</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Own Vehicle Weekly Bill</div>
          <div style="font-size:12px;color:#0f172a;font-weight:700;margin-top:4px;">${v.vehicleNumber} — ${v.vehicleType}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">Week: ${fmtDate(weeklyBill.weekStart)} to ${fmtDate(weeklyBill.weekEnd)}</div>
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:22px;">
        <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Trips</div>
          <div style="font-size:22px;font-weight:900;color:#1d4ed8;">${weeklyBill.totalTrips}</div>
        </div>
        <div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Diesel</div>
          <div style="font-size:22px;font-weight:900;color:#dc2626;">&#8377;${fmt(weeklyBill.totalDiesel)}</div>
        </div>
        <div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Other Expenses</div>
          <div style="font-size:22px;font-weight:900;color:#b45309;">&#8377;${fmt(weeklyBill.totalExpenses)}</div>
        </div>
        <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Grand Total</div>
          <div style="font-size:22px;font-weight:900;color:#15803d;">&#8377;${fmt(grandTotal)}</div>
        </div>
      </div>

      ${tripRows ? `<div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">📅 Daily Trips</div>
      <table style="margin-bottom:20px;">
        <thead><tr><th>Date</th><th>Orders</th><th class="c">Trips</th></tr></thead>
        <tbody>${tripRows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total</td>
          <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:center;">${weeklyBill.totalTrips}</td>
        </tr></tfoot>
      </table>` : ''}

      ${expRows ? `<div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">💸 Expenses</div>
      <table style="margin-bottom:20px;">
        <thead><tr><th>Date</th><th>Type</th><th>Note</th><th class="r">Amount (&#8377;)</th></tr></thead>
        <tbody>${expRows}</tbody>
        <tfoot><tr>
          <td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Grand Total</td>
          <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">&#8377;${fmt(grandTotal)}</td>
        </tr></tfoot>
      </table>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px;">
        <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Chand Laluwale</div></div>
        <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Roshan Laluwale</div></div>
      </div>
    </body></html>`;
    return htmlContent;
  };

  const handlePrint = () => { printViaIframe(`Own Vehicle Weekly Bill - ${weeklyBill?.vehicle?.vehicleNumber}`, buildWeeklyBillHtml()); };
  const handleSharePdfWeekly = () => {
    const label = `Own_Vehicle_Weekly_Bill_${weeklyBill?.vehicle?.vehicleNumber || ''}.pdf`;
    sharePdfFromHtml(buildWeeklyBillHtml(), label);
  };

  // All-vehicles summary HTML builder
  const buildSummaryHtml = () => {
    if (!allSummary) return '';
    const totalDiesel = allSummary.summary.reduce((s, v) => s + v.totalDiesel, 0);
    const totalExpenses = allSummary.summary.reduce((s, v) => s + v.totalExpenses, 0);
    const grandTotal = allSummary.summary.reduce((s, v) => s + v.grandTotal, 0);
    const rows = allSummary.summary.map(v =>
        '<tr><td style="font-weight:600;">' + v.vehicleNumber + '</td>' +
        '<td style="color:#64748b;">' + v.vehicleType + '</td>' +
        '<td style="text-align:center;color:#1d4ed8;font-weight:700;">' + v.totalTrips + '</td>' +
        '<td style="text-align:right;color:#dc2626;font-weight:700;">&#8377;' + fmt(v.totalDiesel) + '</td>' +
        '<td style="text-align:right;color:#b45309;font-weight:700;">&#8377;' + fmt(v.totalExpenses) + '</td>' +
        '<td style="text-align:right;color:#15803d;font-weight:700;">&#8377;' + fmt(v.grandTotal) + '</td></tr>'
    ).join('');
    const htmlContent = `<html><head><title>Own Vehicles Weekly Summary</title><style>${sharedCSS}</style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:3px solid #0f172a;">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
          <div>
            <div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
            <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;text-transform:uppercase;letter-spacing:0.4px;">Chand Laluwale &amp; Roshan Laluwale</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Own Vehicles Weekly Summary</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Week: ${fmtDate(allSummary.weekStart)} to ${fmtDate(allSummary.weekEnd)}</div>
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:22px;">
        <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Trips</div>
          <div style="font-size:22px;font-weight:900;color:#1d4ed8;">${allSummary.summary.reduce((s, v) => s + v.totalTrips, 0)}</div>
        </div>
        <div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Diesel</div>
          <div style="font-size:22px;font-weight:900;color:#dc2626;">&#8377;${fmt(totalDiesel)}</div>
        </div>
        <div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Other Expenses</div>
          <div style="font-size:22px;font-weight:900;color:#b45309;">&#8377;${fmt(totalExpenses)}</div>
        </div>
        <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Grand Total</div>
          <div style="font-size:22px;font-weight:900;color:#15803d;">&#8377;${fmt(grandTotal)}</div>
        </div>
      </div>

      <table>
        <thead><tr>
          <th>Vehicle No.</th><th>Type</th><th class="c">Total Trips</th>
          <th class="r">Diesel (&#8377;)</th><th class="r">Other Expenses (&#8377;)</th><th class="r">Grand Total (&#8377;)</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">No data for this week</td></tr>'}</tbody>
        <tfoot><tr>
          <td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Totals</td>
          <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${allSummary.summary.reduce((s, v) => s + v.totalTrips, 0)}</td>
          <td style="background:#0f172a;color:#fca5a5;padding:11px 12px;font-weight:800;text-align:right;">&#8377;${fmt(totalDiesel)}</td>
          <td style="background:#0f172a;color:#fcd34d;padding:11px 12px;font-weight:800;text-align:right;">&#8377;${fmt(totalExpenses)}</td>
          <td style="background:#0f172a;color:#86efac;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">&#8377;${fmt(grandTotal)}</td>
        </tr></tfoot>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:56px;">
        <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Chand Laluwale</div></div>
        <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Roshan Laluwale</div></div>
      </div>
    </body></html>`;
    return htmlContent;
  };

  const handleSummaryPrint = () => { printViaIframe('Own Vehicles Weekly Summary', buildSummaryHtml()); };
  const handleSharePdfSummary = () => { sharePdfFromHtml(buildSummaryHtml(), 'Own_Vehicles_Weekly_Summary.pdf'); };

  const toggleDay = (dateStr) => {
    setExpandedDays(prev => ({ ...prev, [dateStr]: !prev[dateStr] }));
  };

  const handleDeleteTrip = async (tripId) => {
    if (!window.confirm('Delete this trip order? This cannot be undone.')) return;
    try {
      await api.delete(`/ownvehiclebills/trip/${tripId}`);
      toast.success('Trip order deleted');
      loadWeekly(); // refresh bill
    } catch { toast.error('Error deleting trip'); }
  };

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">🚛 Own Vehicle Bills</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => openExpenseModal()}>+ Add Expense</button>
            {weeklyBill && tab === 'weekly' && (<>
              <button className="btn btn-primary" onClick={handlePrint}>🖨️ Print Bill</button>
              <button onClick={handleSharePdfWeekly} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                WhatsApp
              </button>
            </>)}
            {allSummary && tab === 'summary' && (<>
              <button className="btn btn-primary" onClick={handleSummaryPrint}>🖨️ Print Summary</button>
              <button onClick={handleSharePdfSummary} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                WhatsApp
              </button>
            </>)}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['weekly', 'summary'].map(t => (
              <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setTab(t); setWeeklyBill(null); setAllSummary(null); }}>
                {t === 'weekly' ? '📅 Weekly Bill (Per Vehicle)' : '📊 All Vehicles Summary'}
              </button>
          ))}
        </div>

        {/* Controls */}
        <div className="card" style={{ marginBottom: 20 }}>
          {/* Vehicle selector */}
          {tab === 'weekly' && (
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Own Vehicle</label>
                <select value={selectedVehicle} onChange={e => { setSelectedVehicle(e.target.value); setWeeklyBill(null); setCustomBill(null); }}>
                  <option value="">Select vehicle...</option>
                  {vehicles.map(v => <option key={v._id} value={v._id}>{v.vehicleNumber} — {v.vehicleType}</option>)}
                </select>
              </div>
          )}

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[['week','📅 Weekly View'],['custom','📆 Custom Range']].map(([m, label]) => (
                <button key={m}
                        className={`btn ${rangeMode === m ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => { setRangeMode(m); setWeeklyBill(null); setAllSummary(null); setCustomBill(null); }}>
                  {label}
                </button>
            ))}
          </div>

          {rangeMode === 'week' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Any date in that week</label>
                  <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
                </div>
                <button className="btn btn-primary"
                        onClick={tab === 'weekly' ? loadWeekly : loadAllSummary}
                        disabled={loading}>
                  {loading ? 'Loading...' : 'Generate Bill'}
                </button>
              </div>
          )}

          {rangeMode === 'custom' && tab === 'weekly' && (
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>From Date</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                             style={{ flex: 1 }} />
                      <button title="Open Calendar"
                              onClick={() => { setCalPickTarget('from'); setShowCalendar(v => !v); }}
                              style={{ background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 6, color: '#3b82f6', padding: '6px 10px', cursor: 'pointer', fontSize: 14 }}>
                        🗓
                      </button>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>To Date</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                             style={{ flex: 1 }} />
                      <button title="Open Calendar"
                              onClick={() => { setCalPickTarget('to'); setShowCalendar(v => !v); }}
                              style={{ background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 6, color: '#3b82f6', padding: '6px 10px', cursor: 'pointer', fontSize: 14 }}>
                        🗓
                      </button>
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={loadCustomRange} disabled={customLoading}>
                    {customLoading ? 'Loading...' : 'Generate Custom Bill'}
                  </button>
                  {(customFrom || customTo) && (
                      <button className="btn btn-secondary" onClick={() => { setCustomFrom(''); setCustomTo(''); setCustomBill(null); }}>✕ Clear</button>
                  )}
                </div>

                {/* Mini Calendar */}
                {showCalendar && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 8,
                      background: '#111', border: '1px solid #3b82f6', borderRadius: 12, padding: 16, width: 260, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                                style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 18, cursor: 'pointer' }}>‹</button>
                        <span style={{ fontWeight: 700, color: '#e0e0e0', fontSize: 13 }}>
                      {MONTH_NAMES[calMonth.month]} {calMonth.year}
                    </span>
                        <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                                style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 18, cursor: 'pointer' }}>›</button>
                      </div>
                      <div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>
                        Picking: <strong>{calPickTarget === 'from' ? 'FROM date' : 'TO date'}</strong>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center' }}>
                        {DAY_NAMES.map(d => <div key={d} style={{ fontSize: 9, color: '#555', fontWeight: 700, padding: '2px 0' }}>{d}</div>)}
                        {calDays(calMonth.year, calMonth.month).map((day, i) => {
                          const iso = day ? toISO(calMonth.year, calMonth.month, day) : null;
                          const isFrom = iso === customFrom;
                          const isTo   = iso === customTo;
                          const inRange = iso && customFrom && customTo && iso > customFrom && iso < customTo;
                          return (
                              <div key={i} onClick={() => pickCalDay(day)}
                                   style={{ padding: '5px 2px', borderRadius: 5, cursor: day ? 'pointer' : 'default', fontSize: 12,
                                     background: isFrom || isTo ? '#3b82f6' : inRange ? '#1e3a5f' : 'transparent',
                                     color: isFrom || isTo ? '#fff' : day ? '#e0e0e0' : 'transparent',
                                     fontWeight: isFrom || isTo ? 700 : 400,
                                     border: isFrom || isTo ? '1px solid #60a5fa' : '1px solid transparent',
                                   }}>
                                {day || ''}
                              </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <button onClick={() => setShowCalendar(false)}
                                style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                          Close
                        </button>
                      </div>
                    </div>
                )}
              </div>
          )}
        </div>

        {/* Printable area */}
        <div ref={printRef}>

          {/* Weekly Bill */}
          {tab === 'weekly' && weeklyBill && (
              <div className="card">
                <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                    Own Vehicle Weekly Bill
                  </div>
                  <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                    Vehicle: <strong style={{ color: '#eab308' }}>{weeklyBill.vehicle.vehicleNumber}</strong>
                    &nbsp;·&nbsp; Type: <strong style={{ color: '#fff' }}>{weeklyBill.vehicle.vehicleType}</strong>
                    &nbsp;·&nbsp; Week: {fmtDate(weeklyBill.weekStart)} to {fmtDate(weeklyBill.weekEnd)}
                  </div>
                </div>

                {/* Date & Trips section */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    📅 Date & Trips
                    <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>(click a row to see order breakdown)</span>
                  </div>
                  {weeklyBill.dailyTrips.length === 0 ? (
                      <div style={{ color: '#444', fontStyle: 'italic', fontSize: 13 }}>No trips this week</div>
                  ) : (
                      <>
                        <div className="table-wrap">
                          <table>
                            <thead>
                            <tr>
                              <th>Date</th>
                              <th>Orders</th>
                              <th>Total Trips</th>
                              <th data-no-print="true"></th>
                            </tr>
                            </thead>
                            <tbody>
                            {weeklyBill.dailyTrips.map((d, i) => {
                              const dayKey = new Date(d.date).toDateString();
                              const isExpanded = expandedDays[dayKey];
                              const orderCount = d.orders?.length || 0;
                              return (
                                  <React.Fragment key={i}>
                                    {/* Day summary row — clickable to expand */}
                                    <tr
                                        onClick={() => toggleDay(dayKey)}
                                        style={{ cursor: 'pointer', background: isExpanded ? '#1a1a2e' : 'transparent' }}
                                    >
                                      <td style={{ color: '#ccc' }}>{fmtDay(d.date)}</td>
                                      <td style={{ color: '#888', fontSize: 12 }}>
                                        {orderCount} order{orderCount !== 1 ? 's' : ''}
                                        <span style={{ marginLeft: 6, color: '#555' }}>{isExpanded ? '▲' : '▼'}</span>
                                      </td>
                                      <td style={{ color: '#fff', fontWeight: 700 }}>{d.trips}</td>
                                      <td data-no-print="true"></td>
                                    </tr>

                                    {/* Per-order breakdown rows (shown when expanded) */}
                                    {isExpanded && d.orders && d.orders.map((order, oi) => (
                                        <tr key={order._id || oi} style={{ background: '#0f0f1a' }}>
                                          <td style={{ paddingLeft: 28, color: '#555', fontSize: 11 }}>
                                            ↳ Order {oi + 1}
                                          </td>
                                          <td style={{ color: '#666', fontSize: 11 }}>
                                            {(() => {
                                              const src  = order.source?.trim();
                                              const dest = order.destination?.trim();
                                              if (src && dest)  return `${src} → ${dest}`;
                                              if (dest)         return `→ ${dest}`;
                                              if (src)          return src;
                                              if (order.driverName) return order.driverName;
                                              return <span style={{color:'#f87171',fontStyle:'italic'}}>No address saved</span>;
                                            })()}
                                          </td>
                                          <td style={{ color: '#a3e635', fontSize: 12, fontWeight: 600 }}>
                                            {order.numberOfTrips}
                                          </td>
                                          <td data-no-print="true">
                                            <button
                                                className="btn btn-danger"
                                                style={{ padding: '3px 7px', fontSize: 11 }}
                                                onClick={(e) => { e.stopPropagation(); handleDeleteTrip(order._id); }}
                                            >🗑</button>
                                          </td>
                                        </tr>
                                    ))}
                                  </React.Fragment>
                              );
                            })}
                            </tbody>
                            <tfoot>
                            <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                              <td colSpan={2} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>
                                Total Trips This Week
                              </td>
                              <td style={{ color: '#fff', fontWeight: 700, padding: '10px 16px', fontSize: 15 }}>
                                {weeklyBill.totalTrips}
                              </td>
                              <td data-no-print="true"></td>
                            </tr>
                            </tfoot>
                          </table>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '10px 16px', background: '#111', borderRadius: 8, border: '1px solid #1e1e1e' }}>
                          <span style={{ color: '#666', fontWeight: 600, fontSize: 13 }}>Total Diesel</span>
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: 15 }}>₹{fmt(weeklyBill.totalDiesel)}</span>
                        </div>
                      </>
                  )}
                </div>

                {/* Expenses section */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>🔧 Maintenance & Other Expenses</span>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}
                            data-no-print="true"
                            onClick={() => openExpenseModal(selectedVehicle)}>+ Add Expense</button>
                  </div>
                  {weeklyBill.expenses.length === 0 ? (
                      <div style={{ color: '#444', fontStyle: 'italic', fontSize: 13 }}>No expenses this week</div>
                  ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                          <tr><th>Date</th><th>Type</th><th>Note</th><th>Amount (₹)</th><th data-no-print="true"></th></tr>
                          </thead>
                          <tbody>
                          {weeklyBill.expenses.map(e => (
                              <tr key={e._id}>
                                <td style={{ color: '#ccc' }}>{fmtDay(e.date)}</td>
                                <td><span className="badge badge-blue">{e.expenseType}</span></td>
                                <td style={{ color: '#94a3b8', fontSize: 12, fontStyle: e.note ? 'normal' : 'italic' }}>
                                  {e.note || <span style={{ color: '#444' }}>—</span>}
                                </td>
                                <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(e.amount)}</td>
                                <td data-no-print="true">
                                  <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: 11 }}
                                          onClick={() => handleDeleteExpense(e._id)}>🗑</button>
                                </td>
                              </tr>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                            <td colSpan={3} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>Total Expenses</td>
                            <td style={{ color: '#eab308', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(weeklyBill.totalExpenses)}</td>
                            <td data-no-print="true"></td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                  )}
                </div>

                {/* Grand Total */}
                <div style={{ background: '#1a1600', border: '1px solid #2a2400', borderRadius: 10, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#eab308', fontFamily: 'Syne, sans-serif' }}>
                      Total Weekly Expenditure — {weeklyBill.vehicle.vehicleNumber}
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{weeklyBill.totalTrips}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Total Trips</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171' }}>₹{fmt(weeklyBill.totalDiesel)}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Diesel</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#eab308' }}>₹{fmt(weeklyBill.totalExpenses)}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Other Expenses</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>₹{fmt(weeklyBill.grandTotal)}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Grand Total</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Signature */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, paddingTop: 16 }}>
                  <div style={{ textAlign: 'center', width: 180 }}>
                    <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Chand Laluwale</div>
                  </div>
                  <div style={{ textAlign: 'center', width: 180 }}>
                    <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Roshan Laluwale</div>
                  </div>
                </div>
              </div>
          )}

          {/* Custom Range Bill */}
          {tab === 'weekly' && rangeMode === 'custom' && customBill && (
              <div className="card">
                <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                    📆 Custom Range Bill
                  </div>
                  <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                    Vehicle: <strong style={{ color: '#eab308' }}>{customBill.vehicle.vehicleNumber}</strong>
                    &nbsp;·&nbsp; Type: <strong style={{ color: '#fff' }}>{customBill.vehicle.vehicleType}</strong>
                    &nbsp;·&nbsp; Period: <strong style={{ color: '#3b82f6' }}>{customFrom}</strong> → <strong style={{ color: '#3b82f6' }}>{customTo}</strong>
                  </div>
                </div>

                {/* Stats bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
                  {[
                    { label: 'Total Trips', val: customBill.totalTrips, color: '#818cf8', bg: '#0e0e1a', border: '#2a2a4a' },
                    { label: 'Total Diesel', val: `₹${fmt(customBill.totalDiesel)}`, color: '#f87171', bg: '#1a0e0e', border: '#3a1a1a' },
                    { label: 'Other Expenses', val: `₹${fmt(customBill.totalExpenses)}`, color: '#eab308', bg: '#1a1600', border: '#2a2400' },
                    { label: 'Grand Total', val: `₹${fmt(customBill.grandTotal)}`, color: '#4ade80', bg: '#0a1a0a', border: '#166534' },
                  ].map(s => (
                      <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                      </div>
                  ))}
                </div>

                {/* Trips table */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginBottom: 12 }}>📅 Daily Trips</div>
                  {customBill.dailyTrips.length === 0 ? (
                      <div style={{ color: '#444', fontStyle: 'italic', fontSize: 13 }}>No trips in this range</div>
                  ) : (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Date</th><th>Orders</th><th>Trips</th><th>Diesel</th></tr></thead>
                          <tbody>
                          {customBill.dailyTrips.map((d, i) => (
                              <React.Fragment key={i}>
                                <tr>
                                  <td style={{ color: '#ccc' }}>{fmtDay(d.date)}</td>
                                  <td style={{ color: '#888', fontSize: 12 }}>{d.orders?.length || 0} order(s)</td>
                                  <td style={{ color: '#fff', fontWeight: 700 }}>{d.trips}</td>
                                  <td style={{ color: '#f87171' }}>{d.diesel > 0 ? `₹${fmt(d.diesel)}` : '—'}</td>
                                </tr>
                                {d.orders && d.orders.map((order, oi) => (
                                    <tr key={oi} style={{ background: '#0f0f1a' }}>
                                      <td style={{ paddingLeft: 28, color: '#555', fontSize: 11 }}>↳ Order {oi + 1}</td>
                                      <td style={{ color: '#666', fontSize: 11 }} colSpan={2}>
                                        {(() => {
                                          const src = order.source?.trim(); const dest = order.destination?.trim();
                                          if (src && dest) return `${src} → ${dest}`;
                                          if (dest) return `→ ${dest}`;
                                          if (src) return src;
                                          if (order.driverName) return order.driverName;
                                          return '—';
                                        })()}
                                      </td>
                                      <td style={{ color: '#a3e635', fontSize: 12, fontWeight: 600 }}>{order.numberOfTrips}</td>
                                    </tr>
                                ))}
                              </React.Fragment>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr><td colSpan={2} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>Total</td>
                            <td style={{ color: '#fff', fontWeight: 700, padding: '10px 16px', fontSize: 15 }}>{customBill.totalTrips}</td>
                            <td style={{ color: '#f87171', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(customBill.totalDiesel)}</td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                  )}
                </div>

                {/* Expenses table */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginBottom: 12 }}>🔧 Expenses</div>
                  {customBill.expenses.length === 0 ? (
                      <div style={{ color: '#444', fontStyle: 'italic', fontSize: 13 }}>No expenses in this range</div>
                  ) : (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Date</th><th>Type</th><th>Note</th><th>Amount (₹)</th></tr></thead>
                          <tbody>
                          {customBill.expenses.map(e => (
                              <tr key={e._id}>
                                <td style={{ color: '#ccc' }}>{fmtDay(e.date)}</td>
                                <td><span className="badge badge-blue">{e.expenseType}</span></td>
                                <td style={{ color: '#94a3b8', fontSize: 12 }}>{e.note || '—'}</td>
                                <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(e.amount)}</td>
                              </tr>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr><td colSpan={3} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>Total Expenses</td>
                            <td style={{ color: '#eab308', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(customBill.totalExpenses)}</td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                  )}
                </div>

                {/* Grand Total bar */}
                <div style={{ background: '#1a1600', border: '1px solid #2a2400', borderRadius: 10, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#eab308' }}>
                      Total Expenditure — {customBill.vehicle.vehicleNumber} ({customFrom} → {customTo})
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                      {[
                        { label: 'Total Trips', val: customBill.totalTrips, color: '#fff' },
                        { label: 'Diesel', val: `₹${fmt(customBill.totalDiesel)}`, color: '#f87171' },
                        { label: 'Other Expenses', val: `₹${fmt(customBill.totalExpenses)}`, color: '#eab308' },
                        { label: 'Grand Total', val: `₹${fmt(customBill.grandTotal)}`, color: '#4ade80' },
                      ].map(s => (
                          <div key={s.label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.val}</div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.label}</div>
                          </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
          )}

          {/* All Vehicles Summary */}
          {tab === 'summary' && allSummary && (
              <div className="card">
                <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                    All Own Vehicles — Weekly Summary
                  </div>
                  <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                    Week: {fmtDate(allSummary.weekStart)} to {fmtDate(allSummary.weekEnd)}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                    <tr>
                      <th>Vehicle No.</th><th>Type</th><th>Total Trips</th>
                      <th>Diesel (₹)</th><th>Other Expenses (₹)</th><th>Total (₹)</th>
                    </tr>
                    </thead>
                    <tbody>
                    {allSummary.summary.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: '#444', padding: 24 }}>No data for this week</td></tr>
                    )}
                    {allSummary.summary.map((s, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, color: '#f0f0f0' }}>{s.vehicle.vehicleNumber}</td>
                          <td style={{ color: '#888' }}>{s.vehicle.vehicleType}</td>
                          <td>{s.totalTrips}</td>
                          <td style={{ color: '#f87171' }}>₹{fmt(s.totalDiesel)}</td>
                          <td style={{ color: '#eab308' }}>₹{fmt(s.totalExpenses)}</td>
                          <td style={{ color: '#4ade80', fontWeight: 700 }}>₹{fmt(s.grandTotal)}</td>
                        </tr>
                    ))}
                    </tbody>
                    {allSummary.summary.length > 0 && (
                        <tfoot>
                        <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                          <td colSpan={2} style={{ color: '#666', padding: '12px 16px', fontWeight: 600 }}>Grand Total</td>
                          <td style={{ color: '#38bdf8', fontWeight: 700, padding: '12px 16px' }}>
                            {allSummary.summary.reduce((s, v) => s + v.totalTrips, 0)} trips
                          </td>
                          <td style={{ color: '#f87171', fontWeight: 700, padding: '12px 16px' }}>
                            ₹{fmt(allSummary.summary.reduce((s, v) => s + v.totalDiesel, 0))}
                          </td>
                          <td style={{ color: '#eab308', fontWeight: 700, padding: '12px 16px' }}>
                            ₹{fmt(allSummary.summary.reduce((s, v) => s + v.totalExpenses, 0))}
                          </td>
                          <td style={{ color: '#4ade80', fontWeight: 700, padding: '12px 16px' }}>
                            ₹{fmt(allSummary.summary.reduce((s, v) => s + v.grandTotal, 0))}
                          </td>
                        </tr>
                        </tfoot>
                    )}
                  </table>
                </div>
              </div>
          )}
        </div>

        {/* Add Expense Modal */}
        {expenseModal && (
            <div className="modal-overlay" onClick={() => setExpenseModal(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Add Vehicle Expense</h3>
                  <button className="modal-close" onClick={() => setExpenseModal(false)}>✕</button>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Vehicle *</label>
                    <select value={expenseForm.vehicleId} onChange={e => setExpenseForm({ ...expenseForm, vehicleId: e.target.value })}>
                      <option value="">Select vehicle...</option>
                      {vehicles.map(v => <option key={v._id} value={v._id}>{v.vehicleNumber} — {v.vehicleType}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Expense Type *</label>
                    <select value={expenseForm.expenseType} onChange={e => setExpenseForm({ ...expenseForm, expenseType: e.target.value })}>
                      {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Amount (₹) *</label>
                    <input type="number" placeholder="0" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Note <span style={{ color: '#666', fontWeight: 400 }}>(optional)</span></label>
                    <textarea
                        rows={2}
                        placeholder="e.g. Engine oil replaced, front tyre puncture fix..."
                        value={expenseForm.note}
                        onChange={e => setExpenseForm({ ...expenseForm, note: e.target.value })}
                        style={{ resize: 'vertical', minHeight: 60, width: '100%' }}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setExpenseModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleAddExpense} disabled={saving}>{saving ? 'Saving...' : 'Add Expense'}</button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}