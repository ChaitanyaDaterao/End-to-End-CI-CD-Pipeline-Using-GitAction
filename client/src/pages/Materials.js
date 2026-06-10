const logo = require('../assets/logo.jpg');
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { printSection } from '../utils/printHelper';
import toast from 'react-hot-toast';
import { generateBillHTML } from '../utils/generateBillHTML';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const UNITS  = ['brass','trip','ton','kg','bag','cubic ft','piece','litre'];
const fmt    = (n) => Number(n||0).toLocaleString('en-IN');
const fmtD   = (d) => new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
const fmtDy  = (d) => new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'2-digit'});

// FIX: format local date as YYYY-MM-DD without UTC conversion
const fmtLocal = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

// FIX: helper to avoid template literals in JSX className attributes
const cls = (base, condition) => condition ? base + ' btn-primary' : base + ' btn-secondary';

const emptyMaterial = { name:'', unit:'brass', pricePerUnit:'', lowStockAlert:10, description:'' };
const emptyTx = { quantity:'', pricePerUnit:'', source:'', note:'', date:new Date().toISOString().slice(0,10) };

const getWeekStart = (date) => {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate()+(day===0?-6:1-day)); d.setHours(0,0,0,0); return d;
};
const getWeekEnd = (date) => {
  const s = getWeekStart(date); const e = new Date(s);
  e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e;
};

export default function Materials() {
  const [materials,    setMaterials]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState('stock');
  const [modal,        setModal]        = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [form,         setForm]         = useState(emptyMaterial);
  const [txForm,       setTxForm]       = useState(emptyTx);
  const [history,      setHistory]      = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [search,       setSearch]       = useState('');
  const [billType,     setBillType]     = useState('weekly');
  const [billDate,     setBillDate]     = useState(new Date().toISOString().slice(0,10));
  const [purchaseBill, setPurchaseBill] = useState(null);
  const [summary,      setSummary]      = useState(null);
  const [sumType,      setSumType]      = useState('weekly');
  const billRef        = useRef();
  const summaryRef     = useRef();
  const historyPrintRef = useRef();
  const isPrinting     = useRef(false);

  // Trip billing calculator
  const [tripModal,      setTripModal]      = useState(false);
  const [tripMaterial,   setTripMaterial]   = useState(null);
  const [tripBrass,      setTripBrass]      = useState('');
  const [tripRate,       setTripRate]       = useState(500);
  const [tripExtraRate,  setTripExtraRate]  = useState(150);

  // History filters
  const [histFilter,     setHistFilter]     = useState('all');
  const [histFilterDate, setHistFilterDate] = useState(new Date().toISOString().slice(0,10));
  const [histLoading,    setHistLoading]    = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get('/materials'); setMaterials(data); }
    catch { toast.error('Failed to load materials'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadPurchaseBill = async (type, date) => {
    try { const { data } = await api.get('/materials/purchase/' + type + '?date=' + date); setPurchaseBill(data); }
    catch { toast.error('Failed to load bill'); }
  };

  const loadSummary = async (type, date) => {
    try { const { data } = await api.get('/materials/summary?type=' + type + '&date=' + date); setSummary(data); }
    catch { toast.error('Failed to load summary'); }
  };

  const openAdd     = ()  => { setForm(emptyMaterial); setModal('add'); };
  const openEdit    = (m) => { setSelected(m); setForm({ name:m.name, unit:m.unit, pricePerUnit:m.pricePerUnit, lowStockAlert:m.lowStockAlert, description:m.description }); setModal('edit'); };
  const openStockIn = (m) => { setSelected(m); setTxForm({ ...emptyTx, pricePerUnit:m.pricePerUnit, date:new Date().toISOString().slice(0,10) }); setModal('stock-in'); };

  const openHistory = async (m) => {
    setSelected(m); setModal('history'); setHistory([]);
    setHistFilter('all'); setHistFilterDate(new Date().toISOString().slice(0,10));
    setHistLoading(true);
    try { const { data } = await api.get('/materials/' + m._id + '/transactions'); setHistory(data); }
    catch { toast.error('Failed to load history'); }
    finally { setHistLoading(false); }
  };

  const openTripBilling = (m) => {
    setTripMaterial(m);
    setTripBrass('');
    setTripRate(500);
    setTripExtraRate(150);
    setTripModal(true);
  };

  // Trip billing calculation logic
  const calcTripBill = (brass, ratePerTrip, extraRate) => {
    const b = Number(brass) || 0;
    if (b <= 0) return { trips: 0, extraBrass: 0, total: 0, breakdown: '' };
    const fullTrips  = Math.floor(b / 3);
    const extraBrass = b % 3;
    const total      = fullTrips * ratePerTrip + extraBrass * extraRate;
    let breakdown = fullTrips + ' trip' + (fullTrips !== 1 ? 's' : '') + ' × ₹' + fmt(ratePerTrip);
    if (extraBrass > 0) breakdown += ' + ' + extraBrass + ' extra brass × ₹' + fmt(extraRate);
    return { trips: fullTrips, extraBrass, total, breakdown };
  };

  const loadFilteredHistory = async (filter, date, matId) => {
    setHistLoading(true);
    try {
      const id = matId || selected?._id;
      let url = '/materials/' + id + '/transactions';
      const params = [];
      if (filter === 'daily') {
        params.push('from=' + date, 'to=' + date);
      } else if (filter === 'weekly') {
        const ws = getWeekStart(date);
        const we = getWeekEnd(date);
        params.push('from=' + fmtLocal(ws), 'to=' + fmtLocal(we));
      }
      if (params.length) url += '?' + params.join('&');
      const { data } = await api.get(url);
      setHistory(data);
    } catch { toast.error('Failed to load history'); }
    finally { setHistLoading(false); }
  };

  const handleHistFilterChange = (f) => { setHistFilter(f); loadFilteredHistory(f, histFilterDate); };
  const handleHistDateChange   = (d) => { setHistFilterDate(d); if (histFilter !== 'all') loadFilteredHistory(histFilter, d); };

  const handleSave = async () => {
    if (!form.name) return toast.error('Name is required');
    setSaving(true);
    try {
      if (modal==='add') { await api.post('/materials', form); toast.success('Material added'); }
      else { await api.put('/materials/' + selected._id, form); toast.success('Updated'); }
      setModal(null); load();
    } catch(e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this material?')) return;
    try { await api.delete('/materials/' + id); toast.success('Removed'); load(); }
    catch { toast.error('Error deleting'); }
  };

  const handleTx = async () => {
    if (!txForm.quantity || txForm.quantity<=0) return toast.error('Enter valid quantity');
    setSaving(true);
    try {
      await api.post('/materials/' + selected._id + '/stock-in', txForm);
      toast.success('Stock added ✅');
      setModal(null); load();
    } catch(e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const handleDeleteTx = async (txId) => {
    if (!window.confirm('Delete this transaction? Stock will be reversed automatically.')) return;
    try {
      await api.delete('/materials/transactions/' + txId);
      toast.success('Transaction deleted ✅');
      if (modal === 'history' && selected) loadFilteredHistory(histFilter, histFilterDate, selected._id);
      if (tab === 'purchase' && purchaseBill) loadPurchaseBill(billType, billDate);
      if (tab === 'summary' && summary) loadSummary(sumType, billDate);
      load();
    } catch(e) { toast.error(e.response?.data?.message || 'Error deleting'); }
  };

  // Derived
  const historyInTx  = history.filter(t => t.type === 'IN');
  const historyOutTx = history.filter(t => t.type === 'OUT');
  const customerList = histFilter === 'weekly'
      ? [...new Set(historyOutTx.map(t => t.khetCustomer || t.destination).filter(Boolean))]
      : [];
  const weekLabel = histFilter !== 'weekly' ? '' :
      fmtD(getWeekStart(histFilterDate)) + ' – ' + fmtD(getWeekEnd(histFilterDate));

  const filtered = materials.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

  // Print helpers
  const printWithIframe = (html) => {
    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(html); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  // ── Shared helper: render full HTML in iframe → capture full page → share as PDF ──
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
        try { await navigator.share({ files: [pdfFile], title: pdfName.replace('.pdf','') }); return; }
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

  const buildPurchaseBillHtml = () => {
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const period = billType==='daily'
        ? 'Date: ' + fmtD(purchaseBill.date)
        : fmtD(purchaseBill.weekStart) + ' to ' + fmtD(purchaseBill.weekEnd);

    let bodyHTML = '';
    if (billType==='weekly' && purchaseBill.dailyGroups) {
      bodyHTML = purchaseBill.dailyGroups.map(group => {
        const dayRows = group.txs.map(t =>
            '<tr>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;">' + (t.material?.name||'—') + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">' + t.quantity + ' ' + (t.material?.unit||'') + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹' + fmt(t.pricePerUnit) + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹' + fmt(t.totalAmount) + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">' + (t.source||'—') + '</td>' +
            '</tr>'
        ).join('');
        return '<tr><td colspan="5" style="padding:10px 12px;background:#f1f5f9;font-weight:700;color:#334155;font-size:12px;border-bottom:1px solid #e2e8f0;">📅 ' + fmtDy(group.date) + '</td></tr>' +
            dayRows +
            '<tr style="background:#fefce8;"><td colspan="3" style="padding:8px 12px;font-weight:700;color:#92400e;font-size:12px;border-bottom:2px solid #fde68a;">Day Total</td><td style="padding:8px 12px;font-weight:800;color:#92400e;text-align:right;border-bottom:2px solid #fde68a;">₹' + fmt(group.total) + '</td><td style="border-bottom:2px solid #fde68a;"></td></tr>';
      }).join('');
    } else {
      let rn = 1;
      bodyHTML = (purchaseBill.transactions||[]).map(t => {
        const bg = rn%2===0 ? 'background:#f8fafc;' : ''; rn++;
        return '<tr style="' + bg + '">' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;">' + (t.material?.name||'—') + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">' + t.quantity + ' ' + (t.material?.unit||'') + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹' + fmt(t.pricePerUnit) + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹' + fmt(t.totalAmount) + '</td>' +
            '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">' + (t.source||'—') + '</td>' +
            '</tr>';
      }).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No purchases on this date</td></tr>';
    }

    const sumRows = (purchaseBill.byMaterial||[]).map((bm,i) => {
      const bg = i%2===0 ? '' : 'background:#f8fafc;';
      return '<tr style="' + bg + '">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">' + (bm.material?.name||'—') + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">' + (bm.material?.unit||'') + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;">' + bm.qty + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹' + fmt(bm.amount) + '</td>' +
          '</tr>';
    }).join('');

    const billTypeLabel = billType==='daily' ? 'Daily' : 'Weekly';
    const purchaseHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Purchase Bill</title>' +
        '<style>@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\');' +
        '*{box-sizing:border-box;margin:0;padding:0;}' +
        'body{font-family:\'Inter\',\'Segoe UI\',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:16px;}' +
        'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
        'th.r{text-align:right;}th.c{text-align:center;}' +
        'td{font-size:12px;color:#374151;}' +
        'tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}' +
        'tfoot{display:table-row-group!important;}' +
        '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}' +
        '</style></head><body>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' + printTime + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
        '<div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>' +
        '</div></div>' +
        '<div style="text-align:right;">' +
        '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">' + billTypeLabel + ' Purchase Bill</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:4px;">' + period + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:14px;margin-bottom:20px;">' +
        '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Purchase</div>' +
        '<div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹' + fmt(purchaseBill.totalAmount) + '</div>' +
        '</div>' +
        '<div style="flex:1;background:#f1f5f9;border:2px solid #cbd5e1;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Materials</div>' +
        '<div style="font-size:22px;font-weight:900;color:#475569;">' + (purchaseBill.byMaterial||[]).length + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">📋 Transactions</div>' +
        '<table>' +
        '<thead><tr><th>Material</th><th class="c">Qty</th><th class="r">Price/Unit</th><th class="r">Total</th><th>Source</th></tr></thead>' +
        '<tbody>' + bodyHTML + '</tbody>' +
        '<tfoot><tr>' +
        '<td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Grand Total</td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹' + fmt(purchaseBill.totalAmount) + '</td>' +
        '<td style="background:#0f172a;padding:11px 12px;"></td>' +
        '</tr></tfoot>' +
        '</table>' +
        (sumRows ? '<div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;margin-top:8px;">📊 Material-wise Summary</div>' +
            '<table>' +
            '<thead><tr><th>Material</th><th>Unit</th><th class="c">Total Qty</th><th class="r">Total Amount</th></tr></thead>' +
            '<tbody>' + sumRows + '</tbody>' +
            '</table>' : '') +
        '<div style="display:flex;justify-content:space-between;margin-top:56px;">' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Supplier Signature</div></div>' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
        '</div>' +
        '</body></html>';

    return purchaseHtml;
  };

  const handlePrintPurchaseBill = () => { printWithIframe(buildPurchaseBillHtml()); };
  const handleSharePdfPurchaseBill = () => {
    const label = (billType==='daily' ? 'Daily' : 'Weekly') + '_Purchase_Bill.pdf';
    sharePdfFromHtml(buildPurchaseBillHtml(), label);
  };

  // ── Shared HTML shell ──
  const buildHistoryShell = (bodyRows, totalIn, totalOut, totalCost, totalOutCost, titleSuffix) => {
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const CSS = '@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\');' +
        '*{box-sizing:border-box;margin:0;padding:0;}' +
        'body{font-family:\'Inter\',\'Segoe UI\',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:16px;}' +
        'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
        'th.r{text-align:right;}th.c{text-align:center;}' +
        'td{font-size:12px;color:#374151;}' +
        'tfoot{display:table-row-group!important;}' +
        '.extra-row td{background:#fffbeb;color:#92400e;font-size:11px;font-style:italic;}' +
        '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Material Report</title>' +
        '<style>' + CSS + '</style></head><body>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' + printTime + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
        '<div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div>' +
        '<div style="text-align:right;">' +
        '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Weekly Material Report — ' + titleSuffix + '</div>' +
        '<div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:2px;">' + (selected?.name||'') + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:3px;">' + weekLabel + '</div>' +
        '</div></div>' +
        '<div style="display:flex;gap:14px;margin-bottom:20px;">' +
        '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;margin-bottom:5px;">Total IN</div>' +
        '<div style="font-size:20px;font-weight:900;color:#15803d;">' + totalIn + ' ' + (selected?.unit||'') + '</div></div>' +
        '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;margin-bottom:5px;">Total OUT</div>' +
        '<div style="font-size:20px;font-weight:900;color:#dc2626;">' + totalOut + ' ' + (selected?.unit||'') + '</div></div>' +
        '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;margin-bottom:5px;">Amount</div>' +
        '<div style="font-size:20px;font-weight:900;color:#1d4ed8;">₹' + fmt(totalIn > 0 ? totalCost : totalOutCost) + '</div></div>' +
        '</div>' +
        bodyRows +
        '<div style="display:flex;justify-content:space-between;margin-top:56px;">' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Supplier Signature</div></div>' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
        '</div></body></html>';
  };

  // ── OWNER print: all transactions, actual brass/trip, extra brass charges ──
  const buildHistoryHtmlOwner = () => {
    const isTrip     = selected?.unit === 'trip';
    const totalIn    = historyInTx.reduce((s,t) => s + t.quantity, 0);
    const totalOut   = historyOutTx.reduce((s,t) => s + t.quantity, 0);
    const totalCost  = historyInTx.reduce((s,t) => s + (t.totalAmount||0), 0);
    const totalOutCost = historyOutTx.reduce((s,t) => s + (t.totalAmount||0), 0);

    let rn = 1;
    let rows = '';
    history.forEach(t => {
      const bg = rn%2===0 ? 'background:#f8fafc;' : ''; rn++;
      const typeColor = t.type==='IN' ? '#15803d' : t.type==='SETTLED' ? '#1e40af' : '#991b1b';
      let brassInfo = { totalBrass:0, brassPerTrip:0, extraPerTrip:0 };
      if (isTrip && t.type==='OUT' && t.note) {
        const m = t.note.match(/(\d+)\s*brass/);
        brassInfo.totalBrass = m ? Number(m[1]) : 0;
        if (brassInfo.totalBrass > 0 && t.quantity > 0) {
          brassInfo.brassPerTrip = brassInfo.totalBrass / t.quantity;
          brassInfo.extraPerTrip = brassInfo.brassPerTrip % 3;
        }
      }
      const brassNote = (isTrip && t.type==='OUT' && brassInfo.brassPerTrip > 0)
          ? ' <span style=\"font-size:10px;color:#92400e;\">('+(Number.isInteger(brassInfo.brassPerTrip)?brassInfo.brassPerTrip:brassInfo.brassPerTrip.toFixed(1))+' brass/trip)</span>'
          : '';
      rows += '<tr style="' + bg + '">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;">' + fmtD(t.date) + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:' + typeColor + ';">' + t.type + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;">' + t.quantity + brassNote + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹' + fmt(t.pricePerUnit) + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹' + fmt(t.totalAmount) + '</td>' +
          '</tr>';
      if (isTrip && t.type==='OUT' && brassInfo.extraPerTrip > 0) {
        const extraCharge = t.quantity * brassInfo.extraPerTrip * 150;
        const baseCharge  = t.totalAmount - extraCharge;
        rows += '<tr>' +
            '<td colspan="3" style="padding:4px 12px 6px 24px;border-bottom:1px solid #fde68a;background:#fffbeb;color:#92400e;font-size:11px;font-style:italic;">' +
            '↳ ' + t.quantity + ' trips × ' + Math.floor(brassInfo.brassPerTrip/3)*3 + ' std brass = ₹' + fmt(baseCharge) +
            ' + ' + t.quantity + ' trips × ' + brassInfo.extraPerTrip + ' extra brass × ₹150 = ₹' + fmt(extraCharge) + ' extra</td>' +
            '<td style="padding:4px 12px 6px;border-bottom:1px solid #fde68a;background:#fffbeb;text-align:right;color:#92400e;font-size:11px;font-style:italic;">extra</td>' +
            '<td style="padding:4px 12px 6px;border-bottom:1px solid #fde68a;background:#fffbeb;text-align:right;font-weight:700;color:#92400e;">₹' + fmt(extraCharge) + '</td>' +
            '</tr>';
      }
    });
    if (!rows) rows = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No transactions</td></tr>';

    const tableHtml =
        '<table><thead><tr><th>Date</th><th>Type</th><th class="c">Qty (' + (selected?.unit||'') + ')</th><th class="r">Rate</th><th class="r">Amount (₹)</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr>' +
        '<td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total</td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:center;font-weight:800;">' + totalIn + ' IN / ' + totalOut + ' OUT</td>' +
        '<td style="background:#0f172a;padding:11px 12px;"></td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹' + fmt(totalIn > 0 ? totalCost : totalOutCost) + '</td>' +
        '</tr></tfoot></table>';
    return buildHistoryShell(tableHtml, totalIn, totalOut, totalCost, totalOutCost, 'Owner Copy');
  };

  // ── SITE print: flat ₹500/trip, no brass details ──
  const buildHistoryHtmlSite = () => {
    const SITE_RATE  = 500;
    const totalIn    = historyInTx.reduce((s,t) => s + t.quantity, 0);
    const totalOut   = historyOutTx.reduce((s,t) => s + t.quantity, 0);
    const totalCost  = historyInTx.reduce((s,t) => s + (t.totalAmount||0), 0);
    const totalOutCost = historyOutTx.reduce((s,t) => s + t.quantity * SITE_RATE, 0);

    let rn = 1;
    const rows = history.map(t => {
      const bg = rn%2===0 ? 'background:#f8fafc;' : ''; rn++;
      const typeColor = t.type==='IN' ? '#15803d' : t.type==='SETTLED' ? '#1e40af' : '#991b1b';
      const siteAmt   = t.type==='OUT' ? t.quantity * SITE_RATE : (t.totalAmount||0);
      return '<tr style="' + bg + '">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;">' + fmtD(t.date) + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:' + typeColor + ';">' + t.type + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;">' + t.quantity + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹' + fmt(t.type==='OUT'?SITE_RATE:t.pricePerUnit) + '/trip</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹' + fmt(siteAmt) + '</td>' +
          '</tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No transactions</td></tr>';

    const tableHtml =
        '<table><thead><tr><th>Date</th><th>Type</th><th class="c">Trips</th><th class="r">Rate (flat)</th><th class="r">Amount (₹)</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr>' +
        '<td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total</td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:center;font-weight:800;">' + totalOut + ' trips</td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:right;font-size:11px;">₹500/trip flat</td>' +
        '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹' + fmt(totalOutCost) + '</td>' +
        '</tr></tfoot></table>';
    return buildHistoryShell(tableHtml, totalIn, totalOut, totalCost, totalOutCost, 'Site Copy');
  };

  const handlePrintOwner = () => { printWithIframe(buildHistoryHtmlOwner()); };
  const handlePrintSite  = () => { printWithIframe(buildHistoryHtmlSite()); };
  const handleSharePdfHistory = () => {
    const label = 'Weekly_Material_Report_Owner_' + (selected?.name||'') + '.pdf';
    sharePdfFromHtml(buildHistoryHtmlOwner(), label);
  };

  const buildSummaryHtml = () => {
    if (!summary) return;
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const period = sumType==='daily'
        ? 'Date: ' + fmtD(new Date(summary.date||billDate))
        : fmtD(new Date(summary.start||summary.weekStart||billDate)) + ' – ' + fmtD(new Date(summary.end||summary.weekEnd||billDate));

    let rn = 1;
    const matRows = (summary.currentStock||[]).map(m => {
      const bg = rn%2===0 ? 'background:#f8fafc;' : ''; rn++;
      const stockColor = m.stock<=0 ? '#dc2626' : m.stock<=10 ? '#ca8a04' : '#15803d';
      return '<tr style="' + bg + '">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">' + (m.name||'—') + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">' + (m.unit||'') + '</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:800;color:' + stockColor + ';">' + (m.stock??'—') + '</td>' +
          '</tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;padding:20px;color:#94a3b8;">No data</td></tr>';

    const printHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Material Summary</title>' +
        '<style>@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\');' +
        '*{box-sizing:border-box;margin:0;padding:0;}' +
        'body{font-family:\'Inter\',\'Segoe UI\',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:16px;}' +
        'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
        'th.r{text-align:right;}th.c{text-align:center;}' +
        'td{font-size:12px;color:#374151;}' +
        '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}' +
        '</style></head><body>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' + printTime + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div>' +
        '<div style="text-align:right;">' +
        '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">' + (sumType==='daily'?'Daily':'Weekly') + ' Material Summary</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:4px;">' + period + '</div></div></div>' +
        '<div style="display:flex;gap:14px;margin-bottom:20px;">' +
        '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;margin-bottom:5px;">Purchased (IN)</div>' +
        '<div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹' + fmt(summary.stockIn?.totalAmount||0) + '</div></div>' +
        '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;margin-bottom:5px;">Khet Revenue</div>' +
        '<div style="font-size:22px;font-weight:900;color:#15803d;">₹' + fmt(summary.khetTotalRevenue||0) + '</div></div>' +
        '<div style="flex:1;background:' + (summary.profit>=0?'#dcfce7':'#fee2e2') + ';border:2px solid ' + (summary.profit>=0?'#86efac':'#fca5a5') + ';border-radius:10px;padding:13px 16px;text-align:center;">' +
        '<div style="font-size:10px;font-weight:700;color:' + (summary.profit>=0?'#15803d':'#dc2626') + ';text-transform:uppercase;margin-bottom:5px;">' + (summary.profit>=0?'Profit':'Loss') + '</div>' +
        '<div style="font-size:22px;font-weight:900;color:' + (summary.profit>=0?'#15803d':'#dc2626') + ';">₹' + fmt(Math.abs(summary.profit||0)) + '</div></div>' +
        '</div>' +
        '<div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">📦 Current Stock Levels</div>' +
        '<table><thead><tr><th>Material</th><th>Unit</th><th class="c">Stock</th></tr></thead>' +
        '<tbody>' + matRows + '</tbody></table>' +
        '<div style="display:flex;justify-content:space-between;margin-top:56px;">' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Supplier Signature</div></div>' +
        '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
        '</div></body></html>';

    return printHtml;
  };

  const handlePrintSummary = () => { printWithIframe(buildSummaryHtml()); };
  const handleSharePdfSummary = () => {
    const label = (sumType==='daily' ? 'Daily' : 'Weekly') + '_Material_Summary.pdf';
    sharePdfFromHtml(buildSummaryHtml(), label);
  };

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">📦 Materials</h1>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Material</button>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card yellow"><div className="stat-icon">📦</div><div className="stat-info"><div className="stat-value">{materials.length}</div><div className="stat-label">Materials</div></div></div>
          <div className="stat-card red"><div className="stat-icon">⚠️</div><div className="stat-info"><div className="stat-value">{materials.filter(m=>m.currentStock<=m.lowStockAlert).length}</div><div className="stat-label">Low Stock</div></div></div>
          <div className="stat-card green"><div className="stat-icon">✅</div><div className="stat-info"><div className="stat-value">{materials.filter(m=>m.currentStock>m.lowStockAlert).length}</div><div className="stat-label">Sufficient</div></div></div>
          <div className="stat-card blue"><div className="stat-icon">💰</div><div className="stat-info"><div className="stat-value">₹{fmt(materials.reduce((s,m)=>s+m.currentStock*m.pricePerUnit,0))}</div><div className="stat-label">Stock Value</div></div></div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <button className={cls('btn', tab==='stock')}    onClick={()=>setTab('stock')}>📦 Stock</button>
          <button className={cls('btn', tab==='purchase')} onClick={()=>setTab('purchase')}>🧾 Purchase Bill</button>
          <button className={cls('btn', tab==='summary')}  onClick={()=>setTab('summary')}>📊 Summary</button>
        </div>

        {/* ── STOCK TAB ── */}
        {tab==='stock' && (
            <div>
              <div style={{marginBottom:16}}>
                <input placeholder="Search materials..." value={search} onChange={e=>setSearch(e.target.value)}
                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:8,padding:'10px 14px',color:'#e0e0e0',fontSize:14,width:280,outline:'none'}}/>
              </div>
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                    <tr><th>Material</th><th>Unit</th><th>Current Stock</th><th>Purchase Price/Unit</th><th>Stock Value</th><th>Status</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                    {filtered.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:32}}>No materials found.</td></tr>}
                    {filtered.map(m=>(
                        <tr key={m._id}>
                          <td style={{fontWeight:600,color:'#f0f0f0'}}>{m.name}</td>
                          <td style={{color:'#666',textTransform:'uppercase',fontSize:12}}>{m.unit}</td>
                          <td style={{fontFamily:'monospace',fontSize:15,fontWeight:700,
                            color:m.currentStock<=0?'#f87171':m.currentStock<=m.lowStockAlert?'#eab308':'#4ade80'}}>
                            {m.currentStock} {m.unit}
                          </td>
                          <td style={{color:'#eab308'}}>₹{fmt(m.pricePerUnit)}</td>
                          <td>₹{fmt(m.currentStock*m.pricePerUnit)}</td>
                          <td>
                            {m.currentStock<=0
                                ? <span className="badge badge-red">Out of Stock</span>
                                : m.currentStock<=m.lowStockAlert
                                    ? <span className="badge badge-yellow">Low Stock</span>
                                    : <span className="badge badge-green">In Stock</span>}
                          </td>
                          <td>
                            <div style={{display:'flex',gap:6}}>
                              <button className="btn btn-primary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openStockIn(m)}>+ Stock IN</button>
                              <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openHistory(m)}>📋 History</button>
                              <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12,background:'#1a3a1a',border:'1px solid #2d5a2d',color:'#4ade80'}} onClick={()=>openTripBilling(m)}>🚛 Trip</button>
                              <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openEdit(m)}>✏️</button>
                              <button className="btn btn-danger" style={{padding:'6px 10px',fontSize:12}} onClick={()=>handleDelete(m._id)}>🗑</button>
                            </div>
                          </td>
                        </tr>
                    ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
        )}

        {/* ── PURCHASE BILL TAB ── */}
        {tab==='purchase' && (
            <div>
              <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                <button className={cls('btn', billType==='daily')}  onClick={()=>setBillType('daily')}>📆 Daily</button>
                <button className={cls('btn', billType==='weekly')} onClick={()=>setBillType('weekly')}>📅 Weekly</button>
                <input type="date" value={billDate} onChange={e=>setBillDate(e.target.value)}
                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={()=>loadPurchaseBill(billType,billDate)}>Generate</button>
                {purchaseBill && (<>
                  <button className="btn btn-secondary" onClick={handlePrintPurchaseBill}>🖨️ Print</button>
                  <button onClick={handleSharePdfPurchaseBill} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                    WhatsApp
                  </button>
                </>)}
              </div>
              {!purchaseBill ? (
                  <div className="card" style={{color:'#444',textAlign:'center',padding:40}}>Select date and click Generate</div>
              ) : (
                  <div ref={billRef}>
                    <div className="card" style={{marginBottom:8}}>
                      <div style={{fontSize:20,fontWeight:700,color:'#f0f0f0'}}>{billType==='daily'?'Daily':'Weekly'} Purchase Bill — R.C Enterprises</div>
                      <div style={{fontSize:13,color:'#888',marginTop:4}}>
                        {billType === 'daily' ? 'Date: ' + fmtD(purchaseBill.date) : 'Week: ' + fmtD(purchaseBill.weekStart) + ' to ' + fmtD(purchaseBill.weekEnd)}
                      </div>
                    </div>
                    {billType==='weekly' && purchaseBill.dailyGroups?.map((group,gi)=>(
                        <div key={gi} className="card" style={{marginBottom:8}}>
                          <div style={{fontSize:13,fontWeight:600,color:'#aaa',marginBottom:10}}>📅 {fmtDy(group.date)}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                            <thead><tr>{['Material','Qty','Price/Unit','Total','Source',''].map(h=><th key={h} style={{padding:'6px 10px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
                            <tbody>
                            {group.txs.map(t=>(
                                <tr key={t._id}>
                                  <td style={{padding:'8px 10px',color:'#ccc',borderBottom:'1px solid #161616'}}>{t.material?.name||'—'}</td>
                                  <td style={{padding:'8px 10px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{t.quantity} {t.material?.unit}</td>
                                  <td style={{padding:'8px 10px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(t.pricePerUnit)}</td>
                                  <td style={{padding:'8px 10px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(t.totalAmount)}</td>
                                  <td style={{padding:'8px 10px',color:'#666',borderBottom:'1px solid #161616'}}>{t.source||'—'}</td>
                                  <td style={{padding:'8px 10px',borderBottom:'1px solid #161616'}}>
                                    <button className="btn btn-danger" style={{padding:'3px 8px',fontSize:11}} onClick={()=>handleDeleteTx(t._id)}>🗑</button>
                                  </td>
                                </tr>
                            ))}
                            </tbody>
                            <tfoot><tr>
                              <td colSpan={3} style={{padding:'8px 10px',color:'#666',fontWeight:600}}>Day Total</td>
                              <td style={{padding:'8px 10px',color:'#eab308',fontWeight:700}}>₹{fmt(group.total)}</td>
                              <td colSpan={2}></td>
                            </tr></tfoot>
                          </table>
                        </div>
                    ))}
                    {billType==='daily' && (
                        <div className="card" style={{marginBottom:8}}>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                            <thead><tr>{['Material','Qty','Price/Unit','Total','Source','Note',''].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
                            <tbody>
                            {purchaseBill.transactions.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:24}}>No purchases on this date</td></tr>}
                            {purchaseBill.transactions.map(t=>(
                                <tr key={t._id}>
                                  <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{t.material?.name||'—'}</td>
                                  <td style={{padding:'9px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{t.quantity} {t.material?.unit}</td>
                                  <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(t.pricePerUnit)}</td>
                                  <td style={{padding:'9px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(t.totalAmount)}</td>
                                  <td style={{padding:'9px 12px',color:'#666',borderBottom:'1px solid #161616'}}>{t.source||'—'}</td>
                                  <td style={{padding:'9px 12px',color:'#555',borderBottom:'1px solid #161616'}}>{t.note||'—'}</td>
                                  <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}>
                                    <button className="btn btn-danger" style={{padding:'3px 8px',fontSize:11}} onClick={()=>handleDeleteTx(t._id)}>🗑</button>
                                  </td>
                                </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                    )}
                    <div className="card" style={{marginBottom:8}}>
                      <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:10}}>📋 Material-wise Summary</div>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <thead><tr>{['Material','Unit','Total Qty Purchased','Total Amount'].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
                        <tbody>
                        {purchaseBill.byMaterial.length===0 && <tr><td colSpan={4} style={{textAlign:'center',color:'#444',padding:16}}>No purchases</td></tr>}
                        {purchaseBill.byMaterial.map((bm,i)=>(
                            <tr key={i}>
                              <td style={{padding:'9px 12px',color:'#f0f0f0',fontWeight:600,borderBottom:'1px solid #161616'}}>{bm.material?.name}</td>
                              <td style={{padding:'9px 12px',color:'#666',borderBottom:'1px solid #161616'}}>{bm.material?.unit}</td>
                              <td style={{padding:'9px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{bm.qty}</td>
                              <td style={{padding:'9px 12px',color:'#eab308',fontWeight:700,borderBottom:'1px solid #161616'}}>₹{fmt(bm.amount)}</td>
                            </tr>
                        ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:10,padding:20,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{fontSize:15,fontWeight:600,color:'#eab308'}}>
                        Total Purchase — {billType === 'daily' ? fmtD(purchaseBill.date) : 'Week of ' + fmtD(purchaseBill.weekStart || purchaseBill.date)}
                      </div>
                      <div style={{fontSize:28,fontWeight:700,color:'#eab308'}}>
                        ₹{fmt(purchaseBill.totalAmount)}
                      </div>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16,borderTop:'1px solid #1e1e1e'}}>
                      <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Supplier Signature</div></div>
                      <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Owner Signature</div></div>
                    </div>
                  </div>
              )}
            </div>
        )}

        {/* ── SUMMARY TAB ── */}
        {tab==='summary' && (
            <div>
              <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                <button className={cls('btn', sumType==='daily')}  onClick={()=>setSumType('daily')}>📆 Daily</button>
                <button className={cls('btn', sumType==='weekly')} onClick={()=>setSumType('weekly')}>📅 Weekly</button>
                <input type="date" value={billDate} onChange={e=>setBillDate(e.target.value)}
                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={()=>loadSummary(sumType,billDate)}>Generate</button>
                {summary && (<>
                  <button className="btn btn-secondary" onClick={handlePrintSummary}>🖨️ Print</button>
                  <button onClick={handleSharePdfSummary} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                    WhatsApp
                  </button>
                </>)}
              </div>
              {!summary ? (
                  <div className="card" style={{color:'#444',textAlign:'center',padding:40}}>Select date and click Generate</div>
              ) : (
                  <div ref={summaryRef}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
                      <div className="stat-card yellow"><div className="stat-icon">📥</div><div className="stat-info"><div className="stat-value">₹{fmt(summary.stockIn.totalAmount)}</div><div className="stat-label">Purchased (IN)</div></div></div>
                      <div className="stat-card blue"><div className="stat-icon">📤</div><div className="stat-info"><div className="stat-value">₹{fmt(summary.khetTotalRevenue)}</div><div className="stat-label">Khet Revenue</div></div></div>
                      <div className="stat-card red"><div className="stat-icon">🌾</div><div className="stat-info"><div className="stat-value">{summary.khetOrders.reduce((s,k)=>s+(k.trips||0),0)} trips</div><div className="stat-label">Khet Trips</div></div></div>
                      <div className="stat-card green"><div className="stat-icon">💹</div><div className="stat-info"><div className="stat-value" style={{color:summary.profit>=0?'#4ade80':'#f87171'}}>₹{fmt(Math.abs(summary.profit))}</div><div className="stat-label">{summary.profit>=0?'▲ Profit':'▼ Loss'}</div></div></div>
                    </div>
                    {summary.unsettledByMaterial?.length>0 && (
                        <div style={{background:'#1a0e00',border:'1px solid #3a2200',borderRadius:8,padding:'10px 16px',marginBottom:8,fontSize:13}}>
                          ⏳ <strong style={{color:'#fb923c'}}>Unsettled khet orders this period:</strong>{' '}
                          {summary.unsettledByMaterial.map(m=>m.material?.name + ' — ' + m.qty + ' ' + m.material?.unit + ' (₹' + fmt(m.amount) + ')').join(' · ')}
                        </div>
                    )}
                    {summary.currentStock?.length>0 && (
                        <div className="card" style={{marginBottom:8}}>
                          <div style={{fontSize:14,fontWeight:700,color:'#f0f0f0',marginBottom:10}}>📦 Current Stock Levels</div>
                          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                            {summary.currentStock.map((m,i)=>(
                                <div key={i} style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:8,padding:'10px 16px',minWidth:140,textAlign:'center'}}>
                                  <div style={{fontSize:11,color:'#555',textTransform:'uppercase',marginBottom:4}}>{m.name}</div>
                                  <div style={{fontSize:20,fontWeight:700,color:m.stock<=0?'#f87171':m.stock<=10?'#eab308':'#4ade80'}}>{m.stock}</div>
                                  <div style={{fontSize:11,color:'#666'}}>{m.unit}</div>
                                </div>
                            ))}
                          </div>
                        </div>
                    )}
                    <div className="card" style={{marginBottom:8}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#f0f0f0',marginBottom:10}}>
                        📥 Stock IN — Purchases ({sumType==='daily' ? fmtD(new Date(billDate)) : 'Week of ' + fmtD(new Date(summary.start))})
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Date</th><th>Material</th><th>Qty</th><th>Price/Unit</th><th>Total</th><th>Supplier</th><th></th></tr></thead>
                          <tbody>
                          {summary.stockIn.transactions.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:16}}>No purchases</td></tr>}
                          {summary.stockIn.transactions.map((t,i)=>(
                              <tr key={i}>
                                <td style={{color:'#ccc',padding:'8px 12px'}}>{fmtD(t.date)}</td>
                                <td style={{color:'#f0f0f0',fontWeight:600,padding:'8px 12px'}}>{t.material?.name||'—'}</td>
                                <td style={{color:'#fff',padding:'8px 12px'}}>{t.quantity} {t.material?.unit}</td>
                                <td style={{color:'#888',padding:'8px 12px'}}>₹{fmt(t.pricePerUnit)}</td>
                                <td style={{color:'#eab308',fontWeight:600,padding:'8px 12px'}}>₹{fmt(t.totalAmount)}</td>
                                <td style={{color:'#666',padding:'8px 12px'}}>{t.source||'—'}</td>
                                <td style={{padding:'8px 12px'}}>
                                  <button className="btn btn-danger" style={{padding:'3px 8px',fontSize:11}} onClick={()=>handleDeleteTx(t._id)}>🗑</button>
                                </td>
                              </tr>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr style={{borderTop:'1px solid #2a2a2a'}}>
                            <td colSpan={4} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Total Purchased</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(summary.stockIn.totalAmount)}</td>
                            <td colSpan={2}></td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                    <div className="card" style={{marginBottom:8}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#f0f0f0',marginBottom:10}}>📤 Stock OUT — Via Khet Orders</div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                          <tr>
                            <th>Material</th>
                            <th>Customer</th>
                            <th>Trips</th>
                            <th>Brass Used</th>
                            <th>Qty (non-trip)</th>
                            <th>Amount (₹)</th>
                          </tr>
                          </thead>
                          <tbody>
                          {summary.khetOrders.length===0 && <tr><td colSpan={6} style={{textAlign:'center',color:'#444',padding:16}}>No Khet orders</td></tr>}
                          {summary.khetOrders.map((k,i)=>{
                            const customers = k.customers && k.customers.length > 0 ? k.customers : [];
                            return (
                                <React.Fragment key={i}>
                                  {/* Material header row */}
                                  <tr style={{background:'#0e1a2e'}}>
                                    <td colSpan={6} style={{padding:'7px 12px',color:'#60a5fa',fontWeight:700,fontSize:12,letterSpacing:'0.4px',borderBottom:'1px solid #1a2a3a'}}>
                                      🏗️ {k.materialName}
                                      <span style={{marginLeft:12,fontSize:11,color:'#888',fontWeight:400}}>
                                      {k.trips>0 ? k.trips+' trips total · '+k.brassQty+' brass total' : k.qty+' qty total'}
                                        {' · '}₹{fmt(k.amount)} total
                                    </span>
                                    </td>
                                  </tr>
                                  {/* Per-customer rows */}
                                  {customers.length===0 && (
                                      <tr>
                                        <td style={{padding:'8px 12px',color:'#555'}}>{k.materialName}</td>
                                        <td style={{padding:'8px 12px',color:'#888'}}>—</td>
                                        <td style={{padding:'8px 12px',color:'#ccc'}}>{k.trips||0}</td>
                                        <td style={{padding:'8px 12px',color:'#eab308',fontWeight:600}}>{k.brassQty>0 ? k.brassQty+' brass' : '—'}</td>
                                        <td style={{padding:'8px 12px',color:'#ccc'}}>{k.qty||'—'}</td>
                                        <td style={{padding:'8px 12px',color:'#4ade80',fontWeight:700}}>₹{fmt(k.amount)}</td>
                                      </tr>
                                  )}
                                  {customers.map((c,j)=>(
                                      <tr key={j} style={{background:j%2===0?'transparent':'#0a0a0a'}}>
                                        <td style={{padding:'8px 12px',color:'#555',fontSize:11}}>↳</td>
                                        <td style={{padding:'8px 12px',color:'#f0f0f0',fontWeight:600}}>{c.name}</td>
                                        <td style={{padding:'8px 12px',color:'#93c5fd',fontWeight:600}}>
                                          {c.trips>0 ? c.trips+' trips' : '—'}
                                        </td>
                                        <td style={{padding:'8px 12px',color:'#eab308',fontWeight:600}}>
                                          {c.brassQty>0 ? c.brassQty+' brass' : '—'}
                                        </td>
                                        <td style={{padding:'8px 12px',color:'#ccc'}}>
                                          {c.qty>0 ? c.qty : '—'}
                                        </td>
                                        <td style={{padding:'8px 12px',color:'#4ade80',fontWeight:700}}>₹{fmt(c.amount)}</td>
                                      </tr>
                                  ))}
                                </React.Fragment>
                            );
                          })}
                          </tbody>
                          <tfoot>
                          <tr style={{borderTop:'1px solid #2a2a2a'}}>
                            <td colSpan={5} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Total Khet Revenue</td>
                            <td style={{color:'#4ade80',fontWeight:700,padding:'10px 16px'}}>₹{fmt(summary.khetTotalRevenue)}</td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                    <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:10,padding:20}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Purchase Cost</div>
                          <div style={{fontSize:24,fontWeight:700,color:'#f87171'}}>₹{fmt(summary.stockIn.totalAmount)}</div>
                        </div>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Khet Revenue</div>
                          <div style={{fontSize:24,fontWeight:700,color:'#4ade80'}}>₹{fmt(summary.khetTotalRevenue)}</div>
                        </div>
                        <div style={{textAlign:'center',background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'8px 4px'}}>
                          <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Net Profit</div>
                          <div style={{fontSize:28,fontWeight:700,color:summary.profit>=0?'#4ade80':'#f87171'}}>₹{fmt(Math.abs(summary.profit))}</div>
                          <div style={{fontSize:11,color:summary.profit>=0?'#4ade80':'#f87171',marginTop:4}}>{summary.profit>=0?'▲ Profit':'▼ Loss'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
              )}
            </div>
        )}

        {/* ── MODALS ── */}
        {(modal==='add'||modal==='edit') && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h3>{modal==='add'?'Add Material':'Edit Material'}</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                <div className="form-grid">
                  <div className="form-group"><label>Material Name *</label><input placeholder="e.g. Sand, Murum, Gravel" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
                  <div className="form-group"><label>Unit *</label><select value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}>{UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
                  <div className="form-group"><label>Purchase Price per Unit (₹)</label><input type="number" placeholder="0" value={form.pricePerUnit} onChange={e=>setForm({...form,pricePerUnit:e.target.value})}/></div>
                  <div className="form-group"><label>Low Stock Alert (qty)</label><input type="number" placeholder="10" value={form.lowStockAlert} onChange={e=>setForm({...form,lowStockAlert:e.target.value})}/></div>
                  <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Description</label><input placeholder="Optional" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {modal==='stock-in' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h3>📥 Stock IN — {selected?.name}</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                <div className="modal-stock-info">
                  Current Stock: <strong>{selected?.currentStock} {selected?.unit}</strong>
                </div>
                <div className="form-grid">
                  <div className="form-group"><label>Quantity ({selected?.unit}) *</label><input type="number" placeholder="0" value={txForm.quantity} onChange={e=>setTxForm({...txForm,quantity:e.target.value})}/></div>
                  <div className="form-group"><label>Purchase Price per {selected?.unit} (₹)</label><input type="number" placeholder="0" value={txForm.pricePerUnit} onChange={e=>setTxForm({...txForm,pricePerUnit:e.target.value})}/></div>
                  <div className="form-group"><label>Supplier / Source</label><input placeholder="e.g. Supplier name, market" value={txForm.source} onChange={e=>setTxForm({...txForm,source:e.target.value})}/></div>
                  <div className="form-group"><label>Date</label><input type="date" value={txForm.date} onChange={e=>setTxForm({...txForm,date:e.target.value})}/></div>
                  <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={txForm.note} onChange={e=>setTxForm({...txForm,note:e.target.value})}/></div>
                </div>
                {txForm.quantity && txForm.pricePerUnit && (
                    <div className="modal-total">Total: ₹{fmt(Number(txForm.quantity)*Number(txForm.pricePerUnit))}</div>
                )}
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleTx} disabled={saving}>{saving?'Saving…':'Add Stock'}</button>
                </div>
              </div>
            </div>
        )}

        {/* ── HISTORY MODAL ── */}
        {modal==='history' && (
            <div className="modal-overlay" onClick={()=>{ if(!isPrinting.current) setModal(null); }}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()} style={{maxWidth:820}}>
                <div className="modal-header">
                  <h3>📋 History — {selected?.name}</h3>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    {histFilter==='weekly' && history.length>0 && (<>
                      <button className="btn btn-secondary" style={{padding:'5px 12px',fontSize:12,background:'#1e40af',color:'#fff',border:'none'}}
                              onClick={(e)=>{ e.stopPropagation(); handlePrintOwner(); }}>
                        🖨️ Print Owner
                      </button>
                      <button className="btn btn-secondary" style={{padding:'5px 12px',fontSize:12,background:'#15803d',color:'#fff',border:'none'}}
                              onClick={(e)=>{ e.stopPropagation(); handlePrintSite(); }}>
                        🖨️ Print Site
                      </button>
                      <button onClick={(e)=>{ e.stopPropagation(); handleSharePdfHistory(); }} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5C21.6 6.6 19.1 5.5 16.4 5.5C10.8 5.5 6.3 10 6.3 15.6C6.3 17.5 6.8 19.3 7.7 20.9L6.2 26.5L12 25C13.5 25.8 15.1 26.3 16.7 26.3H16.7C22.3 26.3 26.8 21.8 26.8 16.2C26.5 13.5 25.4 11 23.5 8.5ZM16.4 24.5C15 24.5 13.6 24.1 12.4 23.3L12.1 23.1L8.8 24L9.7 20.8L9.5 20.5C8.6 19.2 8.1 17.7 8.1 16.1C8.1 11.5 11.8 7.8 16.4 7.8C18.6 7.8 20.7 8.6 22.2 10.2C23.8 11.7 24.6 13.8 24.6 16C24.6 20.5 21 24.5 16.4 24.5ZM21 18.1C20.7 18 19.3 17.3 19 17.2C18.8 17.1 18.6 17 18.4 17.3C18.2 17.6 17.7 18.2 17.5 18.4C17.3 18.6 17.2 18.6 16.9 18.5C16.6 18.4 15.6 18 14.5 17C13.6 16.2 13 15.2 12.8 14.9C12.6 14.6 12.8 14.4 12.9 14.3C13.1 14.1 13.3 13.9 13.4 13.7C13.5 13.5 13.6 13.4 13.7 13.2C13.8 13 13.7 12.8 13.7 12.7C13.7 12.5 13.1 11.1 12.9 10.5C12.7 9.9 12.5 10 12.3 10H11.9C11.7 10 11.4 10.1 11.1 10.4C10.8 10.7 10.1 11.4 10.1 12.8C10.1 14.2 11.2 15.6 11.3 15.8C11.4 16 13.1 18.6 15.6 19.8C16.2 20.1 16.7 20.2 17.1 20.4C17.7 20.6 18.3 20.5 18.7 20.5C19.2 20.4 20.2 19.8 20.4 19.2C20.7 18.5 20.7 18 20.6 17.9C20.5 17.8 20.4 17.9 20.3 17.9L21 18.1Z" fill="white"/></svg>
                        WhatsApp
                      </button>
                    </>)}
                    <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                  </div>
                </div>

                <div style={{display:'flex',gap:16,padding:'8px 0',marginBottom:12,fontSize:13,color:'#888',flexWrap:'wrap'}}>
                  <span>Physical stock: <strong style={{color:'#4ade80'}}>{selected?.currentStock} {selected?.unit}</strong></span>
                  <span>IN: <strong style={{color:'#eab308'}}>{historyInTx.reduce((s,t)=>s+t.quantity,0)} {selected?.unit}</strong></span>
                  <span>OUT: <strong style={{color:'#fb923c'}}>{historyOutTx.reduce((s,t)=>s+t.quantity,0)} {selected?.unit}</strong></span>
                  {histFilter==='weekly' && historyInTx.length>0 && (
                      <span>Purchase cost: <strong style={{color:'#eab308'}}>₹{fmt(historyInTx.reduce((s,t)=>s+t.totalAmount,0))}</strong></span>
                  )}
                </div>

                <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'center',flexWrap:'wrap',padding:'10px 12px',background:'#0e0e0e',borderRadius:8,border:'1px solid #1e1e1e'}}>
                  <span style={{fontSize:12,color:'#555',marginRight:4}}>Filter:</span>
                  {['all','daily','weekly'].map(f=>(
                      <button key={f} className={cls('btn', histFilter===f)}
                              style={{padding:'5px 12px',fontSize:12}}
                              onClick={()=>handleHistFilterChange(f)}>
                        {f==='all'?'📋 All':f==='daily'?'📆 Daily':'📅 Weekly'}
                      </button>
                  ))}
                  {histFilter!=='all' && (
                      <input type="date" value={histFilterDate}
                             onChange={e=>handleHistDateChange(e.target.value)}
                             style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'6px 10px',color:'#e0e0e0',fontSize:12,marginLeft:4}}/>
                  )}
                  {histFilter==='weekly' && <span style={{fontSize:11,color:'#555',marginLeft:4}}>{weekLabel}</span>}
                  {histLoading && <span style={{fontSize:12,color:'#555',marginLeft:4}}>Loading…</span>}
                </div>

                {histFilter==='weekly' && customerList.length>0 && (
                    <div style={{marginBottom:12,padding:'10px 14px',background:'#0a0f1a',border:'1px solid #1a2a3a',borderRadius:8}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#60a5fa',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>
                        👤 Customers this week ({customerList.length})
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {customerList.map((c,i)=>(
                            <span key={i} style={{background:'#1a2a3a',border:'1px solid #2a3a4a',borderRadius:20,padding:'3px 10px',fontSize:12,color:'#93c5fd'}}>{c}</span>
                        ))}
                      </div>
                    </div>
                )}

                <div className="table-wrap" style={{maxHeight:340,overflowY:'auto'}}>
                  <table>
                    <thead>
                    <tr><th>Date</th><th>Type</th><th>Qty</th><th>Price/Unit</th><th>Total</th><th>Note</th><th></th></tr>
                    </thead>
                    <tbody>
                    {histLoading && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:24}}>Loading…</td></tr>}
                    {!histLoading && history.length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:24}}>No transactions for this period</td></tr>}
                    {!histLoading && history.map(tx=>(
                        <tr key={tx._id}>
                          <td style={{padding:'8px 12px',color:'#ccc'}}>{fmtD(tx.date)}</td>
                          <td style={{padding:'8px 12px'}}>
                        <span className={tx.type==='IN' ? 'badge badge-green' : 'badge badge-red'}
                              style={tx.type==='SETTLED' ? {background:'#1e3a5f',color:'#60a5fa',border:'1px solid #2a4a6f',borderRadius:12,padding:'2px 8px',fontSize:11} : {}}>
                          {tx.type}
                        </span>
                            {tx.khetOrderId && <span style={{fontSize:10,color:'#a78bfa',marginLeft:4}}>Khet</span>}
                            {tx.isSettled && tx.type==='OUT' && <span style={{fontSize:10,color:'#4ade80',marginLeft:4}}>✓ Paid</span>}
                          </td>
                          <td style={{padding:'8px 12px',fontWeight:600}}>{tx.quantity} {selected?.unit}</td>
                          <td style={{padding:'8px 12px',color:'#888'}}>₹{fmt(tx.pricePerUnit)}</td>
                          <td style={{padding:'8px 12px',color:'#eab308'}}>₹{fmt(tx.totalAmount)}</td>
                          <td style={{padding:'8px 12px',color:'#666'}}>{tx.note||'—'}</td>
                          <td style={{padding:'8px 12px'}}>
                            {tx.type!=='SETTLED' && (
                                <button className="btn btn-danger" style={{padding:'3px 8px',fontSize:11}} onClick={()=>handleDeleteTx(tx._id)}>🗑</button>
                            )}
                          </td>
                        </tr>
                    ))}
                    </tbody>
                    {history.length>0 && (
                        <tfoot>
                        <tr style={{borderTop:'1px solid #2a2a2a'}}>
                          <td colSpan={2} style={{padding:'8px 12px',color:'#555',fontSize:12}}>Totals</td>
                          <td style={{padding:'8px 12px',fontWeight:700,color:'#fff'}}>
                            IN: {historyInTx.reduce((s,t)=>s+t.quantity,0)} | OUT: {historyOutTx.reduce((s,t)=>s+t.quantity,0)}
                          </td>
                          <td></td>
                          <td style={{padding:'8px 12px',fontWeight:700,color:'#eab308'}}>
                            {(()=>{
                              const inAmt  = historyInTx.reduce((s,t)=>s+(t.totalAmount||0),0);
                              const outAmt = historyOutTx.reduce((s,t)=>s+(t.totalAmount||(t.quantity*(t.pricePerUnit||selected?.pricePerUnit||0))),0);
                              return '₹'+fmt(inAmt > 0 ? inAmt : outAmt);
                            })()}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                        </tfoot>
                    )}
                  </table>
                </div>

                {/* Weekly print (hidden) */}
                <div ref={historyPrintRef} style={{display:'none'}}>
                  <div style={{fontFamily:'serif',color:'#000',padding:'20px 30px'}}>
                    <div style={{borderBottom:'2px solid #000',paddingBottom:12,marginBottom:16}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                        <div style={{fontSize:20,fontWeight:700}}>R.C Enterprises</div>
                      </div>
                      <div style={{fontSize:15,fontWeight:600,marginTop:4}}>Weekly Material Report — {selected?.name}</div>
                      <div style={{fontSize:12,color:'#444',marginTop:4}}>{weekLabel}</div>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:16}}>
                      <thead>
                      <tr style={{background:'#f0f0f0'}}>
                        <th style={{padding:'6px 8px',border:'1px solid #ccc',textAlign:'left'}}>Date</th>
                        <th style={{padding:'6px 8px',border:'1px solid #ccc',textAlign:'left'}}>Type</th>
                        <th style={{padding:'6px 8px',border:'1px solid #ccc',textAlign:'right'}}>Qty ({selected?.unit})</th>
                        <th style={{padding:'6px 8px',border:'1px solid #ccc',textAlign:'right'}}>Price/Unit (₹)</th>
                        <th style={{padding:'6px 8px',border:'1px solid #ccc',textAlign:'right'}}>Amount (₹)</th>
                      </tr>
                      </thead>
                      <tbody>
                      {history.map((tx,i)=>(
                          <tr key={i} style={{background:i%2===0?'#fff':'#f9f9f9'}}>
                            <td style={{padding:'5px 8px',border:'1px solid #ccc'}}>{fmtD(tx.date)}</td>
                            <td style={{padding:'5px 8px',border:'1px solid #ccc',fontWeight:600,color:tx.type==='IN'?'#166534':tx.type==='SETTLED'?'#1e40af':'#991b1b'}}>{tx.type}</td>
                            <td style={{padding:'5px 8px',border:'1px solid #ccc',textAlign:'right',fontWeight:600}}>{tx.quantity}</td>
                            <td style={{padding:'5px 8px',border:'1px solid #ccc',textAlign:'right'}}>{fmt(tx.pricePerUnit)}</td>
                            <td style={{padding:'5px 8px',border:'1px solid #ccc',textAlign:'right',fontWeight:600}}>{fmt(tx.totalAmount)}</td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                    <div style={{border:'2px solid #000',borderRadius:4,padding:'14px 18px',marginBottom:20}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:10,borderBottom:'1px solid #ccc',paddingBottom:6}}>Weekly Summary — {selected?.name}</div>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                        <tbody>
                        <tr><td style={{padding:'5px 0',color:'#444'}}>Total Quantity Purchased (IN)</td><td style={{padding:'5px 0',fontWeight:700,textAlign:'right'}}>{historyInTx.reduce((s,t)=>s+t.quantity,0)} {selected?.unit}</td></tr>
                        <tr><td style={{padding:'5px 0',color:'#444'}}>Total Quantity Used via Khet (OUT)</td><td style={{padding:'5px 0',fontWeight:700,textAlign:'right'}}>{historyOutTx.reduce((s,t)=>s+t.quantity,0)} {selected?.unit}</td></tr>
                        <tr><td style={{padding:'5px 0',color:'#444'}}>Price per {selected?.unit}</td><td style={{padding:'5px 0',fontWeight:700,textAlign:'right'}}>₹{fmt(selected?.pricePerUnit)}</td></tr>
                        <tr style={{borderTop:'1px solid #ccc'}}>
                          <td style={{padding:'8px 0',fontWeight:700,fontSize:14}}>Total Purchase (OUT × ₹{fmt(selected?.pricePerUnit)})</td>
                          <td style={{padding:'8px 0',fontWeight:700,fontSize:16,textAlign:'right'}}>₹{fmt(historyOutTx.reduce((s,t)=>s+t.quantity,0) * (selected?.pricePerUnit||0))}</td>
                        </tr>
                        </tbody>
                      </table>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:40}}>
                      <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #000',paddingTop:8,fontSize:11,color:'#444'}}>Supplier Signature</div></div>
                      <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #000',paddingTop:8,fontSize:11,color:'#444'}}>Owner Signature</div></div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Close</button>
                </div>
              </div>
            </div>
        )}
        {/* ── TRIP BILLING MODAL ── */}
        {tripModal && (()=>{
          const bill = calcTripBill(tripBrass, tripRate, tripExtraRate);
          return (
              <div className="modal-overlay" onClick={()=>setTripModal(false)}>
                <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:460}}>
                  <div className="modal-header">
                    <h3>🚛 Trip Billing — {tripMaterial?.name}</h3>
                    <button className="modal-close" onClick={()=>setTripModal(false)}>✕</button>
                  </div>

                  {/* Info banner */}
                  <div style={{background:'#0a1a0a',border:'1px solid #1e3a1e',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#6ee7b7'}}>
                    <strong>📐 Pricing rules:</strong> 3 brass = 1 trip = ₹{fmt(tripRate)} &nbsp;|&nbsp; Extra brass (non-multiple of 3) = ₹{fmt(tripExtraRate)}/brass
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label>Total Brass Quantity *</label>
                      <input type="number" min="0" placeholder="e.g. 9, 10, 13…"
                             value={tripBrass}
                             onChange={e=>setTripBrass(e.target.value)}
                             style={{fontSize:18,fontWeight:700,textAlign:'center'}}/>
                    </div>
                    <div className="form-group">
                      <label>Rate per Trip (₹) <span style={{fontSize:11,color:'#555'}}>(3 brass = 1 trip)</span></label>
                      <input type="number" min="0" value={tripRate}
                             onChange={e=>setTripRate(Number(e.target.value))}/>
                    </div>
                    <div className="form-group">
                      <label>Extra Brass Rate (₹/brass)</label>
                      <input type="number" min="0" value={tripExtraRate}
                             onChange={e=>setTripExtraRate(Number(e.target.value))}/>
                    </div>
                  </div>

                  {/* Live result */}
                  {Number(tripBrass) > 0 && (
                      <div style={{background:'#0d0d0d',border:'1px solid #2a2a2a',borderRadius:10,padding:'16px 20px',marginBottom:8}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:4}}>Full Trips</div>
                            <div style={{fontSize:22,fontWeight:800,color:'#60a5fa'}}>{bill.trips}</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:4}}>Extra Brass</div>
                            <div style={{fontSize:22,fontWeight:800,color:bill.extraBrass>0?'#fbbf24':'#444'}}>
                              {bill.extraBrass}
                            </div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:4}}>Total Brass</div>
                            <div style={{fontSize:22,fontWeight:800,color:'#a78bfa'}}>{tripBrass}</div>
                          </div>
                        </div>
                        <div style={{borderTop:'1px solid #1e1e1e',paddingTop:12,textAlign:'center'}}>
                          <div style={{fontSize:11,color:'#555',marginBottom:4}}>{bill.breakdown}</div>
                          <div style={{fontSize:30,fontWeight:900,color:'#4ade80'}}>₹{fmt(bill.total)}</div>
                        </div>
                      </div>
                  )}
                  {Number(tripBrass) <= 0 && (
                      <div style={{textAlign:'center',padding:'20px 0',color:'#333',fontSize:13}}>
                        Enter brass quantity to calculate ↑
                      </div>
                  )}

                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={()=>setTripModal(false)}>Close</button>
                  </div>
                </div>
              </div>
          );
        })()}

      </div>
  );
}