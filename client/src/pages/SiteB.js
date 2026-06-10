import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { printSection } from '../utils/printHelper';
import toast from 'react-hot-toast';
import { generateBillHTML } from '../utils/generateBillHTML';
const logo = require('../assets/logo.jpg');
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
const fmt     = (n) => Number(n||0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
const fmtDay  = (d) => new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'2-digit'});

// ── Empty shapes ──────────────────────────────────────────────────────────────
const emptySite = {
  ownerName:'', ownerPhone:'', rateForOwner:'',
  customerName:'', customerPhone:'', rateForCustomer:'',
  deliveryAddress:'', vehicleType:'Both',
  royaltyRate:'', brassPerTrip:'', note:'',
};

const emptyVehicleRow = () => ({
  vehicleId:'', manualVehicleNumber:'', vehicleType:'Own',
  driverId:'', conductorId:'',
  numberOfTrips:'', brassPerTrip:'',
  _key: Math.random(),
});

const emptyOrderForm = () => ({
  date: new Date().toISOString().slice(0,10),
  vehicles: [emptyVehicleRow()],
  royaltyCount:'', royaltyRate:'',
  note:'',
});

// ── PaySection — defined OUTSIDE SiteBPage so React never remounts it on parent re-render ──
function PaySection({ label, total, carryForward=0, payRec, payForm, setPayForm, savingPay, onSave }) {
  const grandTotal = total + (carryForward||0);
  const balance    = grandTotal - (payRec?.amountPaid||0);
  return (
      <div style={{ background:'#0e0e0e', border:'1px solid #2a2a2a', borderRadius:10, padding:16, marginTop:12 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#ccc', marginBottom:10 }}>💳 {label} Payment</div>

        {carryForward > 0 && (
            <div style={{ background:'#1c1400', border:'1px solid #3a2800', borderRadius:6, padding:'7px 12px', marginBottom:8, fontSize:12, color:'#f59e0b', display:'flex', justifyContent:'space-between' }}>
              <span>📌 Previous week balance (carry forward)</span>
              <strong>+ ₹{fmt(carryForward)}</strong>
            </div>
        )}

        {carryForward > 0 && (
            <div style={{ fontSize:12, color:'#555', marginBottom:8, display:'flex', gap:14 }}>
              <span>This week: ₹{fmt(total)}</span>
              <span>+</span>
              <span>Carry: ₹{fmt(carryForward)}</span>
              <span>=</span>
              <span style={{color:'#ccc',fontWeight:600}}>Total due: ₹{fmt(grandTotal)}</span>
            </div>
        )}

        <div style={{ background:'#141414', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:13 }}>
          {payRec?.isPaid
              ? <span style={{color:'#4ade80'}}>✅ Fully Paid ₹{fmt(payRec.amountPaid)}</span>
              : payRec?.isPartial
                  ? <span style={{color:'#eab308'}}>⚡ Partial ₹{fmt(payRec.amountPaid)} — ₹{fmt(balance)} remaining</span>
                  : <span style={{color:'#f87171'}}>❌ Not paid — ₹{fmt(grandTotal)} due</span>}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:10 }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#ccc', cursor:'pointer' }}>
            <input type="checkbox" checked={payForm.isPaid}
                   onChange={e=>setPayForm({...payForm,isPaid:e.target.checked,isPartial:false,amountPaid:''})}
                   style={{width:16,height:16}}/> Fully Paid
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#ccc', cursor:'pointer' }}>
            <input type="checkbox" checked={payForm.isPartial}
                   onChange={e=>setPayForm({...payForm,isPartial:e.target.checked,isPaid:false})}
                   style={{width:16,height:16}}/> Partial Payment
          </label>
        </div>
        {(payForm.isPaid || payForm.isPartial) && (
            <div className="form-group" style={{marginBottom:10}}>
              <label style={{fontSize:12,color:'#888'}}>Payment Date</label>
              <input type="date" value={payForm.paidDate||''}
                     onChange={e=>setPayForm({...payForm,paidDate:e.target.value})}
                     style={{width:'100%'}}/>
            </div>
        )}
        {payForm.isPartial && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:10 }}>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Amount (₹) <span style={{color:'#555',fontWeight:400}}>max ₹{fmt(grandTotal)}</span></label>
                <input type="number" placeholder="0" value={payForm.amountPaid}
                       onChange={e=>setPayForm({...payForm,amountPaid:e.target.value})}/>
                {payForm.amountPaid>0 && <div style={{fontSize:12,color:'#eab308',marginTop:4}}>Remaining: ₹{fmt(grandTotal-(Number(payForm.amountPaid)||0))}</div>}
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Note</label>
                <input placeholder="Optional" value={payForm.note} onChange={e=>setPayForm({...payForm,note:e.target.value})}/>
              </div>
            </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button className="btn btn-primary" style={{padding:'8px 20px'}} onClick={onSave} disabled={savingPay}>
            {savingPay ? 'Saving...' : 'Save Payment'}
          </button>
        </div>
      </div>
  );
}

export default function SiteBPage() {
  const [sites,       setSites]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('list');
  const [modal,       setModal]       = useState(null);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState(emptySite);
  const [orderForm,   setOrderForm]   = useState(emptyOrderForm());
  const [formData,    setFormData]    = useState({ vehicles:[], drivers:[], conductors:[] });
  const [saving,      setSaving]      = useState(false);
  const [billDate,    setBillDate]    = useState(new Date().toISOString().slice(0,10));
  const [weeklyBill,  setWeeklyBill]  = useState(null);
  const [summary,     setSummary]     = useState(null);

  // Payment states — owner
  const [ownerPayRec,    setOwnerPayRec]    = useState(null);
  const [ownerPayForm,   setOwnerPayForm]   = useState({ isPaid:false, isPartial:false, amountPaid:'', note:'', paidDate:new Date().toISOString().slice(0,10) });
  const [savingOwnerPay, setSavingOwnerPay] = useState(false);
  // Payment states — customer
  const [custPayRec,     setCustPayRec]     = useState(null);
  const [custPayForm,    setCustPayForm]    = useState({ isPaid:false, isPartial:false, amountPaid:'', note:'', paidDate:new Date().toISOString().slice(0,10) });
  const [savingCustPay,  setSavingCustPay]  = useState(false);

  const summaryRef = useRef();

  // ── Loaders ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try { const { data } = await api.get('/siteb'); setSites(data); }
    catch { toast.error('Failed to load sites'); }
    finally { setLoading(false); }
  }, []);

  const loadFormData = useCallback(async () => {
    try { const { data } = await api.get('/siteb/form-data'); setFormData(data); }
    catch {}
  }, []);

  useEffect(() => { load(); loadFormData(); }, [load, loadFormData]);

  const loadWeeklyBill = async (site, date) => {
    try {
      const { data } = await api.get(`/siteb/${site._id}/weekly?date=${date}`);
      setWeeklyBill(data);
      setOwnerPayRec(data.ownerPay);
      setCustPayRec(data.customerPay);
      if (data.ownerPay)
        setOwnerPayForm({ isPaid:data.ownerPay.isPaid, isPartial:data.ownerPay.isPartial, amountPaid:data.ownerPay.amountPaid||'', note:data.ownerPay.note||'', paidDate:data.ownerPay.paidDate?new Date(data.ownerPay.paidDate).toISOString().slice(0,10):new Date().toISOString().slice(0,10) });
      else
        setOwnerPayForm({ isPaid:false, isPartial:false, amountPaid:'', note:'', paidDate:new Date().toISOString().slice(0,10) });
      if (data.customerPay)
        setCustPayForm({ isPaid:data.customerPay.isPaid, isPartial:data.customerPay.isPartial, amountPaid:data.customerPay.amountPaid||'', note:data.customerPay.note||'', paidDate:data.customerPay.paidDate?new Date(data.customerPay.paidDate).toISOString().slice(0,10):new Date().toISOString().slice(0,10) });
      else
        setCustPayForm({ isPaid:false, isPartial:false, amountPaid:'', note:'', paidDate:new Date().toISOString().slice(0,10) });
    } catch { toast.error('Failed to load weekly bill'); }
  };

  const loadSummary = async (date) => {
    try { const { data } = await api.get(`/siteb/summary/weekly?date=${date}`); setSummary(data); }
    catch { toast.error('Failed to load summary'); }
  };

  // ── Modal openers ─────────────────────────────────────────────────────────
  const openAdd   = () => { setForm(emptySite); setModal('add'); };
  const openEdit  = (s) => {
    setSelected(s);
    setForm({
      ownerName:s.ownerName, ownerPhone:s.ownerPhone||'', rateForOwner:s.rateForOwner,
      customerName:s.customerName, customerPhone:s.customerPhone||'', rateForCustomer:s.rateForCustomer,
      deliveryAddress:s.deliveryAddress, vehicleType:s.vehicleType||'Both',
      royaltyRate:s.royaltyRate||'', brassPerTrip:s.brassPerTrip||'',
      note:s.note||'',
    });
    setModal('edit');
  };
  const openOrder = (s) => { setSelected(s); setOrderForm(emptyOrderForm()); setModal('order'); };
  const openBill  = (s) => { setSelected(s); setWeeklyBill(null); setModal('bill'); loadWeeklyBill(s, billDate); };

  // ── Vehicle row helpers ───────────────────────────────────────────────────
  const updateVehicleRow = (idx, patch) => {
    setOrderForm(prev => {
      const rows = [...prev.vehicles];
      rows[idx] = { ...rows[idx], ...patch };
      return { ...prev, vehicles: rows };
    });
  };
  const addVehicleRow    = () => setOrderForm(prev => ({ ...prev, vehicles:[...prev.vehicles, emptyVehicleRow()] }));
  const removeVehicleRow = (idx) => {
    if (orderForm.vehicles.length === 1) return;
    setOrderForm(prev => ({ ...prev, vehicles: prev.vehicles.filter((_,i)=>i!==idx) }));
  };

  // ── Save site ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.ownerName || !form.customerName || !form.deliveryAddress)
      return toast.error('Owner name, customer name & delivery address required');
    setSaving(true);
    try {
      if (modal==='add') { await api.post('/siteb', form); toast.success('Site B added'); }
      else { await api.put(`/siteb/${selected._id}`, form); toast.success('Updated'); }
      setModal(null); load();
    } catch(e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this site?')) return;
    try { await api.delete(`/siteb/${id}`); toast.success('Removed'); load(); }
    catch { toast.error('Error'); }
  };

  // ── Save order ────────────────────────────────────────────────────────────
  const handleOrder = async () => {
    const hasTrips = orderForm.vehicles.some(v => Number(v.numberOfTrips) > 0);
    if (!hasTrips) return toast.error('Enter at least one trip in any vehicle row');
    setSaving(true);
    try {
      const vehicleRows = orderForm.vehicles
          .filter(v => Number(v.numberOfTrips) > 0)
          .map(v => ({
            vehicleId:     v.vehicleId    || undefined,
            vehicleNumber: v.vehicleId    ? '' : v.manualVehicleNumber,
            vehicleType:   v.vehicleId
                ? (formData.vehicles.find(fv=>fv._id===v.vehicleId)?.ownershipType==='Rental' ? 'Rental' : 'Own')
                : 'Own',
            driverId:      v.driverId    || undefined,
            conductorId:   v.conductorId || undefined,
            numberOfTrips: Number(v.numberOfTrips) || 0,
            brassPerTrip:  v.brassPerTrip !== '' ? Number(v.brassPerTrip) : Number(selected?.brassPerTrip) || 0,
          }));

      await api.post(`/siteb/${selected._id}/orders`, {
        date:         orderForm.date,
        note:         orderForm.note,
        vehicles:     vehicleRows,
        royaltyCount: Number(orderForm.royaltyCount) || 0,
        royaltyRate:  orderForm.royaltyRate !== ''
            ? Number(orderForm.royaltyRate)
            : Number(selected?.royaltyRate) || 0,
      });
      toast.success('Trip order added ✅');
      setModal(null);
    } catch(e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  // ── Live order preview ────────────────────────────────────────────────────
  const orderPreview = (() => {
    if (!selected) return null;
    let totalTrips=0, totalBrass=0, ownerAmt=0, customerAmt=0;
    orderForm.vehicles.forEach(v => {
      const trips = Number(v.numberOfTrips) || 0;
      const bpt   = v.brassPerTrip !== '' ? Number(v.brassPerTrip) : Number(selected.brassPerTrip) || 0;
      totalTrips  += trips;
      totalBrass  += trips * bpt;
      ownerAmt    += trips * (selected.rateForOwner    || 0);
      customerAmt += trips * (selected.rateForCustomer || 0);
    });
    const royRate = orderForm.royaltyRate !== '' ? Number(orderForm.royaltyRate) : Number(selected.royaltyRate) || 0;
    const royAmt  = (Number(orderForm.royaltyCount)||0) * royRate;
    return { totalTrips, totalBrass, ownerAmt, customerAmt: customerAmt + royAmt, royAmt };
  })();

  // ── Save payment ──────────────────────────────────────────────────────────
  const savePayment = async (payFor, currentBill, carryFwd, payForm, setSavingFn, setRecFn, setFormFn) => {
    const grandTotal = currentBill + (carryFwd||0);
    if (payForm.isPartial) {
      const amt = Number(payForm.amountPaid)||0;
      if (amt <= 0)        return toast.error('Enter valid amount');
      if (amt > grandTotal) return toast.error(`Cannot exceed ₹${fmt(grandTotal)}`);
    }
    setSavingFn(true);
    try {
      const paidAmt = payForm.isPaid
          ? grandTotal
          : (payForm.isPartial ? Math.min(Number(payForm.amountPaid)||0, grandTotal) : 0);
      const { data } = await api.post(`/siteb/${selected._id}/payment`, {
        weekStart:  new Date(weeklyBill.weekStart).toISOString(),
        paymentFor: payFor,
        amountPaid: paidAmt,
        note:       payForm.note,
        paidDate:   payForm.paidDate || new Date().toISOString().slice(0,10),
      });
      setRecFn(data);
      setFormFn({ isPaid:false, isPartial:false, amountPaid:'', note:'', paidDate:new Date().toISOString().slice(0,10) });
      // Refresh bill so carry-forward updates
      await loadWeeklyBill(selected, billDate);
      toast.success(payForm.isPaid ? '✅ Fully paid' : `⚡ Partial ₹${fmt(paidAmt)} recorded`);
    } catch { toast.error('Error saving payment'); }
    finally { setSavingFn(false); }
  };

  // ── Delete single order ───────────────────────────────────────────────────
  const deleteOrder = async (orderId) => {
    if (!window.confirm('Delete this trip entry?')) return;
    try {
      await api.delete(`/siteb/${selected._id}/orders/${orderId}`);
      toast.success('Deleted');
      loadWeeklyBill(selected, billDate);
    } catch { toast.error('Error deleting'); }
  };

  // ── Print weekly summary (Image-2 style) ─────────────────────────────────
  const printWeeklySummary = () => {
    if (!summary) return;
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const periodLabel = `${fmtDate(summary.weekStart)} to ${fmtDate(summary.weekEnd)}`;

    const rows = summary.summary.map((s, i) => {
      const ownerPaidLabel   = s.ownerPay?.isPaid   ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;border:1.5px solid #86efac;border-radius:6px;padding:3px 10px;color:#15803d;font-weight:700;font-size:11px;">&#10003; Paid</span>'
          : s.ownerPay?.isPartial ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:6px;padding:3px 10px;color:#b45309;font-weight:700;font-size:11px;">~ Partial</span>'
              : '<span style="display:inline-flex;align-items:center;gap:4px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:6px;padding:3px 10px;color:#dc2626;font-weight:700;font-size:11px;">&#10005; Unpaid</span>';
      const custPaidLabel    = s.customerPay?.isPaid   ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;border:1.5px solid #86efac;border-radius:6px;padding:3px 10px;color:#15803d;font-weight:700;font-size:11px;">&#10003; Paid</span>'
          : s.customerPay?.isPartial ? '<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:6px;padding:3px 10px;color:#b45309;font-weight:700;font-size:11px;">~ Partial</span>'
              : '<span style="display:inline-flex;align-items:center;gap:4px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:6px;padding:3px 10px;color:#dc2626;font-weight:700;font-size:11px;">&#10005; Unpaid</span>';
      const bg = i%2===1 ? 'background:#f8fafc;' : '';
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${s.site.ownerName}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;">${s.site.customerName}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;">${s.site.deliveryAddress||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${s.totalTrips}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#7c3aed;">${s.totalBrass||0}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#c2410c;">${s.totalRoyaltyCount||0}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#b45309;">&#8377;${fmt(s.totalAmountOwner)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d;">&#8377;${fmt(s.totalAmountCustomer)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${ownerPaidLabel}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${custPaidLabel}</td>
      </tr>`;
    }).join('');

    const totTrips   = summary.summary.reduce((s,r)=>s+r.totalTrips,0);
    const totBrass   = summary.summary.reduce((s,r)=>s+(r.totalBrass||0),0);
    const totRoyalty = summary.summary.reduce((s,r)=>s+(r.totalRoyaltyCount||0),0);
    const totOwner   = summary.summary.reduce((s,r)=>s+r.totalAmountOwner,0);
    const totCust    = summary.summary.reduce((s,r)=>s+r.totalAmountCustomer,0);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Site B Weekly Summary</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.c{text-align:center;} th.r{text-align:right;}
      td{padding:9px 12px;font-size:12px;color:#374151;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;border:none;}
      tfoot{display:table-row-group!important;}
      @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>

    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>

    <!-- HEADER -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
        <div>
          <div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">Mr. Chand Laluwale &nbsp;|&nbsp; Mr. Roshan Laluwale</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Site B Weekly Summary</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">Week: ${periodLabel}</div>
      </div>
    </div>

    <!-- SUMMARY CHIPS -->
    <div style="display:flex;gap:12px;margin-bottom:22px;">
      <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Trips</div>
        <div style="font-size:22px;font-weight:900;color:#1d4ed8;">${totTrips}</div>
      </div>
      <div style="flex:1;background:#ede9fe;border:2px solid #c4b5fd;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Brass</div>
        <div style="font-size:22px;font-weight:900;color:#7c3aed;">${totBrass}</div>
      </div>
      <div style="flex:1;background:#fff7ed;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Royalty</div>
        <div style="font-size:22px;font-weight:900;color:#c2410c;">${totRoyalty}</div>
      </div>
      <div style="flex:1;background:#fef9c3;border:2px solid #fde047;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Owner Amt (&#8377;)</div>
        <div style="font-size:22px;font-weight:900;color:#b45309;">&#8377;${fmt(totOwner)}</div>
      </div>
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Customer Amt (&#8377;)</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">&#8377;${fmt(totCust)}</div>
      </div>
    </div>

    <!-- TABLE -->
    <table>
      <thead><tr>
        <th>Owner</th>
        <th>Customer</th>
        <th>Address</th>
        <th class="c">Trips</th>
        <th class="c">Brass</th>
        <th class="c">Royalty</th>
        <th class="r">Owner Amt (&#8377;)</th>
        <th class="r">Customer Amt (&#8377;)</th>
        <th class="c">Owner Paid</th>
        <th class="c">Customer Paid</th>
      </tr></thead>
      <tbody>${rows||'<tr><td colspan="10" style="text-align:center;padding:24px;color:#94a3b8;">No data this week</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Grand Total</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totTrips}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totBrass}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totRoyalty}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">&#8377;${fmt(totOwner)}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">&#8377;${fmt(totCust)}</td>
        <td colspan="2" style="background:#0f172a;padding:11px 12px;"></td>
      </tr></tfoot>
    </table>

    <!-- SIGNATURES -->
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Prepared By</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>

    </body></html>`;

    let iframe = document.getElementById('__summary_print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__summary_print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(html); iDoc.close();
    setTimeout(() => {
      const prevTitle = document.title;
      document.title = 'Site B Weekly Summary';
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { document.title = prevTitle; }, 1000);
    }, 400);
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

  const whatsappOwnerBill = async () => {
    if (!weeklyBill) return;
    const toastId = toast.loading('Generating Owner PDF…');
    try {
      const { site, weekStart } = weeklyBill;
      // Build the owner HTML (reuse printOwnerBill logic but return html instead of printing)
      const { weekEnd, dailyGroups, totalBrass, ownerPay } = weeklyBill;
      const totalOwnerAmt = weeklyBill.totalAmountOwner;
      const paid    = ownerPay?.isPaid ? (ownerPay.amountPaid||0) : ownerPay?.isPartial ? (ownerPay.amountPaid||0) : 0;
      const balance = totalOwnerAmt - paid;
      let rowNum = 1;
      const rows = dailyGroups.map(g => {
        const dayTrips = g.orders.reduce((s,o)=>s+o.numberOfTrips,0);
        const dayBrass = g.orders.reduce((s,o)=>s+(o.totalBrass||0),0);
        const dayAmt   = g.orders.reduce((s,o)=>s+o.amountForOwner,0);
        const vehicles = [...new Set(g.orders.flatMap(o=>(o.vehicles?.length>0?o.vehicles.map(v=>v.vehicleNumber):[o.vehicleNumber||o.vehicle?.vehicleNumber])).filter(Boolean))];
        const vBadges = vehicles.map(v=>`<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;margin:1px;">${v}</span>`).join(' ');
        const bg = rowNum%2===0 ? 'background:#f8fafc;' : '';
        return `<tr style="${bg}"><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rowNum++}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(g.date)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${dayTrips} trip${dayTrips!==1?'s':''}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayBrass||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹${fmt(site.rateForOwner)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadges||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(dayAmt)}</td></tr>`;
      }).join('');
      const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Owner Bill — ${site.ownerName}</title><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}th.r{text-align:right;}th.c{text-align:center;}td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}tfoot{display:table-row-group!important;}</style></head><body><div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div><div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${site.ownerName}</div><div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</div></div></div><div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;"><strong>Owner:</strong> ${site.ownerName}${site.ownerPhone?` · ${site.ownerPhone}`:''}<br/><strong>Delivery To:</strong> ${site.customerName}<br/><strong>Site / Address:</strong> ${site.deliveryAddress}</div><div style="display:flex;gap:14px;margin-bottom:20px;"><div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;margin-bottom:5px;">Total Billed</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(totalOwnerAmt)}</div></div><div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;margin-bottom:5px;">Amount Paid</div><div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(paid)}</div></div><div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;margin-bottom:5px;">Net Outstanding</div><div style="font-size:22px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</div></div></div><table><thead><tr><th style="width:32px;">#</th><th>Date</th><th class="c">Trips</th><th class="c">Brass</th><th class="r">Rate/Trip</th><th>Vehicles</th><th class="r">Amount (₹)</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td style="text-align:center;">${weeklyBill.totalTrips}</td><td style="text-align:center;">${totalBrass||0}</td><td></td><td></td><td style="text-align:right;">₹${fmt(totalOwnerAmt)}</td></tr></tfoot></table><div style="display:flex;justify-content:space-between;margin-top:56px;"><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Owner Signature (${site.ownerName})</div></div><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div></div></body></html>`;
      const filename = `Owner_Bill_${site.ownerName}_${fmtDate(weekStart).replace(/\//g,'-')}.pdf`;
      await sharePdfFromHtml(ownerHtml, filename);
      toast.dismiss(toastId);
    } catch(err) { toast.dismiss(toastId); toast.error('Failed to share PDF'); console.error(err); }
  };

  const whatsappCustomerBill = async () => {
    if (!weeklyBill) return;
    const toastId = toast.loading('Generating Customer PDF…');
    try {
      const { site, weekStart, weekEnd, dailyGroups, totalTrips, totalBrass, totalRoyaltyCount, totalRoyaltyAmount, customerCarryForward, customerPay } = weeklyBill;
      const currentBill = weeklyBill.totalAmountCustomer;
      const grandTotal  = currentBill + (customerCarryForward||0);
      const paid   = customerPay?.isPaid ? (customerPay.amountPaid||0) : customerPay?.isPartial ? (customerPay.amountPaid||0) : 0;
      const balance = grandTotal - paid;
      let rowNum = 1;
      const rows = dailyGroups.map(g => {
        const dayTrips   = g.orders.reduce((s,o)=>s+o.numberOfTrips,0);
        const dayBrass   = g.orders.reduce((s,o)=>s+(o.totalBrass||0),0);
        const dayRoyalty = g.orders.reduce((s,o)=>s+(o.royaltyCount||0),0);
        const dayAmt     = g.orders.reduce((s,o)=>s+o.amountForCustomer,0);
        const vehicles   = [...new Set(g.orders.flatMap(o=>(o.vehicles?.length>0?o.vehicles.map(v=>v.vehicleNumber):[o.vehicleNumber||o.vehicle?.vehicleNumber])).filter(Boolean))];
        const vBadges = vehicles.map(v=>`<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;margin:1px;">${v}</span>`).join(' ');
        const bg = rowNum%2===0 ? 'background:#f8fafc;' : '';
        return `<tr style="${bg}"><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rowNum++}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(g.date)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${dayTrips} trip${dayTrips!==1?'s':''}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayBrass||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayRoyalty||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹${fmt(site.rateForCustomer)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadges||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(dayAmt)}</td></tr>`;
      }).join('');
      const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const customerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Customer Bill — ${site.customerName}</title><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}table{width:100%;border-collapse:collapse;margin-bottom:16px;}th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}th.r{text-align:right;}th.c{text-align:center;}td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}tfoot{display:table-row-group!important;}</style></head><body><div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div><div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;"><div style="display:flex;align-items:center;gap:12px;"><img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div><div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div><div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;">Customer Bill</div><div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${site.customerName}</div><div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</div></div></div><div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;"><strong>Customer:</strong> ${site.customerName}${site.customerPhone?` · ${site.customerPhone}`:''}<br/><strong>Site / Address:</strong> ${site.deliveryAddress}<br/><strong>Owner:</strong> ${site.ownerName}</div><div style="display:flex;gap:14px;margin-bottom:20px;"><div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;margin-bottom:5px;">Total Billed</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(grandTotal)}</div></div><div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;margin-bottom:5px;">Amount Paid</div><div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(paid)}</div></div><div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;margin-bottom:5px;">Net Outstanding</div><div style="font-size:22px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</div></div></div><table><thead><tr><th style="width:32px;">#</th><th>Date</th><th class="c">Trips</th><th class="c">Brass</th><th class="c">Royalty</th><th class="r">Rate/Trip</th><th>Vehicles</th><th class="r">Amount (₹)</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td style="text-align:center;">${totalTrips}</td><td style="text-align:center;">${totalBrass||0}</td><td style="text-align:center;">${totalRoyaltyCount||0}</td><td></td><td></td><td style="text-align:right;">₹${fmt(currentBill)}</td></tr></tfoot></table>${totalRoyaltyAmount>0?`<div style="margin-bottom:10px;padding:10px 14px;background:#fefce8;border:1.5px solid #fde68a;border-radius:8px;font-size:12px;color:#854d0e;font-weight:600;">🏷️ Royalty: ${totalRoyaltyCount} units × ₹${fmt(site.royaltyRate||0)} = <strong>₹${fmt(totalRoyaltyAmount)}</strong> (included above)</div>`:''}<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><div style="width:360px;"><div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;"><span>This Week's Bill</span><span style="font-weight:700;">₹${fmt(currentBill)}</span></div>${customerCarryForward>0?`<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#b45309;"><span>Previous Balance</span><span style="font-weight:700;">+ ₹${fmt(customerCarryForward)}</span></div>`:''}<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:800;"><span>Grand Total Billed</span><span>₹${fmt(grandTotal)}</span></div><div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#15803d;"><span>✓ Total Paid</span><span style="font-weight:700;">₹${fmt(paid)}</span></div><div style="display:flex;justify-content:space-between;padding:10px 14px;background:#ffedd5;border:2px solid #fdba74;border-radius:8px;margin-top:6px;"><span style="font-size:14px;font-weight:700;color:#c2410c;">⏳ Net Outstanding</span><span style="font-size:20px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</span></div></div></div><div style="display:flex;justify-content:space-between;margin-top:56px;"><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Customer Signature</div></div><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div></div></body></html>`;
      const filename = `Customer_Bill_${site.customerName}_${fmtDate(weekStart).replace(/\//g,'-')}.pdf`;
      await sharePdfFromHtml(customerHtml, filename);
      toast.dismiss(toastId);
    } catch(err) { toast.dismiss(toastId); toast.error('Failed to share PDF'); console.error(err); }
  };

  // ── Print owner bill ──────────────────────────────────────────────────────
  const printOwnerBill = () => {
    if (!weeklyBill) return;
    const { site, weekStart, weekEnd, dailyGroups, totalTrips, totalBrass, ownerPay } = weeklyBill;
    const totalOwnerAmt = weeklyBill.totalAmountOwner;
    const paid    = ownerPay?.isPaid ? (ownerPay.amountPaid||0) : ownerPay?.isPartial ? (ownerPay.amountPaid||0) : 0;
    const balance = totalOwnerAmt - paid;

    let rowNum = 1;
    const rows = dailyGroups.map(g => {
      const dayTrips = g.orders.reduce((s,o)=>s+o.numberOfTrips,0);
      const dayBrass = g.orders.reduce((s,o)=>s+(o.totalBrass||0),0);
      const dayAmt   = g.orders.reduce((s,o)=>s+o.amountForOwner,0);
      const vehicles = [...new Set(
          g.orders.flatMap(o=>(o.vehicles?.length>0
              ? o.vehicles.map(v=>v.vehicleNumber)
              : [o.vehicleNumber||o.vehicle?.vehicleNumber])
          ).filter(Boolean)
      )];
      const vBadges = vehicles.map(v=>`<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;margin:1px;">${v}</span>`).join(' ');
      const bg = rowNum%2===0 ? 'background:#f8fafc;' : '';
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rowNum++}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(g.date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${dayTrips} trip${dayTrips!==1?'s':''}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayBrass||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹${fmt(site.rateForOwner)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadges||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(dayAmt)}</td>
      </tr>`;
    }).join('');

    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const ownerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Owner Bill — ${site.ownerName}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.r{text-align:right;} th.c{text-align:center;}
      td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}
      tfoot td.r{text-align:right;} tfoot td.c{text-align:center;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>

    <!-- HEADER -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
        <div>
          <div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Owner Bill</div>
        <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${site.ownerName}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</div>
      </div>
    </div>

    <!-- META -->
    <div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;">
      <strong>Owner:</strong> ${site.ownerName}${site.ownerPhone ? ` &nbsp;·&nbsp; ${site.ownerPhone}` : ''}<br/>
      <strong>Delivery To:</strong> ${site.customerName}<br/>
      <strong>Site / Address:</strong> ${site.deliveryAddress}
    </div>

    <!-- SUMMARY CHIPS -->
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div>
        <div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(totalOwnerAmt)}</div>
      </div>
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Amount Paid</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(paid)}</div>
      </div>
      <div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Outstanding</div>
        <div style="font-size:22px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</div>
      </div>
    </div>

    <!-- TABLE -->
    <table>
      <thead><tr>
        <th style="width:32px;">#</th>
        <th>Date</th>
        <th class="c">Trips / Qty</th>
        <th class="c">Brass</th>
        <th class="r">Rate/Trip</th>
        <th>Vehicles</th>
        <th class="r">Amount (₹)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total</td>
        <td class="c" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">${totalTrips}</td>
        <td class="c" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">${totalBrass||0}</td>
        <td style="background:#0f172a;padding:11px 12px;"></td>
        <td style="background:#0f172a;padding:11px 12px;"></td>
        <td class="r" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;">₹${fmt(totalOwnerAmt)}</td>
      </tr></tfoot>
    </table>

    <!-- TOTALS -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <div style="width:340px;">
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;">
          <span style="color:#475569;">Grand Total Billed</span><span style="font-weight:700;">₹${fmt(totalOwnerAmt)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#15803d;">
          <span>✓ Total Paid</span><span style="font-weight:700;">₹${fmt(paid)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#ffedd5;border:2px solid #fdba74;border-radius:8px;margin-top:6px;">
          <span style="font-size:14px;font-weight:700;color:#c2410c;">⏳ Net Outstanding</span>
          <span style="font-size:20px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</span>
        </div>
      </div>
    </div>

    <!-- SIGNATURES -->
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Owner Signature (${site.ownerName})</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>
    </body></html>`;

    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(ownerHtml); iDoc.close();
    setTimeout(() => {
      const prevTitle = document.title;
      document.title = site.ownerName;
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { document.title = prevTitle; }, 1000);
    }, 400);
  };

  // ── Print customer bill ───────────────────────────────────────────────────
  const printCustomerBill = () => {
    if (!weeklyBill) return;
    const {
      site, weekStart, weekEnd, dailyGroups,
      totalTrips, totalBrass, totalRoyaltyCount, totalRoyaltyAmount,
      customerCarryForward, customerPay,
    } = weeklyBill;
    const currentBill = weeklyBill.totalAmountCustomer;
    const grandTotal  = currentBill + (customerCarryForward||0);
    const paid   = customerPay?.isPaid ? (customerPay.amountPaid||0) : customerPay?.isPartial ? (customerPay.amountPaid||0) : 0;
    const balance = grandTotal - paid;

    let rowNum = 1;
    const rows = dailyGroups.map(g => {
      const dayTrips   = g.orders.reduce((s,o)=>s+o.numberOfTrips,0);
      const dayBrass   = g.orders.reduce((s,o)=>s+(o.totalBrass||0),0);
      const dayRoyalty = g.orders.reduce((s,o)=>s+(o.royaltyCount||0),0);
      const dayAmt     = g.orders.reduce((s,o)=>s+o.amountForCustomer,0);
      const vehicles   = [...new Set(
          g.orders.flatMap(o=>(o.vehicles?.length>0
              ? o.vehicles.map(v=>v.vehicleNumber)
              : [o.vehicleNumber||o.vehicle?.vehicleNumber])
          ).filter(Boolean)
      )];
      const vBadges = vehicles.map(v=>`<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;margin:1px;">${v}</span>`).join(' ');
      const bg = rowNum%2===0 ? 'background:#f8fafc;' : '';
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rowNum++}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(g.date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${dayTrips} trip${dayTrips!==1?'s':''}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayBrass||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${dayRoyalty||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹${fmt(site.rateForCustomer)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadges||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(dayAmt)}</td>
      </tr>`;
    }).join('');

    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const customerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Customer Bill — ${site.customerName}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.r{text-align:right;} th.c{text-align:center;}
      td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>

    <!-- HEADER -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>
        <div>
          <div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Customer Bill</div>
        <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${site.customerName}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</div>
      </div>
    </div>

    <!-- META -->
    <div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;">
      <strong>Customer:</strong> ${site.customerName}${site.customerPhone ? ` &nbsp;·&nbsp; ${site.customerPhone}` : ''}<br/>
      <strong>Site / Address:</strong> ${site.deliveryAddress}<br/>
      <strong>Owner:</strong> ${site.ownerName}
    </div>

    <!-- SUMMARY CHIPS -->
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div>
        <div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(grandTotal)}</div>
      </div>
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Amount Paid</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(paid)}</div>
      </div>
      <div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Outstanding</div>
        <div style="font-size:22px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</div>
      </div>
    </div>

    <!-- TABLE -->
    <table>
      <thead><tr>
        <th style="width:32px;">#</th>
        <th>Date</th>
        <th class="c">Trips / Qty</th>
        <th class="c">Brass</th>
        <th class="c">Royalty</th>
        <th class="r">Rate/Trip</th>
        <th>Vehicles</th>
        <th class="r">Amount (₹)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totalTrips}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totalBrass||0}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:center;">${totalRoyaltyCount||0}</td>
        <td style="background:#0f172a;padding:11px 12px;"></td>
        <td style="background:#0f172a;padding:11px 12px;"></td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹${fmt(currentBill)}</td>
      </tr></tfoot>
    </table>

    ${totalRoyaltyAmount > 0 ? `<div style="margin-bottom:10px;padding:10px 14px;background:#fefce8;border:1.5px solid #fde68a;border-radius:8px;font-size:12px;color:#854d0e;font-weight:600;">
      🏷️ Royalty: ${totalRoyaltyCount} units × ₹${fmt(site.royaltyRate||0)} = <strong>₹${fmt(totalRoyaltyAmount)}</strong> (included above)
    </div>` : ''}

    <!-- TOTALS -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <div style="width:360px;">
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;">
          <span style="color:#475569;">This Week's Bill</span><span style="font-weight:700;">₹${fmt(currentBill)}</span>
        </div>
        ${customerCarryForward > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#b45309;">
          <span>Previous Balance (Carry Forward)</span><span style="font-weight:700;">+ ₹${fmt(customerCarryForward)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:800;">
          <span>Grand Total Billed</span><span>₹${fmt(grandTotal)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#15803d;">
          <span>✓ Total Paid</span><span style="font-weight:700;">₹${fmt(paid)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#ffedd5;border:2px solid #fdba74;border-radius:8px;margin-top:6px;">
          <span style="font-size:14px;font-weight:700;color:#c2410c;">⏳ Net Outstanding</span>
          <span style="font-size:20px;font-weight:900;color:#c2410c;">₹${fmt(balance)}</span>
        </div>
      </div>
    </div>

    <!-- SIGNATURES -->
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Customer Signature</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>
    </body></html>`;

    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(customerHtml); iDoc.close();
    setTimeout(() => {
      const prevTitle = document.title;
      document.title = site.customerName;
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { document.title = prevTitle; }, 1000);
    }, 400);
  };

  if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

  const customerCarryFwd = weeklyBill?.customerCarryForward || 0;
  const ownerCarryFwd    = weeklyBill?.ownerCarryForward    || 0;
  const customerGrandTotal = (weeklyBill?.totalAmountCustomer||0) + customerCarryFwd;
  const ownerGrandTotal    = (weeklyBill?.totalAmountOwner   ||0) + ownerCarryFwd;

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">🏗️ Site B</h1>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={()=>{setTab('summary');loadSummary(billDate);}}>📊 Summary</button>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Site</button>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card blue"><div className="stat-icon">🏗️</div><div className="stat-info"><div className="stat-value">{sites.length}</div><div className="stat-label">Total Sites</div></div></div>
          <div className="stat-card green"><div className="stat-icon">👤</div><div className="stat-info"><div className="stat-value">{[...new Set(sites.map(s=>s.ownerName))].length}</div><div className="stat-label">Owners</div></div></div>
          <div className="stat-card yellow"><div className="stat-icon">🧾</div><div className="stat-info"><div className="stat-value">{[...new Set(sites.map(s=>s.customerName))].length}</div><div className="stat-label">Customers</div></div></div>
          <div className="stat-card red"><div className="stat-icon">📍</div><div className="stat-info"><div className="stat-value">{sites.length}</div><div className="stat-label">Active Sites</div></div></div>
        </div>

        {/* ── Tabs ── */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {[{k:'list',l:'📋 Sites'},{k:'summary',l:'📊 Weekly Summary'}].map(t=>(
              <button key={t.k} className={`btn ${tab===t.k?'btn-primary':'btn-secondary'}`}
                      onClick={()=>{setTab(t.k);if(t.k==='summary')loadSummary(billDate);}}>
                {t.l}
              </button>
          ))}
        </div>

        {/* ── SUMMARY TAB ── */}
        {tab==='summary' && (
            <div className="card">
              <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center'}}>
                <input type="date" value={billDate} onChange={e=>setBillDate(e.target.value)}
                       style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={()=>loadSummary(billDate)}>Refresh</button>
                {summary && <button className="btn btn-secondary" onClick={printWeeklySummary}>🖨️ Print</button>}
              </div>
              {!summary ? <div style={{color:'#444',textAlign:'center',padding:32}}>Select date and refresh</div> : (
                  <div ref={summaryRef}>
                    <div style={{fontSize:13,color:'#888',marginBottom:12}}>
                      Week: {fmtDate(summary.weekStart)} to {fmtDate(summary.weekEnd)}
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                        <tr>
                          <th>Owner</th><th>Customer</th><th>Address</th>
                          <th>Trips</th><th>Brass</th><th>Royalty</th>
                          <th>Owner Amt (₹)</th><th>Customer Amt (₹)</th>
                          <th>Owner Paid</th><th>Customer Paid</th>
                        </tr>
                        </thead>
                        <tbody>
                        {summary.summary.length===0 && <tr><td colSpan={10} style={{textAlign:'center',color:'#444',padding:24}}>No data this week</td></tr>}
                        {summary.summary.map((s,i)=>(
                            <tr key={i}>
                              <td style={{color:'#f0f0f0',fontWeight:600}}>{s.site.ownerName}</td>
                              <td style={{color:'#ccc'}}>{s.site.customerName}</td>
                              <td style={{color:'#888',fontSize:12}}>{s.site.deliveryAddress}</td>
                              <td style={{color:'#fff'}}>{s.totalTrips}</td>
                              <td style={{color:'#a78bfa'}}>{s.totalBrass||0}</td>
                              <td style={{color:'#fb923c'}}>{s.totalRoyaltyCount||0}</td>
                              <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(s.totalAmountOwner)}</td>
                              <td style={{color:'#4ade80',fontWeight:600}}>₹{fmt(s.totalAmountCustomer)}</td>
                              <td>
                                {s.ownerPay?.isPaid
                                    ? <span className="badge badge-green">✅ Paid</span>
                                    : s.ownerPay?.isPartial
                                        ? <span className="badge badge-yellow">⚡ Partial</span>
                                        : <span className="badge badge-red">❌ Unpaid</span>}
                              </td>
                              <td>
                                {s.customerPay?.isPaid
                                    ? <span className="badge badge-green">✅ Paid</span>
                                    : s.customerPay?.isPartial
                                        ? <span className="badge badge-yellow">⚡ Partial</span>
                                        : <span className="badge badge-red">❌ Unpaid</span>}
                              </td>
                            </tr>
                        ))}
                        </tbody>
                        {summary.summary.length>0 && (
                            <tfoot>
                            <tr style={{borderTop:'1px solid #2a2a2a'}}>
                              <td colSpan={3} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Grand Total</td>
                              <td style={{color:'#fff',fontWeight:700}}>{summary.summary.reduce((s,r)=>s+r.totalTrips,0)}</td>
                              <td style={{color:'#a78bfa',fontWeight:700}}>{summary.summary.reduce((s,r)=>s+(r.totalBrass||0),0)}</td>
                              <td style={{color:'#fb923c',fontWeight:700}}>{summary.summary.reduce((s,r)=>s+(r.totalRoyaltyCount||0),0)}</td>
                              <td style={{color:'#eab308',fontWeight:700}}>₹{fmt(summary.summary.reduce((s,r)=>s+r.totalAmountOwner,0))}</td>
                              <td style={{color:'#4ade80',fontWeight:700}}>₹{fmt(summary.summary.reduce((s,r)=>s+r.totalAmountCustomer,0))}</td>
                              <td colSpan={2}></td>
                            </tr>
                            </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
              )}
            </div>
        )}

        {/* ── SITES LIST TAB ── */}
        {tab==='list' && (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                  <tr>
                    <th>Owner</th><th>Customer</th><th>Address</th>
                    <th>Owner Rate</th><th>Customer Rate</th>
                    <th>Royalty Rate</th><th>Brass/Trip</th>
                    <th>Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {sites.length===0 && <tr><td colSpan={8} style={{textAlign:'center',color:'#444',padding:32}}>No sites added yet</td></tr>}
                  {sites.map(s=>(
                      <tr key={s._id}>
                        <td>
                          <div style={{fontWeight:700,color:'#f0f0f0'}}>{s.ownerName}</div>
                          {s.ownerPhone && <div style={{fontSize:12,color:'#555'}}>{s.ownerPhone}</div>}
                        </td>
                        <td>
                          <div style={{color:'#ccc'}}>{s.customerName}</div>
                          {s.customerPhone && <div style={{fontSize:12,color:'#555'}}>{s.customerPhone}</div>}
                        </td>
                        <td style={{color:'#888',fontSize:12,maxWidth:160}}>{s.deliveryAddress}</td>
                        <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(s.rateForOwner)}/trip</td>
                        <td style={{color:'#4ade80',fontWeight:600}}>₹{fmt(s.rateForCustomer)}/trip</td>
                        <td style={{color:'#fb923c'}}>{s.royaltyRate ? `₹${fmt(s.royaltyRate)}/unit` : <span style={{color:'#333'}}>—</span>}</td>
                        <td style={{color:'#a78bfa'}}>{s.brassPerTrip ? `${s.brassPerTrip} brass` : <span style={{color:'#333'}}>—</span>}</td>
                        <td>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            <button className="btn btn-primary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openOrder(s)}>+ Trip</button>
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
            </div>
        )}

        {/* ── ADD / EDIT SITE MODAL ── */}
        {(modal==='add'||modal==='edit') && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{modal==='add'?'Add Site B':'Edit Site B'}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>

                <div style={{fontSize:13,color:'#888',marginBottom:12,padding:'0 4px'}}>Owner details (who you pay)</div>
                <div className="form-grid">
                  <div className="form-group"><label>Owner Name *</label><input placeholder="Owner name" value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})}/></div>
                  <div className="form-group"><label>Owner Phone</label><input placeholder="Phone" value={form.ownerPhone} onChange={e=>setForm({...form,ownerPhone:e.target.value})}/></div>
                  <div className="form-group"><label>Rate for Owner (₹/trip)</label><input type="number" placeholder="0" value={form.rateForOwner} onChange={e=>setForm({...form,rateForOwner:e.target.value})}/></div>
                </div>

                <div style={{fontSize:13,color:'#888',marginBottom:12,padding:'0 4px',marginTop:8}}>Customer details (who pays you)</div>
                <div className="form-grid">
                  <div className="form-group"><label>Customer Name *</label><input placeholder="Customer name" value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></div>
                  <div className="form-group"><label>Customer Phone</label><input placeholder="Phone" value={form.customerPhone} onChange={e=>setForm({...form,customerPhone:e.target.value})}/></div>
                  <div className="form-group"><label>Rate for Customer (₹/trip)</label><input type="number" placeholder="0" value={form.rateForCustomer} onChange={e=>setForm({...form,rateForCustomer:e.target.value})}/></div>
                </div>

                <div style={{fontSize:13,color:'#888',marginBottom:12,padding:'0 4px',marginTop:8}}>Royalty &amp; Brass defaults</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Default Royalty Rate (₹/unit)
                      <span style={{fontSize:11,color:'#555',fontWeight:400,marginLeft:6}}>— overridable per order</span>
                    </label>
                    <input type="number" placeholder="0" value={form.royaltyRate} onChange={e=>setForm({...form,royaltyRate:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Default Brass per Trip
                      <span style={{fontSize:11,color:'#555',fontWeight:400,marginLeft:6}}>— overridable per vehicle row</span>
                    </label>
                    <input type="number" placeholder="0" value={form.brassPerTrip} onChange={e=>setForm({...form,brassPerTrip:e.target.value})}/>
                  </div>
                </div>

                <div className="form-grid" style={{marginTop:8}}>
                  <div className="form-group" style={{gridColumn:'1 / -1'}}>
                    <label>Delivery Address *</label>
                    <input placeholder="Full delivery address" value={form.deliveryAddress} onChange={e=>setForm({...form,deliveryAddress:e.target.value})}/>
                  </div>
                  <div className="form-group"><label>Vehicle Type</label>
                    <select value={form.vehicleType} onChange={e=>setForm({...form,vehicleType:e.target.value})}>
                      <option value="Both">Both</option><option value="Own">Own Only</option><option value="Rental">Rental Only</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Note</label><input placeholder="Optional" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></div>
                </div>

                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {/* ── ADD TRIP ORDER MODAL ── */}
        {modal==='order' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()} style={{maxWidth:820}}>
                <div className="modal-header">
                  <h3>Add Trip — {selected?.ownerName} → {selected?.customerName}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>

                {/* Rates info bar */}
                <div className="modal-stock-info" style={{marginBottom:12,flexWrap:'wrap',gap:6}}>
                  Owner: <strong style={{color:'#eab308'}}>₹{fmt(selected?.rateForOwner)}/trip</strong>
                  &nbsp;·&nbsp; Customer: <strong style={{color:'#4ade80'}}>₹{fmt(selected?.rateForCustomer)}/trip</strong>
                  {selected?.royaltyRate > 0 && <>&nbsp;·&nbsp; Royalty: <strong style={{color:'#fb923c'}}>₹{fmt(selected?.royaltyRate)}/unit</strong></>}
                  {selected?.brassPerTrip > 0 && <>&nbsp;·&nbsp; Brass default: <strong style={{color:'#a78bfa'}}>{selected?.brassPerTrip}/trip</strong></>}
                </div>

                {/* Date + note */}
                <div className="form-grid" style={{marginBottom:8}}>
                  <div className="form-group"><label>Date</label><input type="date" value={orderForm.date} onChange={e=>setOrderForm({...orderForm,date:e.target.value})}/></div>
                  <div className="form-group"><label>Note (optional)</label><input placeholder="Optional" value={orderForm.note} onChange={e=>setOrderForm({...orderForm,note:e.target.value})}/></div>
                </div>

                {/* ── Vehicle rows ── */}
                <div style={{marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:600,color:'#aaa'}}>🚛 Vehicles</div>
                    <button className="btn btn-secondary" style={{padding:'4px 12px',fontSize:12}} onClick={addVehicleRow}>+ Add Vehicle</button>
                  </div>

                  {orderForm.vehicles.map((row, idx) => (
                      <div key={row._key} style={{background:'#111',border:'1px solid #222',borderRadius:8,padding:'12px 14px',marginBottom:10,position:'relative'}}>
                        {orderForm.vehicles.length > 1 && (
                            <button onClick={()=>removeVehicleRow(idx)}
                                    style={{position:'absolute',top:8,right:10,background:'none',border:'none',color:'#555',fontSize:16,cursor:'pointer',lineHeight:1}}
                                    title="Remove row">✕</button>
                        )}
                        <div style={{fontSize:11,color:'#444',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:1}}>Vehicle #{idx+1}</div>

                        {/* Vehicle, Trips, Brass */}
                        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:10,marginBottom:8}}>
                          <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:12}}>Vehicle</label>
                            <select value={row.vehicleId} onChange={e=>updateVehicleRow(idx,{vehicleId:e.target.value,manualVehicleNumber:''})}>
                              <option value="">Select vehicle...</option>
                              <optgroup label="✅ Own Vehicles">
                                {formData.vehicles.filter(v=>v.ownershipType==='Own').map(v=><option key={v._id} value={v._id}>{v.vehicleNumber}</option>)}
                              </optgroup>
                              <optgroup label="🔑 Rental Vehicles">
                                {formData.vehicles.filter(v=>v.ownershipType==='Rental').map(v=><option key={v._id} value={v._id}>{v.vehicleNumber} — {v.rentalOwnerName}</option>)}
                              </optgroup>
                            </select>
                          </div>
                          <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:12}}>Trips *</label>
                            <input type="number" placeholder="0" min="0" value={row.numberOfTrips}
                                   onChange={e=>updateVehicleRow(idx,{numberOfTrips:e.target.value})}/>
                          </div>
                          <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:12}}>Brass/Trip <span style={{color:'#555',fontWeight:400,fontSize:11}}>(default: {selected?.brassPerTrip||0})</span></label>
                            <input type="number" placeholder={selected?.brassPerTrip||0} min="0"
                                   value={row.brassPerTrip}
                                   onChange={e=>updateVehicleRow(idx,{brassPerTrip:e.target.value})}/>
                          </div>
                        </div>

                        {/* Manual number + Driver + Conductor */}
                        <div style={{display:'grid',gridTemplateColumns:!row.vehicleId?'1fr 1fr 1fr':'1fr 1fr',gap:10}}>
                          {!row.vehicleId && (
                              <div className="form-group" style={{marginBottom:0}}>
                                <label style={{fontSize:12}}>Manual Vehicle No.</label>
                                <input placeholder="e.g. MH12AB1234" value={row.manualVehicleNumber}
                                       onChange={e=>updateVehicleRow(idx,{manualVehicleNumber:e.target.value.toUpperCase()})}
                                       style={{textTransform:'uppercase'}}/>
                              </div>
                          )}
                          <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:12}}>Driver</label>
                            <select value={row.driverId} onChange={e=>updateVehicleRow(idx,{driverId:e.target.value})}>
                              <option value="">Select driver...</option>
                              {formData.drivers.map(d=><option key={d._id} value={d._id}>{d.name}</option>)}
                            </select>
                          </div>
                          <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:12}}>Conductor</label>
                            <select value={row.conductorId} onChange={e=>updateVehicleRow(idx,{conductorId:e.target.value})}>
                              <option value="">Select conductor...</option>
                              {formData.conductors.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Per-vehicle live preview */}
                        {Number(row.numberOfTrips) > 0 && (
                            <div style={{marginTop:8,display:'flex',gap:16,fontSize:12,color:'#555',borderTop:'1px solid #1a1a1a',paddingTop:8}}>
                              <span>Owner: <strong style={{color:'#eab308'}}>₹{fmt(Number(row.numberOfTrips)*(selected?.rateForOwner||0))}</strong></span>
                              <span>Customer: <strong style={{color:'#4ade80'}}>₹{fmt(Number(row.numberOfTrips)*(selected?.rateForCustomer||0))}</strong></span>
                              <span style={{color:'#a78bfa'}}>Brass: <strong>{Number(row.numberOfTrips)*(row.brassPerTrip!==''?Number(row.brassPerTrip):Number(selected?.brassPerTrip)||0)}</strong></span>
                            </div>
                        )}
                      </div>
                  ))}
                </div>

                {/* ── Royalty section ── */}
                <div style={{background:'#0f0900',border:'1px solid #2a1a00',borderRadius:8,padding:'12px 14px',marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#fb923c',marginBottom:10}}>📋 Royalty <span style={{fontSize:11,color:'#555',fontWeight:400}}>(optional — added to customer bill)</span></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label style={{fontSize:12}}>Royalty Count (units)</label>
                      <input type="number" placeholder="0" min="0" value={orderForm.royaltyCount}
                             onChange={e=>setOrderForm({...orderForm,royaltyCount:e.target.value})}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label style={{fontSize:12}}>Rate (₹/unit) <span style={{color:'#555',fontWeight:400,fontSize:11}}>default: ₹{fmt(selected?.royaltyRate||0)}</span></label>
                      <input type="number" placeholder={selected?.royaltyRate||0} min="0" value={orderForm.royaltyRate}
                             onChange={e=>setOrderForm({...orderForm,royaltyRate:e.target.value})}/>
                    </div>
                  </div>
                  {Number(orderForm.royaltyCount) > 0 && (
                      <div style={{marginTop:8,fontSize:12,color:'#fb923c'}}>
                        Royalty Amount: <strong>₹{fmt((Number(orderForm.royaltyCount)||0) * (orderForm.royaltyRate!==''?Number(orderForm.royaltyRate):Number(selected?.royaltyRate)||0))}</strong>
                      </div>
                  )}
                </div>

                {/* ── Order totals preview ── */}
                {orderPreview && orderPreview.totalTrips > 0 && (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:12}}>
                      <div style={{background:'#0a1200',border:'1px solid #1a3000',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase',marginBottom:4}}>Total Trips</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{orderPreview.totalTrips}</div>
                      </div>
                      <div style={{background:'#100a1e',border:'1px solid #28124a',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase',marginBottom:4}}>Total Brass</div>
                        <div style={{fontSize:20,fontWeight:700,color:'#a78bfa'}}>{orderPreview.totalBrass}</div>
                      </div>
                      <div style={{background:'#1a1400',border:'1px solid #3a2800',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase',marginBottom:4}}>Owner Amt</div>
                        <div style={{fontSize:16,fontWeight:700,color:'#eab308'}}>₹{fmt(orderPreview.ownerAmt)}</div>
                      </div>
                      <div style={{background:'#0a1a0a',border:'1px solid #0a3a0a',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase',marginBottom:4}}>Customer Amt</div>
                        <div style={{fontSize:16,fontWeight:700,color:'#4ade80'}}>₹{fmt(orderPreview.customerAmt)}</div>
                        {orderPreview.royAmt > 0 && <div style={{fontSize:10,color:'#fb923c',marginTop:2}}>incl. ₹{fmt(orderPreview.royAmt)} royalty</div>}
                      </div>
                    </div>
                )}

                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleOrder} disabled={saving}>{saving?'Saving...':'Add Trip'}</button>
                </div>
              </div>
            </div>
        )}

        {/* ── WEEKLY BILL MODAL ── */}
        {modal==='bill' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()} style={{maxWidth:980}}>
                <div className="modal-header">
                  <h3>Weekly Bill — {selected?.ownerName} → {selected?.customerName}</h3>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input type="date" value={billDate}
                           onChange={e=>{setBillDate(e.target.value);loadWeeklyBill(selected,e.target.value);}}
                           style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'6px 10px',color:'#e0e0e0',fontSize:13}}/>
                    <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                  </div>
                </div>

                {!weeklyBill ? <div style={{textAlign:'center',padding:32,color:'#444'}}>Loading...</div> : (
                    <div>
                      {/* ── Site info bar ── */}
                      <div style={{background:'#0e0e0e',border:'1px solid #1e1e1e',borderRadius:8,padding:'12px 16px',marginBottom:14,fontSize:13}}>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                          <div><span style={{color:'#555'}}>Owner:</span> <strong style={{color:'#eab308'}}>{weeklyBill.site.ownerName}</strong></div>
                          <div><span style={{color:'#555'}}>Customer:</span> <strong style={{color:'#4ade80'}}>{weeklyBill.site.customerName}</strong></div>
                          <div><span style={{color:'#555'}}>Address:</span> <strong style={{color:'#ccc'}}>{weeklyBill.site.deliveryAddress}</strong></div>
                          <div><span style={{color:'#555'}}>Week:</span> <strong style={{color:'#ccc'}}>{fmtDate(weeklyBill.weekStart)} — {fmtDate(weeklyBill.weekEnd)}</strong></div>
                          <div><span style={{color:'#555'}}>Trips:</span> <strong style={{color:'#fff'}}>{weeklyBill.totalTrips}</strong></div>
                          <div><span style={{color:'#555'}}>Brass:</span> <strong style={{color:'#a78bfa'}}>{weeklyBill.totalBrass||0}</strong></div>
                          {weeklyBill.totalRoyaltyCount > 0 && (
                              <div><span style={{color:'#555'}}>Royalty:</span> <strong style={{color:'#fb923c'}}>{weeklyBill.totalRoyaltyCount} units = ₹{fmt(weeklyBill.totalRoyaltyAmount)}</strong></div>
                          )}
                          {customerCarryFwd > 0 && (
                              <div style={{gridColumn:'1/-1'}}>
                        <span style={{background:'#1c1400',border:'1px solid #3a2800',borderRadius:4,padding:'3px 10px',fontSize:12,color:'#f59e0b'}}>
                          📌 Customer carry forward from last week: <strong>₹{fmt(customerCarryFwd)}</strong>
                        </span>
                              </div>
                          )}
                        </div>
                      </div>

                      {/* ── Daily order table ── */}
                      {weeklyBill.dailyGroups.length===0 ? (
                          <div style={{textAlign:'center',color:'#444',padding:24}}>No trips this week</div>
                      ) : (
                          <div className="table-wrap" style={{marginBottom:14}}>
                            <table>
                              <thead>
                              <tr>
                                <th>Date</th><th>Trips</th><th>Brass</th><th>Royalty</th>
                                <th>Vehicle(s)</th><th>Driver</th><th>Conductor</th>
                                <th>Owner Amt (₹)</th><th>Customer Amt (₹)</th><th></th>
                              </tr>
                              </thead>
                              <tbody>
                              {weeklyBill.dailyGroups.map((g,gi)=>
                                  g.orders.map((o,oi)=>{
                                    const vNums = o.vehicles?.length > 0
                                        ? o.vehicles.filter(v=>v.vehicleNumber||v.vehicle?.vehicleNumber)
                                            .map(v=>`${v.vehicleNumber||v.vehicle?.vehicleNumber} (${v.numberOfTrips||0}t)`).join(', ')
                                        : (o.vehicleNumber ? `${o.vehicleNumber} (${o.numberOfTrips||0}t)` : (o.vehicle?.vehicleNumber ? `${o.vehicle.vehicleNumber} (${o.numberOfTrips||0}t)` : '—'));
                                    const dNames = o.vehicles?.length > 0
                                        ? [...new Set(o.vehicles.map(v=>v.driverName||v.driver?.name).filter(Boolean))].join(', ')
                                        : (o.driverName||o.driver?.name||'—');
                                    const cNames = o.vehicles?.length > 0
                                        ? [...new Set(o.vehicles.map(v=>v.conductorName||v.conductor?.name).filter(Boolean))].join(', ')
                                        : (o.conductorName||o.conductor?.name||'—');
                                    return (
                                        <tr key={`${gi}-${oi}`}>
                                          <td style={{color:'#ccc',whiteSpace:'nowrap'}}>{oi===0?fmtDay(g.date):''}</td>
                                          <td style={{color:'#fff',fontWeight:600}}>{o.numberOfTrips}</td>
                                          <td style={{color:'#a78bfa'}}>{o.totalBrass||0}</td>
                                          <td style={{color:'#fb923c'}}>{o.royaltyCount > 0 ? `${o.royaltyCount}u` : '—'}</td>
                                          <td style={{color:'#888',fontSize:12}}>{vNums}</td>
                                          <td style={{color:'#888',fontSize:12}}>{dNames||'—'}</td>
                                          <td style={{color:'#888',fontSize:12}}>{cNames||'—'}</td>
                                          <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(o.amountForOwner)}</td>
                                          <td style={{color:'#4ade80',fontWeight:600}}>
                                            ₹{fmt(o.amountForCustomer)}
                                            {o.royaltyAmount > 0 && <span style={{fontSize:10,color:'#fb923c',marginLeft:4}}>(+₹{fmt(o.royaltyAmount)} roy)</span>}
                                          </td>
                                          <td>
                                            <button onClick={()=>deleteOrder(o._id)}
                                                    style={{background:'none',border:'none',color:'#444',cursor:'pointer',fontSize:14,padding:'2px 6px'}}
                                                    title="Delete order">🗑</button>
                                          </td>
                                        </tr>
                                    );
                                  })
                              )}
                              </tbody>
                              <tfoot>
                              <tr style={{borderTop:'1px solid #2a2a2a'}}>
                                <td style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Week Total</td>
                                <td style={{color:'#fff',fontWeight:700}}>{weeklyBill.totalTrips}</td>
                                <td style={{color:'#a78bfa',fontWeight:700}}>{weeklyBill.totalBrass||0}</td>
                                <td style={{color:'#fb923c',fontWeight:700}}>{weeklyBill.totalRoyaltyCount||0}</td>
                                <td style={{color:'#888',fontSize:11}} colSpan={3}>
                                  {(()=>{
                                    const vMap={};
                                    weeklyBill.dailyGroups.forEach(g=>g.orders.forEach(o=>{
                                      if(o.vehicles?.length>0){
                                        o.vehicles.forEach(v=>{
                                          const num=v.vehicleNumber||v.vehicle?.vehicleNumber;
                                          if(num) vMap[num]=(vMap[num]||0)+(v.numberOfTrips||0);
                                        });
                                      } else {
                                        const num=o.vehicleNumber||o.vehicle?.vehicleNumber;
                                        if(num) vMap[num]=(vMap[num]||0)+(o.numberOfTrips||0);
                                      }
                                    }));
                                    return Object.entries(vMap).map(([num,t])=>(
                                        <span key={num} style={{display:'inline-block',marginRight:6,whiteSpace:'nowrap'}}>
                                        <strong style={{color:'#ccc'}}>{num}</strong>
                                        <span style={{color:'#eab308',marginLeft:3}}>({t}t)</span>
                                      </span>
                                    ));
                                  })()}
                                </td>
                                <td style={{color:'#eab308',fontWeight:700}}>₹{fmt(weeklyBill.totalAmountOwner)}</td>
                                <td style={{color:'#4ade80',fontWeight:700}}>₹{fmt(weeklyBill.totalAmountCustomer)}</td>
                                <td></td>
                              </tr>
                              {customerCarryFwd > 0 && (
                                  <tr style={{background:'#1c1400'}}>
                                    <td colSpan={8} style={{color:'#f59e0b',padding:'8px 16px',fontSize:12,fontWeight:600}}>📌 Customer Carry Forward (prev week unpaid balance)</td>
                                    <td style={{color:'#f59e0b',fontWeight:700}}>+₹{fmt(customerCarryFwd)}</td>
                                    <td></td>
                                  </tr>
                              )}
                              {customerCarryFwd > 0 && (
                                  <tr>
                                    <td colSpan={8} style={{color:'#4ade80',padding:'6px 16px',fontWeight:700}}>Customer Grand Total (this week + carry)</td>
                                    <td style={{color:'#4ade80',fontWeight:700,fontSize:15}}>₹{fmt(customerGrandTotal)}</td>
                                    <td></td>
                                  </tr>
                              )}
                              </tfoot>
                            </table>
                          </div>
                      )}

                      {/* ── Summary boxes ── */}
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                        <div style={{background:'#1a1400',border:'1px solid #2a2000',borderRadius:10,padding:16,textAlign:'center'}}>
                          <div style={{fontSize:12,color:'#888',textTransform:'uppercase',marginBottom:8}}>Total Payable to Owner</div>
                          <div style={{fontSize:26,fontWeight:700,color:'#eab308'}}>₹{fmt(ownerGrandTotal)}</div>
                          <div style={{fontSize:12,color:'#555',marginTop:4}}>
                            ₹{fmt(weeklyBill.site.rateForOwner)}/trip × {weeklyBill.totalTrips} trips
                            {ownerCarryFwd > 0 && <span style={{color:'#f59e0b'}}> + ₹{fmt(ownerCarryFwd)} carry</span>}
                          </div>
                        </div>
                        <div style={{background:'#0a1a0a',border:'1px solid #0a2a0a',borderRadius:10,padding:16,textAlign:'center'}}>
                          <div style={{fontSize:12,color:'#888',textTransform:'uppercase',marginBottom:8}}>Total Receivable from Customer</div>
                          <div style={{fontSize:26,fontWeight:700,color:'#4ade80'}}>₹{fmt(customerGrandTotal)}</div>
                          <div style={{fontSize:12,color:'#555',marginTop:4}}>
                            {weeklyBill.totalTrips} trips @ ₹{fmt(weeklyBill.site.rateForCustomer)}
                            {weeklyBill.totalRoyaltyAmount > 0 && <span style={{color:'#fb923c'}}> + ₹{fmt(weeklyBill.totalRoyaltyAmount)} royalty</span>}
                            {customerCarryFwd > 0 && <span style={{color:'#f59e0b'}}> + ₹{fmt(customerCarryFwd)} carry</span>}
                          </div>
                        </div>
                      </div>

                      {/* ── Brass + Royalty totals strip ── */}
                      {(weeklyBill.totalBrass > 0 || weeklyBill.totalRoyaltyCount > 0) && (
                          <div style={{display:'flex',gap:12,marginBottom:14}}>
                            {weeklyBill.totalBrass > 0 && (
                                <div style={{flex:1,background:'#100a1e',border:'1px solid #28124a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                  <div style={{fontSize:11,color:'#7c3aed',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>Total Brass (Week)</div>
                                  <div style={{fontSize:22,fontWeight:700,color:'#a78bfa'}}>{weeklyBill.totalBrass}</div>
                                </div>
                            )}
                            {weeklyBill.totalRoyaltyCount > 0 && (
                                <div style={{flex:1,background:'#0f0900',border:'1px solid #2a1a00',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                  <div style={{fontSize:11,color:'#c2410c',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>Total Royalty (Week)</div>
                                  <div style={{fontSize:22,fontWeight:700,color:'#fb923c'}}>{weeklyBill.totalRoyaltyCount} <span style={{fontSize:13}}>units</span></div>
                                  <div style={{fontSize:12,color:'#555',marginTop:2}}>= ₹{fmt(weeklyBill.totalRoyaltyAmount)}</div>
                                </div>
                            )}
                          </div>
                      )}

                      {/* ── Print + WhatsApp buttons ── */}
                      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
                        <button className="btn btn-secondary" style={{flex:1}} onClick={printOwnerBill}>🖨️ Print Owner Bill</button>
                        <button onClick={whatsappOwnerBill} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'10px 16px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WhatsApp
                        </button>
                      </div>
                      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
                        <button className="btn btn-secondary" style={{flex:1}} onClick={printCustomerBill}>🖨️ Print Customer Bill</button>
                        <button onClick={whatsappCustomerBill} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'#25D366',color:'#fff',border:'none',borderRadius:8,padding:'10px 16px',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WhatsApp
                        </button>
                      </div>

                      {/* ── Owner payment ── */}
                      <PaySection
                          label="Owner"
                          total={weeklyBill.totalAmountOwner}
                          carryForward={ownerCarryFwd}
                          payRec={ownerPayRec}
                          payForm={ownerPayForm}
                          setPayForm={setOwnerPayForm}
                          savingPay={savingOwnerPay}
                          onSave={()=>savePayment('owner',weeklyBill.totalAmountOwner,ownerCarryFwd,ownerPayForm,setSavingOwnerPay,setOwnerPayRec,setOwnerPayForm)}
                      />

                      {/* ── Customer payment ── */}
                      <PaySection
                          label="Customer"
                          total={weeklyBill.totalAmountCustomer}
                          carryForward={customerCarryFwd}
                          payRec={custPayRec}
                          payForm={custPayForm}
                          setPayForm={setCustPayForm}
                          savingPay={savingCustPay}
                          onSave={()=>savePayment('customer',weeklyBill.totalAmountCustomer,customerCarryFwd,custPayForm,setSavingCustPay,setCustPayRec,setCustPayForm)}
                      />
                    </div>
                )}
              </div>
            </div>
        )}
      </div>
  );
}