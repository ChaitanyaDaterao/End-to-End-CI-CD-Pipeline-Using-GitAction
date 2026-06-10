import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
const logo = require('../assets/logo.jpg');
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit' });

const emptyStaff = { name: '', phone: '', role: 'Driver', ratePerTrip: '', dailyRate: '', note: '' };
const emptyAttend = { staffId: '', vehicleId: '', date: new Date().toISOString().slice(0,10), numberOfTrips: '', present: true, note: '' };
const emptyAdvance = { amount: '', date: new Date().toISOString().slice(0,10), note: '' };

// ── Inline editable cell ────────────────────────────────────────────────────
const EditableCell = ({ value, onSave, color, prefix = '₹', isNumber = true, style = {} }) => {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState('');
  const inputRef = React.useRef();

  const startEdit = () => { setVal(String(value ?? '')); setEditing(true); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0); };
  const commit = () => {
    setEditing(false);
    const parsed = isNumber ? Number(val) : val;
    if (isNumber && isNaN(parsed)) return;
    onSave(parsed);
  };

  if (editing) return (
      <input ref={inputRef} type={isNumber ? 'number' : 'text'} value={val}
             onChange={e => setVal(e.target.value)}
             onBlur={commit}
             onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
             style={{ width: 80, background: '#1a1a1a', border: '1px solid #eab308', borderRadius: 4,
               color: '#fff', padding: '2px 6px', fontSize: 13, fontWeight: 600, outline: 'none', ...style }} />
  );
  return (
      <span onClick={startEdit} title="Click to edit"
            style={{ cursor: 'pointer', borderBottom: '1px dashed #444', paddingBottom: 1, color: color || '#fff',
              fontWeight: 600, transition: 'border-color 0.15s', ...style }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#eab308'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#444'}>
      {prefix}{typeof value === 'number' ? value.toLocaleString('en-IN') : value}
    </span>
  );
};



export default function StaffPage() {
  const [tab, setTab] = useState('drivers');
  const [staff, setStaff] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyStaff);
  const [attendForm, setAttendForm] = useState(emptyAttend);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvance);
  const [weeklyBill, setWeeklyBill] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [payForm, setPayForm] = useState({ isPaid: false, isPartial: false, amountPaid: '', note: '' });
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0,10));
  const [saving, setSaving] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().slice(0,10));
  const [expandedSummaryStaff, setExpandedSummaryStaff] = useState(null);
  const summaryRef = useRef();
  const printRef = useRef();
  const isPrinting = useRef(false);

  const role = tab === 'drivers' ? 'Driver' : 'Conductor';

  const loadWeeklySummary = async (date) => {
    try {
      const { data } = await api.get(`/staff/summary/weekly?date=${date}`);
      setWeeklySummary(data);
    } catch { toast.error('Failed to load summary'); }
  };


  const backfillConductors = async () => {
    // Parse summaryDate as LOCAL midnight to avoid UTC offset shifting the day in IST.
    // new Date('2026-05-31') = UTC midnight = IST Saturday → wrong week bounds.
    const [sy, sm, sd] = summaryDate.split('-').map(Number);
    const toLocal = new Date(sy, sm - 1, sd);
    const fromLocal = new Date(sy, sm - 1, sd - 6);
    const toDate   = toLocal.toLocaleDateString('en-CA');   // YYYY-MM-DD local
    const fromDate = fromLocal.toLocaleDateString('en-CA'); // YYYY-MM-DD local
    try {
      const { data } = await api.post('/billing/backfill-conductor-attendance', {
        fromDate,
        toDate,
      });
      toast.success(data.message);
      await loadWeeklySummary(summaryDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Backfill failed');
    }
  };

  const saveSummaryOverride = async (staffId, field, targetTotal, weekStart, weekEnd) => {
    try {
      await api.put(`/staff/${staffId}/summary-override`, {
        weekStart, weekEnd, targetTotal, field,
      });
      toast.success(`${field === 'trips' ? 'Trips' : 'Days'} updated to ${targetTotal}`);
      await loadWeeklySummary(summaryDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
    }
  };

  const load = useCallback(async () => {
    try {
      const [staffRes, vehicleRes] = await Promise.all([
        api.get(`/staff?role=${role}`),
        api.get('/vehicles'),
      ]);
      setStaff(staffRes.data);
      setVehicles(vehicleRes.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, [role]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm({ ...emptyStaff, role }); setModal('add'); };
  const openEdit = (s) => {
    setSelected(s);
    setForm({ name: s.name, phone: s.phone, role: s.role, ratePerTrip: s.ratePerTrip, dailyRate: s.dailyRate, note: s.note });
    setModal('edit');
  };
  const openAttend = (s) => {
    setSelected(s);
    setAttendForm({ ...emptyAttend, staffId: s._id, date: new Date().toISOString().slice(0,10) });
    setModal('attend');
  };
  const openAdvance = (s) => {
    setSelected(s);
    setAdvanceForm({ ...emptyAdvance, date: new Date().toISOString().slice(0,10) });
    setModal('advance');
  };
  const openBill = async (s) => {
    setSelected(s);
    setWeeklyBill(null);
    setModal('bill');
    await loadBill(s._id, billDate);
  };

  const loadBill = async (id, date) => {
    try {
      const { data } = await api.get(`/staff/${id}/weekly?date=${date}`);
      setWeeklyBill(data);
      // load payment status
      try {
        const wStart = getWeekStart(date);
        const pRes = await api.get(`/staff/${id}/payment?weekStart=${wStart.toISOString()}`);
        setPaymentStatus(pRes.data);
        if (pRes.data) setPayForm({ isPaid: pRes.data.isPaid, isPartial: pRes.data.isPartial, amountPaid: pRes.data.amountPaid, note: pRes.data.note });
        else setPayForm({ isPaid: false, isPartial: false, amountPaid: '', note: '' });
      } catch {}
    } catch { toast.error('Failed to load bill'); }
  };

  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  };

  const handleMarkPayment = async () => {
    if (!weeklyBill) return;
    try {
      const wStart = getWeekStart(billDate);
      await api.post(`/staff/${selected._id}/payment`, {
        weekStart: wStart.toISOString(),
        grossPay: weeklyBill.grossPay,
        totalAdvance: weeklyBill.totalAdvance,
        netPay: weeklyBill.netPay,
        amountPaid: payForm.isPartial ? Number(payForm.amountPaid) : weeklyBill.netPay,
        isPaid: payForm.isPaid,
        isPartial: payForm.isPartial,
        note: payForm.note,
      });
      toast.success('Payment status updated');
      await loadBill(selected._id, billDate);
    } catch (e) { toast.error('Error saving payment'); }
  };

  const handleSave = async () => {
    if (!form.name) return toast.error('Name is required');
    setSaving(true);
    try {
      if (modal === 'add') { await api.post('/staff', form); toast.success('Staff added'); }
      else { await api.put(`/staff/${selected._id}`, form); toast.success('Updated'); }
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this staff member?')) return;
    try { await api.delete(`/staff/${id}`); toast.success('Removed'); load(); }
    catch { toast.error('Error'); }
  };

  const handleAttend = async () => {
    if (!attendForm.vehicleId) return toast.error('Select a vehicle');
    if (selected.role === 'Driver' && !attendForm.numberOfTrips) return toast.error('Enter number of trips');
    setSaving(true);
    try {
      await api.post('/staff/attendance', { ...attendForm, staffId: selected._id });
      toast.success('Attendance marked');
      if (selected._id && billDate) await loadBill(selected._id, billDate);
      if (selected.role === 'Driver') {
        // Keep modal open on same date/vehicle — driver may have more trips to log
        setAttendForm(f => ({ ...f, numberOfTrips: '', note: '' }));
      } else {
        setModal(null);
      }
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleAdvance = async () => {
    if (!advanceForm.amount || Number(advanceForm.amount) <= 0) return toast.error('Enter valid amount');
    setSaving(true);
    try {
      await api.post(`/staff/${selected._id}/advance`, advanceForm);
      toast.success('Advance recorded');
      setModal(null);
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDeleteAttend = async (id) => {
    try {
      await api.delete(`/staff/attendance/${id}`);
      toast.success('Deleted');
      await loadBill(selected._id, billDate);
    } catch { toast.error('Error'); }
  };

  const handleUpdateTrips = async (attendanceId, newTrips) => {
    try {
      await api.patch(`/staff/attendance/${attendanceId}`, { numberOfTrips: newTrips });
      toast.success('Trips updated');
      await loadBill(selected._id, billDate);
    } catch { toast.error('Failed to update trips'); }
  };

  const handleDeleteAdvance = async (id) => {
    try {
      await api.delete(`/staff/advance/${id}`);
      toast.success('Deleted');
      await loadBill(selected._id, billDate);
    } catch { toast.error('Error'); }
  };

  // ── Share PDF via WhatsApp ────────────────────────────────────────────────
  const sharePdfFromHtml = async (htmlString, filename) => {
    return new Promise((resolve, reject) => {
      let iframe = document.getElementById('__wa_share_iframe__');
      if (iframe) iframe.remove();
      iframe = document.createElement('iframe');
      iframe.id = '__wa_share_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;visibility:hidden;';
      document.body.appendChild(iframe);
      iframe.srcdoc = htmlString;
      iframe.onload = async () => {
        try {
          const canvas = await html2canvas(iframe.contentDocument.body, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pdfW = pdf.internal.pageSize.getWidth();
          const pdfH = (canvas.height * pdfW) / canvas.width;
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
          const pdfBlob = pdf.output('blob');
          const file = new File([pdfBlob], filename, { type: 'application/pdf' });
          iframe.remove();
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
          } else {
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
          }
          resolve();
        } catch (err) { iframe.remove(); reject(err); }
      };
    });
  };

  const handleWhatsApp = async () => {
    if (!weeklyBill) return;
    const toastId = toast.loading('Generating PDF…');
    try {
      const s = weeklyBill.staff;
      const isDriver = s.role === 'Driver';
      const CSS = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:30px 36px;color:#111827;background:#fff;font-size:13px;}
        table{width:100%;border-collapse:collapse;margin-bottom:20px;}
        th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
        td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
        tr:nth-child(even) td{background:#f8fafc;}
        .sig-row{display:flex;justify-content:space-between;margin-top:56px;}
        .sig-line{border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;text-align:center;width:200px;font-weight:500;}
        tfoot{display:table-row-group!important;}
      `;
      const attendRows = (() => {
        const filtered = weeklyBill.attendance.filter(a => a.source !== 'summary-edit');
        if (isDriver) {
          // Group by date, sum trips
          const grouped = [];
          const seen = {};
          filtered.forEach(a => {
            const dk = a.date?.slice(0,10);
            if (seen[dk]) { seen[dk].trips += (a.numberOfTrips||0); }
            else { const g = { date: a.date, vehicle: a.vehicle, trips: a.numberOfTrips||0 }; seen[dk] = g; grouped.push(g); }
          });
          return grouped.map(g => '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(g.date) + '</td>' +
              '<td style="color:#374151;">' + (g.vehicle?.vehicleNumber||'&mdash;') + '</td>' +
              '<td style="color:#1d4ed8;font-weight:700;">' + g.trips + '</td>' +
              '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(g.trips * s.ratePerTrip) + '</td></tr>').join('');
        }
        return filtered.map(a => {
          const earning = a.present ? fmt(s.dailyRate) : '0';
          return '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(a.date) + '</td>' +
              '<td style="color:#374151;">' + (a.vehicle?.vehicleNumber||'&mdash;') + '</td>' +
              '<td><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:' + (a.present?'#dcfce7':'#fee2e2') + ';color:' + (a.present?'#15803d':'#dc2626') + ';border:1px solid ' + (a.present?'#86efac':'#fca5a5') + ';">' + (a.present?'Present':'Absent') + '</span></td>' +
              '<td style="color:#b45309;font-weight:700;">&#8377;' + earning + '</td></tr>';
        }).join('');
      })();
      const advRows = weeklyBill.advances.length > 0
          ? weeklyBill.advances.map(a =>
              '<tr><td style="color:#475569;">' + fmtDay(a.date) + '</td>' +
              '<td style="color:#dc2626;font-weight:700;">&#8377;' + fmt(a.amount) + '</td>' +
              '<td style="color:#64748b;">' + (a.note||'&mdash;') + '</td></tr>'
          ).join('') : '';
      const netDue = weeklyBill.finalNetPay ?? weeklyBill.netPay;
      const staffHtml = '<html><head><title>Staff Bill - ' + s.name + '</title><style>' + CSS + '</style></head><body>' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:3px solid #0f172a;">' +
          '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
          '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">Chand Laluwale &amp; Roshan Laluwale</div></div></div>' +
          '<div style="text-align:right;">' +
          '<div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.9px;margin-bottom:4px;">Weekly ' + s.role + ' Bill</div>' +
          '<div style="font-size:20px;font-weight:900;color:#0f172a;">' + s.name + '</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:3px;">Week: ' + fmtDate(weeklyBill.weekStart) + ' to ' + fmtDate(weeklyBill.weekEnd) + ' &nbsp;&middot;&nbsp; Rate: ' + (isDriver ? '&#8377;' + fmt(s.ratePerTrip) + '/trip' : '&#8377;' + fmt(s.dailyRate) + '/day') + '</div>' +
          '</div></div>' +
          '<div style="display:flex;gap:12px;margin-bottom:22px;">' +
          '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">' + (isDriver?'Trips':'Days') + '</div><div style="font-size:20px;font-weight:900;color:#1d4ed8;">' + (isDriver?weeklyBill.totalTrips:weeklyBill.daysWorked) + '</div></div>' +
          (isDriver ? '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Trip Pay</div><div style="font-size:20px;font-weight:900;color:#b45309;">&#8377;' + fmt(weeklyBill.totalTrips * s.ratePerTrip) + '</div></div>' : '') +
          (isDriver ? '<div style="flex:1;background:#ede9fe;border:2px solid #c4b5fd;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Weekly Pay</div><div style="font-size:20px;font-weight:900;color:#6d28d9;">&#8377;1,000</div></div>' : '') +
          '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Gross Pay</div><div style="font-size:20px;font-weight:900;color:#b45309;">&#8377;' + fmt(weeklyBill.grossPay) + '</div></div>' +
          '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Advance</div><div style="font-size:20px;font-weight:900;color:#dc2626;">&#8377;' + fmt(weeklyBill.totalAdvance) + '</div></div>' +
          '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Carried Fwd</div><div style="font-size:20px;font-weight:900;color:#dc2626;">&#8377;' + fmt(weeklyBill.carriedForward||0) + '</div></div>' +
          '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Net Due</div><div style="font-size:20px;font-weight:900;color:#15803d;">&#8377;' + fmt(netDue) + '</div></div>' +
          '</div>' +
          '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">' + (isDriver?'&#128663; Trip Records':'&#128197; Attendance Records') + '</div>' +
          '<table><thead><tr><th>Date</th><th>Vehicle</th><th>' + (isDriver?'Trips':'Status') + '</th><th>Earnings</th></tr></thead>' +
          '<tbody>' + (attendRows || '<tr><td colspan="4" style="color:#94a3b8;text-align:center;font-style:italic;">No records this week</td></tr>') + '</tbody></table>' +
          (weeklyBill.advances.length > 0
              ? '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">&#128176; Advances This Week</div>' +
              '<table><thead><tr><th>Date</th><th>Amount (&#8377;)</th><th>Note</th></tr></thead><tbody>' + advRows + '</tbody></table>'
              : '<div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:20px;">No advances this week</div>') +
          '<div style="background:#0f172a;border-radius:10px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
          '<div style="color:#f1f5f9;font-size:14px;font-weight:700;">' + s.name + ' &mdash; Week Summary</div>' +
          '<div style="display:flex;gap:22px;align-items:center;">' +
          '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#93c5fd;">' + (isDriver?weeklyBill.totalTrips:weeklyBill.daysWorked) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">' + (isDriver?'Trips':'Days') + '</div></div>' +
          '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#fcd34d;">&#8377;' + fmt(weeklyBill.grossPay) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Gross Pay</div></div>' +
          '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#fca5a5;">&#8377;' + fmt(weeklyBill.totalAdvance) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Advance</div></div>' +
          '<div style="text-align:center;"><div style="font-size:22px;font-weight:900;color:#4ade80;">&#8377;' + fmt(netDue) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Net Due</div></div>' +
          '</div></div>' +
          '<div class="sig-row"><div><div class="sig-line">' + s.name + '\'s Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>' +
          '</body></html>';
      const weekStr = fmtDate(weeklyBill.weekStart).replace(/\//g, '-');
      const filename = `Staff_Bill_${s.name}_${weekStr}.pdf`;
      await sharePdfFromHtml(staffHtml, filename);
      toast.dismiss(toastId);
    } catch (err) { toast.dismiss(toastId); toast.error('Failed to share PDF'); console.error(err); }
  };

  const handlePrint = () => {
    if (!weeklyBill) return;
    const s = weeklyBill.staff;
    const isDriver = s.role === 'Driver';
    const CSS = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:30px 36px;color:#111827;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:20px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
      tr:nth-child(even) td{background:#f8fafc;}
      .sig-row{display:flex;justify-content:space-between;margin-top:56px;}
      .sig-line{border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;text-align:center;width:200px;font-weight:500;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:16px 22px;}}
    `;
    const attendRows = (() => {
      const filtered = weeklyBill.attendance.filter(a => a.source !== 'summary-edit');
      if (isDriver) {
        const grouped = [];
        const seen = {};
        filtered.forEach(a => {
          const dk = a.date?.slice(0,10);
          if (seen[dk]) { seen[dk].trips += (a.numberOfTrips||0); }
          else { const g = { date: a.date, vehicle: a.vehicle, trips: a.numberOfTrips||0 }; seen[dk] = g; grouped.push(g); }
        });
        return grouped.map(g => '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(g.date) + '</td>' +
            '<td style="color:#374151;">' + (g.vehicle?.vehicleNumber||'&mdash;') + '</td>' +
            '<td style="color:#1d4ed8;font-weight:700;">' + g.trips + '</td>' +
            '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(g.trips * s.ratePerTrip) + '</td></tr>').join('');
      }
      return filtered.map(a => '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(a.date) + '</td>' +
          '<td style="color:#374151;">' + (a.vehicle?.vehicleNumber||'&mdash;') + '</td>' +
          '<td><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:' + (a.present?'#dcfce7':'#fee2e2') + ';color:' + (a.present?'#15803d':'#dc2626') + ';border:1px solid ' + (a.present?'#86efac':'#fca5a5') + ';">' + (a.present?'Present':'Absent') + '</span></td>' +
          '<td style="color:#b45309;font-weight:700;">&#8377;' + (a.present?fmt(s.dailyRate):'0') + '</td></tr>').join('');
    })();
    const advRows = weeklyBill.advances.length > 0
        ? weeklyBill.advances.map(a =>
            '<tr><td style="color:#475569;">' + fmtDay(a.date) + '</td>' +
            '<td style="color:#dc2626;font-weight:700;">&#8377;' + fmt(a.amount) + '</td>' +
            '<td style="color:#64748b;">' + (a.note||'&mdash;') + '</td></tr>'
        ).join('')
        : '';
    const netDue = weeklyBill.finalNetPay ?? weeklyBill.netPay;
    const staffHtml = '<html><head><title>Staff Bill - ' + s.name + '</title><style>' + CSS + '</style></head><body>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:3px solid #0f172a;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
        '<img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
        '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
        '</div>' +
        '<div style="text-align:right;">' +
        '<div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.9px;margin-bottom:4px;">Weekly ' + s.role + ' Bill</div>' +
        '<div style="font-size:20px;font-weight:900;color:#0f172a;">' + s.name + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:3px;">Week: ' + fmtDate(weeklyBill.weekStart) + ' to ' + fmtDate(weeklyBill.weekEnd) + ' &nbsp;&middot;&nbsp; Rate: ' + (isDriver ? '&#8377;' + fmt(s.ratePerTrip) + '/trip' : '&#8377;' + fmt(s.dailyRate) + '/day') + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;margin-bottom:22px;">' +
        '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">' + (isDriver?'Trips':'Days') + '</div><div style="font-size:20px;font-weight:900;color:#1d4ed8;">' + (isDriver?weeklyBill.totalTrips:weeklyBill.daysWorked) + '</div></div>' +
        (isDriver ? '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Trip Pay</div><div style="font-size:20px;font-weight:900;color:#b45309;">&#8377;' + fmt(weeklyBill.grossPay - (weeklyBill.weeklyAllowance || 1000)) + '</div></div>' : '') +
        (isDriver ? '<div style="flex:1;background:#ede9fe;border:2px solid #c4b5fd;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Weekly Pay</div><div style="font-size:20px;font-weight:900;color:#6d28d9;">&#8377;1,000</div></div>' : '') +
        '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Gross Pay</div><div style="font-size:20px;font-weight:900;color:#b45309;">&#8377;' + fmt(weeklyBill.grossPay) + '</div></div>' +
        '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Advance</div><div style="font-size:20px;font-weight:900;color:#dc2626;">&#8377;' + fmt(weeklyBill.totalAdvance) + '</div></div>' +
        '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Carried Fwd</div><div style="font-size:20px;font-weight:900;color:#dc2626;">&#8377;' + fmt(weeklyBill.carriedForward||0) + '</div></div>' +
        '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Net Due</div><div style="font-size:20px;font-weight:900;color:#15803d;">&#8377;' + fmt(netDue) + '</div></div>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">' + (isDriver?'&#128663; Trip Records':'&#128197; Attendance Records') + '</div>' +
        '<table><thead><tr><th>Date</th><th>Vehicle</th><th>' + (isDriver?'Trips':'Status') + '</th><th>Earnings</th></tr></thead>' +
        '<tbody>' + (attendRows || '<tr><td colspan="4" style="color:#94a3b8;text-align:center;font-style:italic;">No records this week</td></tr>') + '</tbody></table>' +
        (weeklyBill.advances.length > 0
            ? '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">&#128176; Advances This Week</div>' +
            '<table><thead><tr><th>Date</th><th>Amount (&#8377;)</th><th>Note</th></tr></thead><tbody>' + advRows + '</tbody></table>'
            : '<div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:20px;">No advances this week</div>') +
        '<div style="background:#0f172a;border-radius:10px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">' +
        '<div style="color:#f1f5f9;font-size:14px;font-weight:700;">' + s.name + ' &mdash; Week Summary</div>' +
        '<div style="display:flex;gap:22px;align-items:center;">' +
        '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#93c5fd;">' + (isDriver?weeklyBill.totalTrips:weeklyBill.daysWorked) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">' + (isDriver?'Trips':'Days') + '</div></div>' +
        '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#fcd34d;">&#8377;' + fmt(weeklyBill.grossPay) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Gross Pay</div></div>' +
        '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#fca5a5;">&#8377;' + fmt(weeklyBill.totalAdvance) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Advance</div></div>' +
        '<div style="text-align:center;"><div style="font-size:22px;font-weight:900;color:#4ade80;">&#8377;' + fmt(netDue) + '</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;text-transform:uppercase;">Net Due</div></div>' +
        '</div>' +
        '</div>' +
        '<div class="sig-row">' +
        '<div><div class="sig-line">' + s.name + '\'s Signature</div></div>' +
        '<div><div class="sig-line">Authorised Signature</div></div>' +
        '</div>' +
        '</body></html>';

    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(staffHtml); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">👷 Staff</h1>
          <button className="btn btn-primary" onClick={openAdd}>+ Add {role}</button>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card blue">
            <div className="stat-icon">🚗</div>
            <div className="stat-info">
              <div className="stat-value">{staff.filter(s => s.role === 'Driver').length}</div>
              <div className="stat-label">Total Drivers</div>
            </div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-icon">🪑</div>
            <div className="stat-info">
              <div className="stat-value">{staff.filter(s => s.role === 'Conductor').length}</div>
              <div className="stat-label">Total Conductors</div>
            </div>
          </div>
          <div className="stat-card green">
            <div className="stat-icon">💰</div>
            <div className="stat-info">
              <div className="stat-value">₹{fmt(staff.filter(s=>s.role==='Driver').reduce((a,s)=>a+s.ratePerTrip,0))}</div>
              <div className="stat-label">Avg Driver Rate/Trip</div>
            </div>
          </div>
          <div className="stat-card red">
            <div className="stat-icon">📅</div>
            <div className="stat-info">
              <div className="stat-value">₹{fmt(staff.filter(s=>s.role==='Conductor').reduce((a,s)=>a+s.dailyRate,0))}</div>
              <div className="stat-label">Total Daily Conductor Pay</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          <button className={`btn ${tab==='drivers'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('drivers')}>🚗 Drivers</button>
          <button className={`btn ${tab==='conductors'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('conductors')}>🪑 Conductors</button>
          <button className={`btn ${tab==='summary'?'btn-primary':'btn-secondary'}`} onClick={()=>{setTab('summary');loadWeeklySummary(summaryDate);}}>📊 Weekly Summary</button>
        </div>

        {/* Summary Tab */}
        {tab==='summary' && (
            <div>
              <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center'}}>
                <input type="date" value={summaryDate} onChange={e=>{setSummaryDate(e.target.value);loadWeeklySummary(e.target.value);}}
                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={()=>loadWeeklySummary(summaryDate)}>Refresh</button>
                <button className="btn btn-secondary" style={{background:'#422006',border:'1px solid #92400e',color:'#fbbf24'}} onClick={backfillConductors} title="Scan this week's deliveries and create missing conductor attendance records">🔧 Fix Conductor Attendance</button>
                {weeklySummary && <button className="btn btn-secondary" onClick={()=>{
                  const printTime = new Date().toLocaleString('en-IN');
                  const weekLabel = 'Week of ' + new Date(weeklySummary.weekStart).toLocaleDateString('en-IN');
                  const drivers = weeklySummary.summary.filter(s => s.staff.role === 'Driver');
                  const conductors = weeklySummary.summary.filter(s => s.staff.role === 'Conductor');
                  const driverRows = drivers.map((s, i) => {
                    const bg = i % 2 === 1 ? 'background:#f8fafc;' : '';
                    const statusBg = s.paymentStatus==='Paid'?'#dcfce7':s.paymentStatus==='Partial'?'#fef3c7':'#fee2e2';
                    const statusColor = s.paymentStatus==='Paid'?'#15803d':s.paymentStatus==='Partial'?'#b45309':'#dc2626';
                    return '<tr style="' + bg + '">' +
                        '<td style="font-weight:600;color:#0f172a;">' + s.staff.name + '</td>' +
                        '<td style="color:#64748b;">' + (s.staff.phone || '—') + '</td>' +
                        '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.staff.ratePerTrip) + '</td>' +
                        '<td style="color:#1d4ed8;font-weight:700;">' + s.totalTrips + '</td>' +
                        '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.totalTrips * s.staff.ratePerTrip) + '</td>' +
                        '<td style="color:#6d28d9;font-weight:700;">&#8377;1,000</td>' +
                        '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.grossPay) + '</td>' +
                        '<td style="color:#dc2626;">&#8377;' + fmt(s.totalAdvance) + '</td>' +
                        '<td style="font-weight:800;color:' + (s.finalNetPay === 0 ? '#15803d' : '#b45309') + ';">&#8377;' + fmt(s.finalNetPay) + '</td>' +
                        '<td><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';">' + (s.paymentStatus || 'Unpaid') + '</span></td>' +
                        '</tr>';
                  }).join('');
                  const conductorRows = conductors.map((s, i) => {
                    const bg = i % 2 === 1 ? 'background:#f8fafc;' : '';
                    const statusBg = s.paymentStatus==='Paid'?'#dcfce7':s.paymentStatus==='Partial'?'#fef3c7':'#fee2e2';
                    const statusColor = s.paymentStatus==='Paid'?'#15803d':s.paymentStatus==='Partial'?'#b45309':'#dc2626';
                    return '<tr style="' + bg + '">' +
                        '<td style="font-weight:600;color:#0f172a;">' + s.staff.name + '</td>' +
                        '<td style="color:#64748b;">' + (s.staff.phone || '—') + '</td>' +
                        '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.staff.dailyRate) + '/day</td>' +
                        '<td style="color:#1d4ed8;font-weight:700;">' + s.daysWorked + '</td>' +
                        '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.grossPay) + '</td>' +
                        '<td style="color:#dc2626;">&#8377;' + fmt(s.totalAdvance) + '</td>' +
                        '<td style="font-weight:800;color:' + (s.finalNetPay === 0 ? '#15803d' : '#b45309') + ';">&#8377;' + fmt(s.finalNetPay) + '</td>' +
                        '<td><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';">' + (s.paymentStatus || 'Unpaid') + '</span></td>' +
                        '</tr>';
                  }).join('');
                  const dTotalTrips = drivers.reduce((a,s)=>a+s.totalTrips,0);
                  const dTotalTripPay = drivers.reduce((a,s)=>a+(s.totalTrips*s.staff.ratePerTrip),0);
                  const dTotalGross = drivers.reduce((a,s)=>a+s.grossPay,0);
                  const dTotalAdv = drivers.reduce((a,s)=>a+s.totalAdvance,0);
                  const dTotalNet = drivers.reduce((a,s)=>a+s.finalNetPay,0);
                  const cTotalDays = conductors.reduce((a,s)=>a+s.daysWorked,0);
                  const cTotalGross = conductors.reduce((a,s)=>a+s.grossPay,0);
                  const cTotalAdv = conductors.reduce((a,s)=>a+s.totalAdvance,0);
                  const cTotalNet = conductors.reduce((a,s)=>a+s.finalNetPay,0);
                  const CSS = '@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\');' +
                      '*{box-sizing:border-box;margin:0;padding:0;}' +
                      'body{font-family:\'Inter\',\'Segoe UI\',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}' +
                      'table{width:100%;border-collapse:collapse;margin-bottom:24px;}' +
                      'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
                      'td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}' +
                      'tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:12px;}' +
                      'h2{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;}' +
                      '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:16px 22px;}}';
                  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Staff Weekly Summary</title>' +
                      '<style>' + CSS + '</style></head><body>' +
                      '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' + printTime + '</div>' +
                      '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
                      '<div style="display:flex;align-items:center;gap:12px;">' +
                      '<img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
                      '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
                      '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div>' +
                      '</div>' +
                      '<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Staff Weekly Summary</div>' +
                      '<div style="font-size:11px;color:#64748b;margin-top:3px;">' + weekLabel + '</div></div>' +
                      '</div>' +
                      '<div style="display:flex;gap:14px;margin-bottom:24px;">' +
                      '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Drivers</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">' + drivers.length + '</div></div>' +
                      '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Driver Net Due</div><div style="font-size:22px;font-weight:900;color:#b45309;">&#8377;' + fmt(dTotalNet) + '</div></div>' +
                      '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Conductors</div><div style="font-size:22px;font-weight:900;color:#15803d;">' + conductors.length + '</div></div>' +
                      '<div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Conductor Net Due</div><div style="font-size:22px;font-weight:900;color:#c2410c;">&#8377;' + fmt(cTotalNet) + '</div></div>' +
                      '</div>' +
                      '<h2>&#128663; Drivers &mdash; ' + weekLabel + '</h2>' +
                      '<table><thead><tr><th>Driver</th><th>Phone</th><th>Rate/Trip</th><th>Trips</th><th>Trip Pay</th><th>Weekly Pay</th><th>Gross Pay</th><th>Advance</th><th>Net Due</th><th>Status</th></tr></thead>' +
                      '<tbody>' + (driverRows || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8;">No drivers</td></tr>') + '</tbody>' +
                      '<tfoot><tr><td colspan="3">Total</td><td>' + dTotalTrips + '</td><td>&#8377;' + fmt(dTotalTripPay) + '</td><td>&#8377;' + fmt(drivers.length * 1000) + '</td><td>&#8377;' + fmt(dTotalGross) + '</td><td>&#8377;' + fmt(dTotalAdv) + '</td><td>&#8377;' + fmt(dTotalNet) + '</td><td></td></tr></tfoot></table>' +
                      '<h2>&#129681; Conductors &mdash; ' + weekLabel + '</h2>' +
                      '<table><thead><tr><th>Conductor</th><th>Phone</th><th>Daily Rate</th><th>Days Worked</th><th>Gross Pay</th><th>Advance</th><th>Net Due</th><th>Status</th></tr></thead>' +
                      '<tbody>' + (conductorRows || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">No conductors</td></tr>') + '</tbody>' +
                      '<tfoot><tr><td colspan="3">Total</td><td>' + cTotalDays + '</td><td>&#8377;' + fmt(cTotalGross) + '</td><td>&#8377;' + fmt(cTotalAdv) + '</td><td>&#8377;' + fmt(cTotalNet) + '</td><td></td></tr></tfoot></table>' +
                      '<div style="display:flex;justify-content:space-between;margin-top:48px;">' +
                      '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Prepared By</div></div>' +
                      '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
                      '</div></body></html>';
                  let iframe = document.getElementById('__summary_print_iframe__');
                  if (!iframe) {
                    iframe = document.createElement('iframe');
                    iframe.id = '__summary_print_iframe__';
                    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
                    document.body.appendChild(iframe);
                  }
                  const iDoc = iframe.contentWindow.document;
                  iDoc.open(); iDoc.write(html); iDoc.close();
                  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
                }}>🖨️ Print</button>}
              </div>
              {!weeklySummary ? <div className="card" style={{color:'#444',textAlign:'center',padding:32}}>Select date and refresh</div> : (
                  <div ref={summaryRef} style={{display:'flex',flexDirection:'column',gap:20}}>
                    {/* Drivers Summary */}
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:700,color:'#f0f0f0',marginBottom:12,fontFamily:'Syne,sans-serif'}}>
                        🚗 Drivers — Week of {new Date(weeklySummary.weekStart).toLocaleDateString('en-IN')}
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Driver</th><th>Phone</th><th>Rate/Trip</th><th>Total Trips</th><th>Trip Pay</th><th>Weekly Pay</th><th>Gross Pay</th><th>Advance</th><th>Net Due</th><th>Status</th></tr></thead>
                          <tbody>
                          {weeklySummary.summary.filter(s=>s.staff.role==='Driver').length===0 && <tr><td colSpan={10} style={{textAlign:'center',color:'#444',padding:16}}>No drivers</td></tr>}
                          {weeklySummary.summary.filter(s=>s.staff.role==='Driver').map((s,i)=>(
                              <React.Fragment key={i}>
                                <tr style={{cursor:'pointer'}} onClick={()=>setExpandedSummaryStaff(expandedSummaryStaff===s.staff._id?null:s.staff._id)}>
                                  <td style={{fontWeight:600,color:'#f0f0f0'}}>
                                    <span style={{marginRight:6,fontSize:11,color:'#555'}}>{expandedSummaryStaff===s.staff._id?'▼':'▶'}</span>
                                    {s.staff.name}
                                  </td>
                                  <td style={{color:'#888'}}>{s.staff.phone||'—'}</td>
                                  <td style={{color:'#eab308'}}>
                                    <EditableCell value={s.staff.ratePerTrip} color="#eab308"
                                                  onSave={v => api.put(`/staff/${s.staff._id}`, { ratePerTrip: v }).then(() => loadWeeklySummary(summaryDate)).catch(() => toast.error('Failed'))} />
                                  </td>
                                  <td style={{color:'#fff',fontWeight:600}}>
                                    <EditableCell value={s.totalTrips} prefix="" color="#fff"
                                                  onSave={v => saveSummaryOverride(s.staff._id, 'trips', v, weeklySummary.weekStart, weeklySummary.weekEnd)} />
                                  </td>
                                  <td style={{color:'#eab308'}}>₹{fmt(s.totalTrips * s.staff.ratePerTrip)}</td>
                                  <td style={{color:'#a78bfa'}}>₹1,000</td>
                                  <td style={{color:'#eab308'}}>₹{fmt(s.grossPay)}</td>
                                  <td style={{color:'#f87171'}}>₹{fmt(s.totalAdvance)}</td>
                                  <td style={{fontWeight:700,color:s.finalNetPay===0?'#4ade80':'#eab308'}}>₹{fmt(s.finalNetPay)}</td>
                                  <td>
                                    {s.paymentStatus==='Paid'?<span className="badge badge-green">Paid</span>
                                        :s.paymentStatus==='Partial'?<span className="badge badge-yellow">Partial</span>
                                            :<span className="badge badge-red">Unpaid</span>}
                                  </td>
                                </tr>
                                {expandedSummaryStaff===s.staff._id && (
                                    <tr>
                                      <td colSpan={10} style={{padding:0,background:'#0a0a0a',borderBottom:'2px solid #2a2a2a'}}>
                                        <div style={{padding:'12px 24px'}}>
                                          <div style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:8}}>📅 Daily Breakdown</div>
                                          {(() => {
                                            // Group attendance by date
                                            const dayMap = {};
                                            (s.attendance||[]).filter(a=>a.source!=='summary-edit').forEach(a => {
                                              const dk = (a.date||'').slice(0,10);
                                              if (!dayMap[dk]) dayMap[dk] = { date: a.date, trips: 0, vehicles: [] };
                                              dayMap[dk].trips += (a.numberOfTrips||0);
                                              if (a.vehicle?.vehicleNumber) dayMap[dk].vehicles.push(a.vehicle.vehicleNumber);
                                            });
                                            const days = Object.values(dayMap).sort((a,b)=>new Date(a.date)-new Date(b.date));
                                            if (days.length===0) return <div style={{color:'#444',fontSize:12,fontStyle:'italic'}}>No attendance records this week</div>;
                                            return (
                                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                  <thead>
                                                  <tr>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Date</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Vehicle(s)</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Trips</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Earnings</th>
                                                  </tr>
                                                  </thead>
                                                  <tbody>
                                                  {days.map((d,di)=>(
                                                      <tr key={di} style={{borderBottom:'1px solid #141414'}}>
                                                        <td style={{padding:'6px 10px',color:'#aaa'}}>{fmtDay(d.date)}</td>
                                                        <td style={{padding:'6px 10px',color:'#888'}}>{[...new Set(d.vehicles)].join(', ')||'—'}</td>
                                                        <td style={{padding:'6px 10px',color:'#fff',fontWeight:600}}>{d.trips}</td>
                                                        <td style={{padding:'6px 10px',color:'#eab308',fontWeight:600}}>₹{fmt(d.trips*s.staff.ratePerTrip)}</td>
                                                      </tr>
                                                  ))}
                                                  </tbody>
                                                </table>
                                            );
                                          })()}
                                        </div>
                                      </td>
                                    </tr>
                                )}
                              </React.Fragment>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr style={{borderTop:'1px solid #2a2a2a'}}>
                            <td colSpan={3} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Total</td>
                            <td style={{color:'#fff',fontWeight:700,padding:'10px 16px'}}>{weeklySummary.summary.filter(s=>s.staff.role==='Driver').reduce((a,s)=>a+s.totalTrips,0)}</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Driver').reduce((a,s)=>a+(s.totalTrips*s.staff.ratePerTrip),0))}</td>
                            <td style={{color:'#a78bfa',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Driver').length * 1000)}</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Driver').reduce((a,s)=>a+s.grossPay,0))}</td>
                            <td style={{color:'#f87171',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Driver').reduce((a,s)=>a+s.totalAdvance,0))}</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Driver').reduce((a,s)=>a+s.finalNetPay,0))}</td>
                            <td></td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    {/* Conductors Summary */}
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:700,color:'#f0f0f0',marginBottom:12,fontFamily:'Syne,sans-serif'}}>🪑 Conductors — Week of {new Date(weeklySummary.weekStart).toLocaleDateString('en-IN')}</div>
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Conductor</th><th>Phone</th><th>Daily Rate</th><th>Days Worked</th><th>Gross Pay</th><th>Advance</th><th>Net Due</th><th>Status</th></tr></thead>
                          <tbody>
                          {weeklySummary.summary.filter(s=>s.staff.role==='Conductor').length===0 && <tr><td colSpan={8} style={{textAlign:'center',color:'#444',padding:16}}>No conductors</td></tr>}
                          {weeklySummary.summary.filter(s=>s.staff.role==='Conductor').map((s,i)=>(
                              <React.Fragment key={i}>
                                <tr style={{cursor:'pointer'}} onClick={()=>setExpandedSummaryStaff(expandedSummaryStaff===s.staff._id?null:s.staff._id)}>
                                  <td style={{fontWeight:600,color:'#f0f0f0'}}>
                                    <span style={{marginRight:6,fontSize:11,color:'#555'}}>{expandedSummaryStaff===s.staff._id?'▼':'▶'}</span>
                                    {s.staff.name}
                                  </td>
                                  <td style={{color:'#888'}}>{s.staff.phone||'—'}</td>
                                  <td style={{color:'#eab308'}}>
                                    <EditableCell value={s.staff.dailyRate} color="#eab308"
                                                  onSave={v => api.put(`/staff/${s.staff._id}`, { dailyRate: v }).then(() => loadWeeklySummary(summaryDate)).catch(() => toast.error('Failed'))} />
                                    /day
                                  </td>
                                  <td style={{color:'#fff',fontWeight:600}}>
                                    <EditableCell value={s.daysWorked} prefix="" color="#fff"
                                                  onSave={v => saveSummaryOverride(s.staff._id, 'days', v, weeklySummary.weekStart, weeklySummary.weekEnd)} />
                                  </td>
                                  <td style={{color:'#eab308'}}>₹{fmt(s.grossPay)}</td>
                                  <td style={{color:'#f87171'}}>₹{fmt(s.totalAdvance)}</td>
                                  <td style={{fontWeight:700,color:s.finalNetPay===0?'#4ade80':'#eab308'}}>₹{fmt(s.finalNetPay)}</td>
                                  <td>
                                    {s.paymentStatus==='Paid'?<span className="badge badge-green">Paid</span>
                                        :s.paymentStatus==='Partial'?<span className="badge badge-yellow">Partial</span>
                                            :<span className="badge badge-red">Unpaid</span>}
                                  </td>
                                </tr>
                                {expandedSummaryStaff===s.staff._id && (
                                    <tr>
                                      <td colSpan={8} style={{padding:0,background:'#0a0a0a',borderBottom:'2px solid #2a2a2a'}}>
                                        <div style={{padding:'12px 24px'}}>
                                          <div style={{fontSize:11,fontWeight:700,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:8}}>📅 Daily Breakdown</div>
                                          {(() => {
                                            const days = (s.attendance||[]).filter(a=>a.source!=='summary-edit').sort((a,b)=>new Date(a.date)-new Date(b.date));
                                            if (days.length===0) return <div style={{color:'#444',fontSize:12,fontStyle:'italic'}}>No attendance records this week</div>;
                                            return (
                                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                  <thead>
                                                  <tr>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Date</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Vehicle</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Status</th>
                                                    <th style={{textAlign:'left',padding:'6px 10px',color:'#555',fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1e1e1e'}}>Earnings</th>
                                                  </tr>
                                                  </thead>
                                                  <tbody>
                                                  {days.map((a,ai)=>(
                                                      <tr key={ai} style={{borderBottom:'1px solid #141414'}}>
                                                        <td style={{padding:'6px 10px',color:'#aaa'}}>{fmtDay(a.date)}</td>
                                                        <td style={{padding:'6px 10px',color:'#888'}}>{a.vehicle?.vehicleNumber||'—'}</td>
                                                        <td style={{padding:'6px 10px'}}>
                              <span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,
                                background:a.present?'#14532d':'#450a0a',color:a.present?'#4ade80':'#f87171',
                                border:`1px solid ${a.present?'#166534':'#7f1d1d'}`}}>
                                {a.present?'Present':'Absent'}
                              </span>
                                                        </td>
                                                        <td style={{padding:'6px 10px',color:'#eab308',fontWeight:600}}>₹{a.present?fmt(s.staff.dailyRate):'0'}</td>
                                                      </tr>
                                                  ))}
                                                  </tbody>
                                                </table>
                                            );
                                          })()}
                                        </div>
                                      </td>
                                    </tr>
                                )}
                              </React.Fragment>
                          ))}
                          </tbody>
                          <tfoot>
                          <tr style={{borderTop:'1px solid #2a2a2a'}}>
                            <td colSpan={3} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Total</td>
                            <td style={{color:'#fff',fontWeight:700,padding:'10px 16px'}}>{weeklySummary.summary.filter(s=>s.staff.role==='Conductor').reduce((a,s)=>a+s.daysWorked,0)}</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Conductor').reduce((a,s)=>a+s.grossPay,0))}</td>
                            <td style={{color:'#f87171',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Conductor').reduce((a,s)=>a+s.totalAdvance,0))}</td>
                            <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(weeklySummary.summary.filter(s=>s.staff.role==='Conductor').reduce((a,s)=>a+s.finalNetPay,0))}</td>
                            <td></td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>
              )}
            </div>
        )}

        {/* Table */}
        {tab!=='summary' && <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                {tab==='drivers' ? <th>Rate per Trip (₹)</th> : <th>Daily Rate (₹)</th>}
                <th>Actions</th>
              </tr>
              </thead>
              <tbody>
              {staff.length===0 && <tr><td colSpan={4} style={{textAlign:'center',color:'#444',padding:32}}>No {role.toLowerCase()}s found. Add one to get started.</td></tr>}
              {staff.map(s => (
                  <tr key={s._id}>
                    <td style={{fontWeight:600,color:'#f0f0f0'}}>{s.name}</td>
                    <td style={{color:'#888'}}>{s.phone||'—'}</td>
                    <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(tab==='drivers'?s.ratePerTrip:s.dailyRate)}</td>
                    <td>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openAttend(s)}>✅ Mark</button>
                        <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openAdvance(s)}>💰 Advance</button>
                        <button className="btn btn-primary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openBill(s)}>🧾 Bill</button>
                        <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openEdit(s)}>✏️</button>
                        <button className="btn btn-danger" style={{padding:'6px 10px',fontSize:12}} onClick={()=>handleDelete(s._id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>}{/* end tab!==summary */}

        {/* Add/Edit Modal */}
        {(modal==='add'||modal==='edit') && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{modal==='add'?`Add ${role}`:`Edit ${role}`}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Name *</label>
                    <input placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input placeholder="Phone number" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Role</label>
                    <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                      <option value="Driver">Driver</option>
                      <option value="Conductor">Conductor</option>
                    </select>
                  </div>
                  {form.role==='Driver' ? (
                      <div className="form-group">
                        <label>Rate per Trip (₹)</label>
                        <input type="number" placeholder="0" value={form.ratePerTrip} onChange={e=>setForm({...form,ratePerTrip:e.target.value})}/>
                      </div>
                  ) : (
                      <div className="form-group">
                        <label>Daily Rate (₹)</label>
                        <input type="number" placeholder="0" value={form.dailyRate} onChange={e=>setForm({...form,dailyRate:e.target.value})}/>
                      </div>
                  )}
                  <div className="form-group" style={{gridColumn:'1 / -1'}}>
                    <label>Note</label>
                    <input placeholder="Optional note" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Mark Attendance Modal */}
        {modal==='attend' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{selected?.role==='Driver'?'Mark Trips':'Mark Attendance'} — {selected?.name}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>
                <div className="modal-stock-info">
                  {selected?.role==='Driver' ? (
                      <>
                        Rate: <strong style={{color:'#eab308'}}>₹{fmt(selected?.ratePerTrip)} per trip</strong>
                        {weeklyBill && (() => {
                          const todayTrips = weeklyBill.attendance.filter(a => new Date(a.date).toISOString().slice(0,10) === attendForm.date && a.source !== 'summary-edit').reduce((s,a) => s + (a.numberOfTrips||0), 0);
                          return todayTrips > 0 ? <span style={{marginLeft:12,color:'#94a3b8',fontSize:12}}>({todayTrips} trip{todayTrips>1?'s':''} logged today)</span> : null;
                        })()}
                      </>
                  ) : <>Daily Rate: <strong style={{color:'#eab308'}}>₹{fmt(selected?.dailyRate)} per day</strong></>}
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={attendForm.date} onChange={e=>setAttendForm({...attendForm,date:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Vehicle</label>
                    <select value={attendForm.vehicleId} onChange={e=>setAttendForm({...attendForm,vehicleId:e.target.value})}>
                      <option value="">Select vehicle...</option>
                      {vehicles.map(v=><option key={v._id} value={v._id}>{v.vehicleNumber} — {v.vehicleType}</option>)}
                    </select>
                  </div>
                  {selected?.role==='Driver' ? (
                      <div className="form-group">
                        <label>Number of Trips</label>
                        <input type="number" min="1" placeholder="0" value={attendForm.numberOfTrips} onChange={e=>setAttendForm({...attendForm,numberOfTrips:e.target.value})}/>
                      </div>
                  ) : (
                      <div className="form-group">
                        <label>Present</label>
                        <select value={attendForm.present} onChange={e=>setAttendForm({...attendForm,present:e.target.value==='true'})}>
                          <option value="true">Present</option>
                          <option value="false">Absent</option>
                        </select>
                      </div>
                  )}
                  <div className="form-group">
                    <label>Note</label>
                    <input placeholder="Optional" value={attendForm.note} onChange={e=>setAttendForm({...attendForm,note:e.target.value})}/>
                  </div>
                </div>
                {selected?.role==='Driver' && attendForm.numberOfTrips && (
                    <div className="modal-total">
                      {attendForm.numberOfTrips} trips × ₹{fmt(selected?.ratePerTrip)} = ₹{fmt(Number(attendForm.numberOfTrips)*selected?.ratePerTrip)}
                    </div>
                )}
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>{selected?.role==='Driver'?'Done':'Cancel'}</button>
                  <button className="btn btn-primary" onClick={handleAttend} disabled={saving}>{saving?'Saving...':selected?.role==='Driver'?'Add Trip':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Add Advance Modal */}
        {modal==='advance' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Add Advance — {selected?.name}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>
                <div className="modal-stock-info">
                  Advance will be deducted from the weekly bill automatically
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Amount (₹) *</label>
                    <input type="number" placeholder="0" value={advanceForm.amount} onChange={e=>setAdvanceForm({...advanceForm,amount:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={advanceForm.date} onChange={e=>setAdvanceForm({...advanceForm,date:e.target.value})}/>
                  </div>
                  <div className="form-group" style={{gridColumn:'1 / -1'}}>
                    <label>Note</label>
                    <input placeholder="e.g. Start of week advance" value={advanceForm.note} onChange={e=>setAdvanceForm({...advanceForm,note:e.target.value})}/>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleAdvance} disabled={saving}>{saving?'Saving...':'Add Advance'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Weekly Bill Modal */}
        {modal==='bill' && (
            <div className="modal-overlay" onClick={()=>{ if(!isPrinting.current) setModal(null); }}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Weekly Bill — {selected?.name}</h3>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input type="date" value={billDate}
                           onChange={e=>{setBillDate(e.target.value);loadBill(selected._id,e.target.value);}}
                           style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'6px 10px',color:'#e0e0e0',fontSize:13}}/>
                    <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={e=>{e.stopPropagation();handlePrint();}}>🖨️ Print</button>
                    <button onClick={e=>{e.stopPropagation();handleWhatsApp();}} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </button>
                    <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                  </div>
                </div>

                {!weeklyBill ? (
                    <div style={{textAlign:'center',padding:32,color:'#444'}}>Loading...</div>
                ) : (
                    <div ref={printRef}>
                      {/* Bill header */}
                      <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:12,marginBottom:16}}>
                        <div style={{fontSize:18,fontWeight:700,color:'#f0f0f0',fontFamily:'Syne,sans-serif'}}>
                          Weekly {weeklyBill.staff.role} Bill
                        </div>
                        <div style={{fontSize:13,color:'#888',marginTop:4}}>
                          Name: <strong style={{color:'#eab308'}}>{weeklyBill.staff.name}</strong>
                          &nbsp;·&nbsp; Week: {fmtDate(weeklyBill.weekStart)} to {fmtDate(weeklyBill.weekEnd)}
                          {weeklyBill.staff.role==='Driver'
                              ? <>&nbsp;·&nbsp; Rate: <strong style={{color:'#fff'}}>₹{fmt(weeklyBill.staff.ratePerTrip)}/trip</strong></>
                              : <>&nbsp;·&nbsp; Daily Rate: <strong style={{color:'#fff'}}>₹{fmt(weeklyBill.staff.dailyRate)}/day</strong></>}
                        </div>
                      </div>

                      {/* Attendance table */}
                      <div style={{marginBottom:20}}>
                        <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8}}>
                          {weeklyBill.staff.role==='Driver' ? '🚗 Trip Records' : '📅 Attendance Records'}
                        </div>
                        {weeklyBill.attendance.length===0 ? (
                            <div style={{color:'#444',fontStyle:'italic',fontSize:13}}>No records this week</div>
                        ) : (
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead>
                              <tr>
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Date</th>
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Vehicle</th>
                                {weeklyBill.staff.role==='Driver'
                                    ? <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Trips</th>
                                    : <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Status</th>}
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Earnings</th>
                                <th style={{padding:'8px 12px',borderBottom:'1px solid #1e1e1e'}}></th>
                              </tr>
                              </thead>
                              <tbody>
                              {weeklyBill.staff.role==='Driver' ? (
                                  // Group by date for drivers — sum trips across multiple records per day
                                  (() => {
                                    const filtered = weeklyBill.attendance.filter(a => a.note !== 'Summary override' && a.numberOfTrips >= 0);
                                    const grouped = [];
                                    const seen = {};
                                    filtered.forEach(a => {
                                      const dateKey = new Date(a.date).toISOString().slice(0,10);
                                      if (seen[dateKey]) {
                                        seen[dateKey].totalTrips += (a.numberOfTrips||0);
                                        seen[dateKey].ids.push(a._id);
                                      } else {
                                        const g = { date: a.date, dateKey, vehicle: a.vehicle, totalTrips: a.numberOfTrips||0, ids: [a._id], primaryId: a._id };
                                        seen[dateKey] = g;
                                        grouped.push(g);
                                      }
                                    });
                                    return grouped.map(g => (
                                        <tr key={g.primaryId}>
                                          <td style={{padding:'10px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{fmtDay(g.date)}</td>
                                          <td style={{padding:'10px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{g.vehicle?.vehicleNumber||'—'}</td>
                                          <td style={{padding:'10px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>
                                            {g.totalTrips}
                                            {g.ids.length > 1 && <span style={{fontSize:10,color:'#64748b',marginLeft:4}}>({g.ids.length} entries)</span>}
                                          </td>
                                          <td style={{padding:'10px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>
                                            ₹{fmt(g.totalTrips * weeklyBill.staff.ratePerTrip)}
                                          </td>
                                          <td style={{padding:'10px 12px',borderBottom:'1px solid #161616'}}>
                                            {g.ids.map(id => (
                                                <button key={id} className="btn btn-danger" style={{padding:'3px 7px',fontSize:11,marginRight:2}} onClick={()=>handleDeleteAttend(id)}>🗑</button>
                                            ))}
                                          </td>
                                        </tr>
                                    ));
                                  })()
                              ) : (
                                  weeklyBill.attendance.filter(a => a.note !== 'Summary override' && (a.numberOfTrips == null || a.numberOfTrips >= 0)).map(a=>(
                                      <tr key={a._id}>
                                        <td style={{padding:'10px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{fmtDay(a.date)}</td>
                                        <td style={{padding:'10px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{a.vehicle?.vehicleNumber||'—'}</td>
                                        <td style={{padding:'10px 12px',borderBottom:'1px solid #161616'}}><span className={`badge ${a.present?'badge-green':'badge-red'}`}>{a.present?'Present':'Absent'}</span></td>
                                        <td style={{padding:'10px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>
                                          ₹{a.present?fmt(weeklyBill.staff.dailyRate):'0'}
                                        </td>
                                        <td style={{padding:'10px 12px',borderBottom:'1px solid #161616'}}>
                                          <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeleteAttend(a._id)}>🗑</button>
                                        </td>
                                      </tr>
                                  ))
                              )}
                              </tbody>
                            </table>
                        )}
                      </div>

                      {/* Advances */}
                      <div style={{marginBottom:20}}>
                        <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span>💰 Advances This Week</span>
                          <button className="btn btn-secondary" style={{padding:'4px 8px',fontSize:11}} onClick={()=>{setModal('advance');}}>+ Add</button>
                        </div>
                        {weeklyBill.advances.length===0 ? (
                            <div style={{color:'#444',fontStyle:'italic',fontSize:13}}>No advances this week</div>
                        ) : (
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead>
                              <tr>
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Date</th>
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Amount</th>
                                <th style={{textAlign:'left',padding:'8px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',fontSize:11,textTransform:'uppercase'}}>Note</th>
                                <th style={{padding:'8px 12px',borderBottom:'1px solid #1e1e1e'}}></th>
                              </tr>
                              </thead>
                              <tbody>
                              {weeklyBill.advances.map(a=>(
                                  <tr key={a._id}>
                                    <td style={{padding:'10px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{fmtDay(a.date)}</td>
                                    <td style={{padding:'10px 12px',color:'#f87171',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(a.amount)}</td>
                                    <td style={{padding:'10px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{a.note||'—'}</td>
                                    <td style={{padding:'10px 12px',borderBottom:'1px solid #161616'}}>
                                      <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeleteAdvance(a._id)}>🗑</button>
                                    </td>
                                  </tr>
                              ))}
                              </tbody>
                            </table>
                        )}
                      </div>

                      {/* Summary box */}
                      <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:10,padding:20}}>
                        <div style={{display:'grid',gridTemplateColumns:weeklyBill.staff.role==='Driver'?'repeat(6,1fr)':'repeat(5,1fr)',gap:12}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>
                              {weeklyBill.staff.role==='Driver'?'Trips':'Days'}
                            </div>
                            <div style={{fontSize:20,fontWeight:700,color:'#fff',fontFamily:'Syne,sans-serif'}}>
                              {weeklyBill.staff.role==='Driver'?weeklyBill.totalTrips:weeklyBill.daysWorked}
                            </div>
                          </div>
                          {weeklyBill.staff.role==='Driver' && (
                              <div style={{textAlign:'center'}}>
                                <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Trip Pay</div>
                                <div style={{fontSize:20,fontWeight:700,color:'#eab308',fontFamily:'Syne,sans-serif'}}>₹{fmt(weeklyBill.grossPay - (weeklyBill.weeklyAllowance || 1000))}</div>
                              </div>
                          )}
                          {weeklyBill.staff.role==='Driver' && (
                              <div style={{textAlign:'center'}}>
                                <div style={{fontSize:10,color:'#a78bfa',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Weekly Pay</div>
                                <div style={{fontSize:20,fontWeight:700,color:'#a78bfa',fontFamily:'Syne,sans-serif'}}>₹1,000</div>
                              </div>
                          )}
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Gross Pay</div>
                            <div style={{fontSize:20,fontWeight:700,color:'#eab308',fontFamily:'Syne,sans-serif'}}>₹{fmt(weeklyBill.grossPay)}</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Advance</div>
                            <div style={{fontSize:20,fontWeight:700,color:'#f87171',fontFamily:'Syne,sans-serif'}}>₹{fmt(weeklyBill.totalAdvance)}</div>
                          </div>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:10,color:'#f87171',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Carried Fwd</div>
                            <div style={{fontSize:20,fontWeight:700,color:'#f87171',fontFamily:'Syne,sans-serif'}}>₹{fmt(weeklyBill.carriedForward||0)}</div>
                          </div>
                          <div style={{textAlign:'center',background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'8px 4px'}}>
                            <div style={{fontSize:10,color:'#4ade80',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Net Due</div>
                            <div style={{fontSize:22,fontWeight:700,fontFamily:'Syne,sans-serif',
                              color:(weeklyBill.finalNetPay??weeklyBill.netPay)===0?'#4ade80':'#eab308'}}>
                              ₹{fmt(weeklyBill.finalNetPay??weeklyBill.netPay)}
                            </div>
                            {weeklyBill.paymentRecord?.isPaid && <div style={{fontSize:10,color:'#4ade80'}}>✅ Paid</div>}
                            {weeklyBill.paymentRecord?.isPartial && <div style={{fontSize:10,color:'#eab308'}}>⚠️ Partial</div>}
                          </div>
                        </div>
                      </div>

                      {/* Payment Status */}
                      <div style={{marginTop:16,background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:10,padding:16}}>
                        <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:12}}>💳 Payment Status</div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <input type="checkbox" id="isPaid" checked={payForm.isPaid}
                                   onChange={e=>setPayForm({...payForm,isPaid:e.target.checked,isPartial:false})}
                                   style={{width:16,height:16,cursor:'pointer'}}/>
                            <label htmlFor="isPaid" style={{fontSize:13,color:'#ccc',cursor:'pointer'}}>Mark as Fully Paid</label>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <input type="checkbox" id="isPartial" checked={payForm.isPartial}
                                   onChange={e=>setPayForm({...payForm,isPartial:e.target.checked,isPaid:false})}
                                   style={{width:16,height:16,cursor:'pointer'}}/>
                            <label htmlFor="isPartial" style={{fontSize:13,color:'#ccc',cursor:'pointer'}}>Partial Payment</label>
                          </div>
                        </div>
                        {payForm.isPartial && (
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                              <div className="form-group" style={{marginBottom:0}}>
                                <label>Amount Paid (₹)</label>
                                <input type="number" placeholder="0" value={payForm.amountPaid}
                                       onChange={e=>setPayForm({...payForm,amountPaid:e.target.value})}/>
                              </div>
                              <div className="form-group" style={{marginBottom:0}}>
                                <label>Note</label>
                                <input placeholder="e.g. Half payment" value={payForm.note}
                                       onChange={e=>setPayForm({...payForm,note:e.target.value})}/>
                              </div>
                            </div>
                        )}
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                          <div style={{fontSize:12,color:'#555'}}>
                            {paymentStatus
                                ? paymentStatus.isPaid
                                    ? <span style={{color:'#4ade80'}}>✅ Paid ₹{fmt(paymentStatus.amountPaid)}</span>
                                    : paymentStatus.isPartial
                                        ? <span style={{color:'#eab308'}}>⚠️ Partial: ₹{fmt(paymentStatus.amountPaid)} paid, ₹{fmt(weeklyBill.netPay - paymentStatus.amountPaid)} remaining</span>
                                        : <span style={{color:'#f87171'}}>❌ Unpaid</span>
                                : <span style={{color:'#f87171'}}>❌ Not marked yet</span>}
                          </div>
                          <button className="btn btn-primary" style={{padding:'8px 16px',fontSize:13}} onClick={handleMarkPayment}>
                            Save Payment Status
                          </button>
                        </div>
                      </div>

                      {/* Signature */}
                      <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16}}>
                        <div style={{textAlign:'center',width:180}}>
                          <div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>
                            {weeklyBill.staff.name}'s Signature
                          </div>
                        </div>
                        <div style={{textAlign:'center',width:180}}>
                          <div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Authorised Signature</div>
                        </div>
                      </div>
                    </div>
                )}
              </div>
            </div>
        )}
      </div>
  );
}