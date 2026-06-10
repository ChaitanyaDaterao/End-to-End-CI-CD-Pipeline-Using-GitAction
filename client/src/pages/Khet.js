const logo = require('../assets/logo.jpg');
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt = (n) => Number(n||0).toLocaleString('en-IN');
const fmtDate = (d) => { const p = new Date(d); return isNaN(p.getTime()) ? '—' : p.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}); };
const fmtDay  = (d) => { const p = new Date(d); return isNaN(p.getTime()) ? '—' : p.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'2-digit'}); };
const UNITS   = ['brass','ton','kg','bag','cubic ft'];
const COMPANY = 'R.C Enterprises';
const OWNERS  = 'Chand Laluwale & Roshan Laluwale';

const emptyVehicleRow = { vehicleId:'', vehicleNumber:'', driverId:'', conductorId:'', numberOfTrips:'', quantity:'', rateApplied:'', brassPerTrip:'' };
const emptyOrder  = { customerName:'', customerPhone:'', date:new Date().toISOString().slice(0,10), billingType:'Trip', quantityUnit:'brass', material:'', destination:'', royaltyQuantity:'', royaltyRate:'', note:'', vehicles:[{...emptyVehicleRow}] };
const emptyPayment = { amount:'', paymentType:'full', date:new Date().toISOString().slice(0,10), note:'' };

const resolveWeekStart = (date) => {
    const parsed = date ? new Date(date) : new Date();
    const d = isNaN(parsed.getTime()) ? new Date() : parsed;
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ── LOCAL date string (YYYY-MM-DD in the browser's local timezone, not UTC) ──
// Use this instead of .toISOString().slice(0,10) when sending weekStart to backend
// because toISOString() converts to UTC which is 5.5 hrs behind IST — shifting the date back.
const toLocalDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// ── Shared print CSS (white, professional — matches Image 3 style) ──
const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  @page{margin:16px 22px;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:0;color:#111827;background:#fff;font-size:13px;}

  .company-header{display:flex;align-items:center;justify-content:flex-start;gap:12px;margin-bottom:3px;}
  .company-logo{height:52px;width:52px;object-fit:contain;border-radius:6px;flex-shrink:0;}
  .company-text{text-align:left;}
  .company{font-size:26px;font-weight:900;letter-spacing:-0.5px;color:#0f172a;}
  .owners{font-size:11px;font-weight:600;margin-bottom:4px;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;}
  .divider{border:none;border-top:3px solid #0f172a;margin:5px 0 10px;}

  h3{font-size:16px;margin:0 0 6px;color:#0f172a;font-weight:800;}
  p{font-size:12px;margin:3px 0;color:#475569;font-weight:500;}
  strong{color:#0f172a;font-weight:700;}

  /* Section divider between customers */
  .cust-block{margin-bottom:20px;}
  .cust-block+.cust-block{border-top:2px solid #e2e8f0;padding-top:20px;}

  /* Customer header bar */
  .cust-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
  .cust-name{font-size:15px;font-weight:800;color:#0f172a;}
  .cust-phone{font-size:12px;color:#64748b;margin-top:2px;}
  .cust-totals{display:flex;gap:16px;align-items:center;}
  .cust-total-box{text-align:center;border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 14px;background:#f8fafc;}
  .cust-total-box.highlight{background:#ffedd5;border-color:#fdba74;}
  .cust-total-box .lbl{font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:2px;}
  .cust-total-box .val{font-size:16px;font-weight:900;color:#c2410c;}
  .cust-total-box.green .val{color:#15803d;}
  .cust-total-box.blue .val{color:#1d4ed8;}

  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th{background:#0f172a;color:#f1f5f9;padding:9px 11px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
  td{padding:8px 11px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;font-weight:500;}
  tr:nth-child(even) td{background:#f8fafc;}
  .total-row td{font-weight:800;background:#0f172a;color:#f8fafc;border:none;font-size:13px;}
  .royalty-row td{background:#fefce8;font-weight:600;color:#854d0e;border-bottom:1px solid #fde68a;font-size:11px;}

  .summary{margin-top:12px;border:2px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc;}
  .summary-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;font-weight:500;}
  .summary-row:last-child{border-bottom:none;}
  .summary-row.royalty{color:#854d0e;background:#fefce8;padding:7px 10px;border-radius:6px;margin:4px 0;border:1.5px solid #fde68a;font-weight:700;}
  .summary-row.grand{font-weight:900;font-size:15px;border-top:2px solid #0f172a;margin-top:4px;padding-top:10px;color:#0f172a;}
  .summary-row.carry{color:#dc2626;background:#fff5f5;padding:7px 10px;border-radius:6px;margin:4px 0;border:1.5px solid #fca5a5;font-weight:700;}
  .royalty-badge{display:inline-block;background:#fef9c3;border:1px solid #fde047;border-radius:4px;padding:2px 7px;font-size:9px;color:#854d0e;font-weight:700;margin-left:6px;}
  .paid-chip{display:inline-block;background:#dcfce7;border:1.5px solid #86efac;border-radius:5px;padding:2px 8px;color:#15803d;font-weight:700;font-size:10px;}

  /* Overall summary grid at bottom */
  .grand-summary{margin-top:24px;border:2px solid #0f172a;border-radius:12px;padding:20px;background:#f8fafc;}
  .grand-summary-title{font-size:14px;font-weight:800;color:#0f172a;margin-bottom:14px;text-align:center;text-transform:uppercase;letter-spacing:0.5px;}
  .grand-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;}
  .grand-cell{text-align:center;}
  .grand-cell .lbl{font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;}
  .grand-cell .val{font-size:18px;font-weight:900;}
  .val-blue{color:#1d4ed8;}
  .val-yellow{color:#b45309;}
  .val-orange{color:#c2410c;}
  .val-red{color:#dc2626;}
  .val-green{color:#15803d;}
  .val-black{color:#0f172a;}

  /* Payments section */
  .payments-section{margin-top:20px;margin-bottom:20px;}
  .payments-section h4{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;}

  /* Carry forward banner */
  .carry-banner{background:#fff5f5;border:1.5px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#dc2626;font-weight:600;}

  .sign-section{display:flex;justify-content:space-between;margin-top:48px;}
  .sign-line{border-top:1.5px solid #94a3b8;padding-top:8px;font-size:11px;font-weight:500;text-align:center;color:#64748b;width:190px;}

  @media print{
    button{display:none;}
    *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  }
`;

function CustPaySection({ custName, custPhone, weekStart, orders, allPayments, onPaySaved, carryForward: carryForwardProp, overrideDue }) {
    const [open,      setOpen]      = useState(false);
    const [form,      setForm]      = useState({ paymentType:'full', amount:'', date:new Date().toISOString().slice(0,10), note:'' });
    const [saving,    setSaving]    = useState(false);
    const [deletingId,setDeletingId]= useState(null);

    // Week picker state — defaults to whichever week "weekStart" prop falls in
    const initWeekStart = weekStart || resolveWeekStart(new Date());

    const effectiveWeekStart = weekStart || resolveWeekStart(new Date());
    const carryForward = Number(carryForwardProp) || 0;

    const totalTrips = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
    const totalQty   = orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0);
    const totalRoyalty = orders.reduce((s,o)=>s+(o.totalRoyalty||0),0);
    const tripSummary = totalTrips>0&&totalQty===0 ? `${totalTrips} trips`
        : totalQty>0&&totalTrips===0 ? `${totalQty} ${orders.find(o=>o.quantityUnit)?.quantityUnit||'units'}`
            : totalTrips>0&&totalQty>0 ? `${totalTrips} trips + ${totalQty} units` : null;

    const weekTotal  = orders.reduce((s,o) => s + (o.grandTotal || (o.totalAmount||0) + (o.totalRoyalty||0)), 0);
    const custTotal  = carryForward + weekTotal;
    const custPayments = allPayments.filter(p=>p.customerName===custName&&p.customerPhone===(custPhone||''));
    // "Paid this week" — only payments in allPayments (which is week-scoped from server)
    const weekPaid   = custPayments.reduce((s,p)=>s+(p.amountPaid||p.amount||0),0);
    // "Due" = all-time net due from server (total ever billed - total ever paid), clamped to 0
    const remaining  = overrideDue  !== undefined ? overrideDue  : Math.max(0, custTotal - weekPaid);
    const partialAmt = Number(form.amount)||0;
    const overLimit  = form.paymentType==='partial' && partialAmt > remaining;

    const save = async () => {
        if (form.paymentType==='partial' && partialAmt<=0) return toast.error('Enter amount');
        if (overLimit) return toast.error(`Cannot exceed remaining ₹${fmt(remaining)}`);
        setSaving(true);
        try {
            const payAmt = form.paymentType==='full' ? remaining : partialAmt;
            await api.post('/khet/payments', {
                amountPaid:  payAmt,
                amount:      payAmt,
                paymentType: form.paymentType,
                isPaid:      form.paymentType === 'full',
                isPartial:   form.paymentType === 'partial',
                note:        form.note,
                date:        form.date,
                customerName:  custName,
                customerPhone: custPhone||'',
                weekStart: effectiveWeekStart,
            });
            toast.success('Payment saved');
            setOpen(false);
            setForm(f=>({...f, amount:'', note:'', date:new Date().toISOString().slice(0,10)}));
            if (onPaySaved) onPaySaved();
        } catch { toast.error('Error saving payment'); }
        finally { setSaving(false); }
    };

    const deletePayment = async (id) => {
        if (!window.confirm('Delete this payment record? This cannot be undone.')) return;
        setDeletingId(id);
        try {
            await api.delete(`/khet/payments/${id}`);
            toast.success('Payment deleted');
            if (onPaySaved) onPaySaved();
        } catch { toast.error('Error deleting payment'); }
        finally { setDeletingId(null); }
    };

    return (
        <div style={{marginTop:10}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#1a1a1a',borderRadius:6,padding:'8px 12px'}}>
                <div style={{display:'flex',gap:16,fontSize:12,flexWrap:'wrap'}}>
                    {tripSummary && <span style={{color:'#888'}}>Trips: <strong style={{color:'#60a5fa'}}>{tripSummary}</strong></span>}
                    {totalRoyalty>0 && <span style={{color:'#888'}}>Royalty: <strong style={{color:'#d97706'}}>₹{fmt(totalRoyalty)}</strong></span>}
                    <span style={{color:'#888'}}>This Week: <strong style={{color:'#eab308'}}>₹{fmt(weekTotal)}</strong></span>
                    {carryForward>0 && <span style={{color:'#888'}}>Carry Fwd: <strong style={{color:'#f87171'}}>₹{fmt(carryForward)}</strong></span>}
                    {carryForward>0 && <span style={{color:'#888'}}>Net Bill: <strong style={{color:'#fbbf24'}}>₹{fmt(custTotal)}</strong></span>}
                    <span style={{color:'#888'}}>Paid (this week): <strong style={{color:'#4ade80'}}>₹{fmt(weekPaid)}</strong></span>
                    <span style={{color:'#888'}}>Due: <strong style={{color:remaining>0?'#f87171':'#4ade80'}}>₹{fmt(remaining)}</strong></span>
                </div>
                <button className="btn btn-secondary" style={{padding:'3px 10px',fontSize:11}} onClick={()=>setOpen(o=>!o)}>
                    {open?'Cancel':'+ Payment'}
                </button>
            </div>

            {custPayments.length>0 && (
                <div style={{marginTop:6,border:'1px solid #1e1e1e',borderRadius:6,overflow:'hidden'}}>
                    {custPayments.map((p)=>(
                        <div key={p._id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 12px',borderBottom:'1px solid #161616',background:'#0a0a0a'}}>
                            <div style={{display:'flex',gap:12,fontSize:12,alignItems:'center'}}>
                                <span style={{color:'#555'}}>{fmtDate(p.date||p.createdAt)}</span>
                                <span style={{display:'inline-block',padding:'1px 7px',borderRadius:20,fontSize:11,fontWeight:600,
                                    background:p.isPaid?'rgba(74,222,128,0.12)':'rgba(234,179,8,0.12)',
                                    color:p.isPaid?'#4ade80':'#eab308',
                                    border:`1px solid ${p.isPaid?'#4ade80':'#eab308'}`}}>
                        {p.isPaid?'Full':'Partial'}
                      </span>
                                <span style={{color:'#4ade80',fontWeight:600}}>₹{fmt(p.amountPaid||p.amount)}</span>
                                {p.note && <span style={{color:'#555',fontSize:11}}>{p.note}</span>}
                            </div>
                            <button
                                className="btn btn-danger"
                                style={{padding:'2px 7px',fontSize:10}}
                                disabled={deletingId===p._id}
                                onClick={()=>deletePayment(p._id)}>
                                {deletingId===p._id?'…':'Del'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {open && (
                <div style={{border:'1px solid #2a2a2a',borderRadius:6,padding:12,marginTop:6,background:'#0e0e0e'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                        {[{val:'full',label:'Full',color:'#4ade80'},{val:'partial',label:'Partial',color:'#eab308'}].map(opt=>(
                            <div key={opt.val} onClick={()=>setForm(f=>({...f,paymentType:opt.val,amount:opt.val==='full'?String(remaining):f.amount}))}
                                 style={{border:`2px solid ${form.paymentType===opt.val?opt.color:'#2a2a2a'}`,borderRadius:6,padding:'6px 10px',cursor:'pointer',
                                     background:form.paymentType===opt.val?`${opt.color}18`:'transparent'}}>
                                <div style={{fontWeight:600,color:form.paymentType===opt.val?opt.color:'#888',fontSize:12}}>{opt.label}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:form.paymentType==='partial'?'1fr 1fr 1fr':'1fr 1fr',gap:8,marginBottom:8}}>
                        {form.paymentType==='partial' && (
                            <div className="form-group" style={{marginBottom:0}}>
                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Amount (₹)</label>
                                <input type="number" placeholder="0" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}
                                       style={{borderColor:overLimit?'#f87171':undefined}}/>
                                {overLimit && <div style={{fontSize:11,color:'#f87171',marginTop:2}}>Exceeds remaining ₹{fmt(remaining)}</div>}
                            </div>
                        )}
                        <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Date</label>
                            <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
                        </div>
                        <div className="form-group" style={{marginBottom:0}}>
                            <label style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Note</label>
                            <input placeholder="Optional" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={save} disabled={saving||overLimit}
                            style={{background:form.paymentType==='full'?'#16a34a':'#ca8a04',width:'100%',fontSize:12,padding:'8px'}}>
                        {saving?'Saving...':form.paymentType==='full'?'Mark Fully Paid':'Record Partial'}
                    </button>
                </div>
            )}

        </div>
    );
}

export default function Khet() {
    const [tab,               setTab]               = useState('customers');
    const [khetWeeklySummary, setKhetWeeklySummary] = useState(null);
    const [vehicles,  setVehicles]  = useState([]);
    const [staff,     setStaff]     = useState([]);
    const [materials, setMaterials] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [orders,    setOrders]    = useState([]);
    const [expandedCustomer, setExpandedCustomer] = useState(null);
    const [customerOrders,       setCustomerOrders]       = useState({});
    const [customerPayments,     setCustomerPayments]     = useState({});
    const [customerCarryForwards,setCustomerCarryForwards]= useState({});
    const [weeklyBill, setWeeklyBill] = useState(null);
    const [billDate,   setBillDate]   = useState(new Date().toISOString().slice(0,10));
    const [orderForm,  setOrderForm]  = useState(emptyOrder);
    const [dismissedVehicleNums, setDismissedVehicleNums] = useState([]);
    const [paymentForm,setPaymentForm]= useState(emptyPayment);
    const [modal,  setModal]  = useState(null);
    const [saving, setSaving] = useState(false);
    const [loading,setLoading]= useState(true);
    const [search, setSearch] = useState('');
    const [weekPrintDate, setWeekPrintDate] = useState(new Date().toISOString().slice(0,10));
    const [editingCustomer, setEditingCustomer] = useState(null); // { original: c, name: '', phone: '' }
    const [summaryViewMode,  setSummaryViewMode]  = useState('weekly'); // 'weekly' | 'daily'
    const [summarySearch,    setSummarySearch]    = useState('');
    const [billRangeMode,    setBillRangeMode]    = useState('weekly'); // 'weekly' | 'monthly' | 'custom'
    const [customRangeStart, setCustomRangeStart] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
    const [customRangeEnd,   setCustomRangeEnd]   = useState(new Date().toISOString().slice(0,10));

    const load = useCallback(async () => {
        try {
            const [fd, cd, od] = await Promise.all([
                api.get('/khet/form-data'),
                api.get('/khet/customers'),
                api.get('/khet/orders'),
            ]);
            setVehicles(fd.data.vehicles);
            setStaff(fd.data.staff);
            setMaterials(fd.data.materials || []);
            setCustomers(cd.data);
            setOrders(od.data);
        } catch { toast.error('Failed to load'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const loadCustomerOrders = async (name, phone) => {
        const key = name+'|'+phone;
        try {
            const currentWeekStart = resolveWeekStart(new Date());
            const [ordersRes, paymentsRes, carryRes] = await Promise.all([
                api.get(`/khet/customer-orders?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`),
                api.get(`/khet/customer-payments?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`),
                api.get(`/khet/customer-carry-forward?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone||'')}&weekStart=${currentWeekStart}`),
            ]);
            setCustomerOrders(prev=>({ ...prev, [key]:ordersRes.data }));
            setCustomerPayments(prev=>({ ...prev, [key]:paymentsRes.data }));
            setCustomerCarryForwards(prev=>({ ...prev, [key]: carryRes.data.carryForward || 0 }));
        } catch {}
    };

    const loadWeeklySummary = async (date) => {
        try {
            const { data } = await api.get(`/khet/summary/weekly?date=${date||billDate}`);
            setKhetWeeklySummary(data);
        } catch { toast.error('Failed to load summary'); }
    };

    // Load summary filtered by an explicit date range (monthly / custom)
    const loadRangeSummary = async (startDate, endDate) => {
        try {
            const res = await api.get(`/khet/summary/range?start=${startDate}&end=${endDate}`);
            setKhetWeeklySummary(res.data);
        } catch { toast.error('Failed to load summary'); }
    };

    const loadBill = async (date) => {
        try {
            const { data } = await api.get(`/khet/weekly-summary?date=${date}`);
            setWeeklyBill(data);
        } catch { toast.error('Failed to load bill'); }
    };

    const addVehicleRow = () => setOrderForm(f=>({ ...f, vehicles:[...f.vehicles, {...emptyVehicleRow}] }));
    const removeVehicleRow = (i) => setOrderForm(f=>({ ...f, vehicles:f.vehicles.filter((_,idx)=>idx!==i) }));
    const updateVehicleRow = (i, field, value) => setOrderForm(f=>{ const v=[...f.vehicles]; v[i]={...v[i],[field]:value}; return {...f,vehicles:v}; });

    const handleOrder = async () => {
        if (!orderForm.customerName) return toast.error('Enter customer name');
        setSaving(true);
        try {
            const validVehicles = orderForm.vehicles.map(v=>({
                vehicleId:    v.vehicleId||null,
                vehicleNumber:v.vehicleNumber||'',
                driverId:     v.driverId||null,
                conductorId:  v.conductorId||null,
                numberOfTrips:Number(v.numberOfTrips)||0,
                quantity:     Number(v.quantity)||0,
                rateApplied:  Number(v.rateApplied)||0,
                brassPerTrip: Number(v.brassPerTrip)||0,
            }));
            const result = await api.post('/khet/orders', { ...orderForm, vehicles:validVehicles });
            const sd = result.data.stockDeduct;
            if (sd?.done) {
                toast.success(`Order placed — ${sd.qty} ${sd.material} deducted from stock`);
            } else if (sd?.reason) {
                toast.success('Order placed');
                toast.error(`Stock not deducted: ${sd.reason}`, { duration: 6000 });
            } else {
                toast.success('Order placed');
            }
            setModal(null); setOrderForm(emptyOrder); setDismissedVehicleNums([]); setCustomerOrders({}); load();
        } catch (e) { toast.error(e.response?.data?.message||'Error'); }
        finally { setSaving(false); }
    };

    const handleDeleteOrder = async (id) => {
        try { await api.delete(`/khet/orders/${id}`); toast.success('Deleted'); setCustomerOrders({}); load(); }
        catch { toast.error('Error'); }
    };

    const handlePayment = async () => {
        if (!paymentForm.amount || Number(paymentForm.amount)<=0) return toast.error('Enter valid amount');
        const due = weeklyBill?.netDue || 0;
        if (paymentForm.paymentType==='partial' && Number(paymentForm.amount)>due) return toast.error(`Cannot exceed balance ₹${fmt(due)}`);
        setSaving(true);
        try {
            await api.post('/khet/payments', {
                amountPaid:   Number(paymentForm.amount),
                amount:       Number(paymentForm.amount),
                paymentType:  paymentForm.paymentType,
                isPaid:       paymentForm.paymentType === 'full',
                isPartial:    paymentForm.paymentType === 'partial',
                note:         paymentForm.note,
                customerName: '',
                customerPhone: '',
                weekStart:    billPayWeekStart,
            });
            toast.success('Payment recorded');
            setModal(null);
            await loadBill(billDate);
        } catch { toast.error('Error'); }
        finally { setSaving(false); }
    };

    const handleDeletePayment = async (id) => {
        try { await api.delete(`/khet/payments/${id}`); toast.success('Deleted'); await loadBill(billDate); }
        catch { toast.error('Error'); }
    };

    const handleDeleteCustomer = async (c) => {
        const confirmed = window.confirm(
            `Permanently delete "${c.name}"?\n\nThis will hard-delete ALL orders and payments for this customer and cannot be undone.`
        );
        if (!confirmed) return;
        try {
            const params = new URLSearchParams({ name: c.name });
            if (c.phone) params.append('phone', c.phone);
            await api.delete(`/khet/customers?${params.toString()}`);
            toast.success(`"${c.name}" and all their records deleted`);
            setExpandedCustomer(null);
            setCustomerOrders({});
            setCustomerPayments({});
            load();
        } catch { toast.error('Error deleting customer'); }
    };

    const handleEditCustomer = async () => {
        if (!editingCustomer) return;
        const { original, name, phone } = editingCustomer;
        if (!name.trim()) return toast.error('Name cannot be empty');
        setSaving(true);
        try {
            await api.put('/khet/customers', {
                originalName: original.name,
                originalPhone: original.phone || '',
                newName: name.trim(),
                newPhone: phone.trim(),
            });
            toast.success('Customer updated');
            setEditingCustomer(null);
            setExpandedCustomer(null);
            setCustomerOrders({});
            setCustomerPayments({});
            load();
        } catch (e) { toast.error(e.response?.data?.message || 'Error updating customer'); }
        finally { setSaving(false); }
    };

    const orderTotal = orderForm.vehicles.reduce((s, v)=>{
        const amt = orderForm.billingType==='Trip' ? (Number(v.numberOfTrips)||0)*(Number(v.rateApplied)||0) : (Number(v.quantity)||0)*(Number(v.rateApplied)||0);
        return s+amt;
    },0) + (Number(orderForm.royaltyQuantity)||0)*(Number(orderForm.royaltyRate)||0);

    const filteredCustomers = customers.filter(c=>
        c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    );

    const getRoyaltyAmt = (o) =>
        o.totalRoyalty || (Number(o.royaltyQuantity)||0) * (Number(o.royaltyRate)||0);

    const getWeekBoundsFor = (dateStr) => {
        const d = new Date(dateStr);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const start = new Date(d);
        start.setDate(d.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    };

    // ── Core print engine ──
    // Opens about:blank (same-origin) → document.write is allowed there (no React TrustedTypes context).
    // print() is triggered by a script inside that window, not by the React app, so no TrustedTypes block.
    // Logo src is a webpack asset URL (same localhost origin) so it loads correctly.
    const printBill = (bodyHtml, title = 'Khet Bill') => {
        const html = '<!DOCTYPE html><html><head><title>' + title + '</title>' +
            '<style>' + PRINT_CSS + '</style>' +
            '</head><body onload="window.print();">' +
            '<div class="company-header"><img src="' + logo + '" class="company-logo" alt="logo"/><div><div class="company">' + COMPANY + '</div><div class="owners">' + OWNERS + '</div></div></div>' +
            '<hr class="divider"/>' +
            bodyHtml +
            '<div class="sign-section">' +
            '<div><div class="sign-line">Owner Signature</div></div>' +
            '<div><div class="sign-line">Authorised Signature</div></div>' +
            '</div>' +
            '</body></html>';
        const win = window.open('', '_blank');
        if (!win) { toast.error('Allow popups for this site to print'); return; }
        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    // ── WhatsApp Share: render printHTML in iframe → capture full page → share as PDF ──
    const shareBillAsPdf = async (bodyHtml, title = 'Khet Bill') => {
        const fullHtml = '<!DOCTYPE html><html><head><title>' + title + '</title>' +
            '<style>' + PRINT_CSS + '</style>' +
            '</head><body>' +
            '<div class="company-header"><img src="' + logo + '" class="company-logo" alt="logo"/><div><div class="company">' + COMPANY + '</div><div class="owners">' + OWNERS + '</div></div></div>' +
            '<hr class="divider"/>' +
            bodyHtml +
            '<div class="sign-section">' +
            '<div><div class="sign-line">Owner Signature</div></div>' +
            '<div><div class="sign-line">Authorised Signature</div></div>' +
            '</div>' +
            '</body></html>';

        const pdfName = title.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.pdf';
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
                try { await navigator.share({ files: [pdfFile], title }); return; }
                catch (e) { if (e.name === 'AbortError') return; }
            }
            // Desktop: download then open WhatsApp
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

    // ── Helper: build order table rows for a list of orders ──
    const buildOrderRows = (orderList, showDate = true) => {
        let rows = '';
        orderList.forEach(o => {
            const vList   = o.vehicles.map(v=>v.vehicle?.vehicleNumber||v.vehicleNumber||'—').join(', ');
            const orderTrips = o.vehicles.reduce((s,v)=>s+(v.numberOfTrips||0),0);
            const orderQty   = o.vehicles.reduce((s,v)=>s+(v.quantity||0),0);
            const tripQty = o.billingType==='Trip' ? `${orderTrips} trips` : `${orderQty} ${o.quantityUnit}`;
            const royAmt  = getRoyaltyAmt(o);
            const dateTd  = showDate ? `<td>${fmtDate(o.date)}</td>` : '';
            // Compute rate per brass: use rateApplied from first vehicle, or derive from totalAmount/qty
            const firstRate = o.vehicles.find(v=>v.rateApplied>0)?.rateApplied || 0;
            const rateUnit  = o.billingType === 'Trip' ? 'trip' : (o.quantityUnit || 'brass');
            const rateLabel = firstRate > 0
                ? `₹${fmt(firstRate)}/${rateUnit}`
                : (o.totalAmount>0 && (o.billingType==='Trip' ? orderTrips : orderQty)>0
                    ? `₹${fmt(Math.round(o.totalAmount / (o.billingType==='Trip' ? orderTrips : orderQty)))}/${rateUnit}`
                    : '—');
            rows += `<tr>
        ${dateTd}
        <td>${o.material||'—'}</td>
        <td>${vList||'—'}</td>
        <td>${o.billingType}</td>
        <td><strong>${tripQty}</strong></td>
        <td style="color:#0369a1;font-weight:600;">${rateLabel}</td>
        <td>₹${fmt(o.totalAmount)}</td>
        <td>${royAmt>0?`₹${fmt(royAmt)}`:'—'}</td>
        <td><strong>₹${fmt(o.grandTotal||(o.totalAmount+royAmt))}</strong></td>
      </tr>`;
            if (royAmt > 0) {
                rows += `<tr class="royalty-row">
          <td colspan="${showDate?5:4}" style="padding-left:18px;">
            Royalty: ${o.royaltyQuantity} ${o.quantityUnit||'units'} × ₹${fmt(o.royaltyRate)} per unit
          </td>
          <td></td><td></td>
          <td colspan="2" style="font-weight:700;">Royalty = ₹${fmt(royAmt)}</td>
        </tr>`;
            }
        });
        return rows;
    };

    // ── Helper: build customer summary block (used by both Weekly Bill & Weekly Summary prints) ──
    const buildCustomerBlock = (custName, custPhone, orderList, allPayments, weekStart, weekEnd, carryForward = 0, showDates = true) => {
        const deliveryTotal = orderList.reduce((s,o)=>s+(o.totalAmount||0),0);
        const royTotal      = orderList.reduce((s,o)=>s+getRoyaltyAmt(o),0);
        const grandTotal    = deliveryTotal + royTotal;
        const carryFwd      = Number(carryForward) || 0;
        const netBill       = carryFwd + grandTotal;
        const custPayments  = (allPayments||[]).filter(p=>p.customerName===custName&&(p.customerPhone||'')===(custPhone||''));
        const paid          = custPayments.reduce((s,p)=>s+(p.amountPaid||p.amount||0),0);
        const balance       = Math.max(0, netBill - paid);

        let totalTrips = 0, totalQty = 0, firstUnit = null, mixedUnits = false;
        orderList.forEach(o => {
            if (o.billingType==='Trip') totalTrips += o.vehicles.reduce((s,v)=>s+(v.numberOfTrips||0),0);
            else {
                totalQty += o.vehicles.reduce((s,v)=>s+(v.quantity||0),0);
                if (!firstUnit) firstUnit = o.quantityUnit;
                else if (firstUnit !== o.quantityUnit) mixedUnits = true;
            }
        });
        const totalTripsSummary = totalTrips>0&&totalQty===0 ? `${totalTrips} trips`
            : totalQty>0&&totalTrips===0 ? `${totalQty} ${mixedUnits?'mixed units':(firstUnit||'units')}`
                : `${totalTrips} trips + ${totalQty} ${firstUnit||'units'}`;

        const dateHeader = showDates ? '<th>Date</th>' : '';
        const rows = buildOrderRows(orderList, showDates);

        // Payment details table — always shown (date + amount per payment, or "no payments" note)
        const payRows = custPayments.length > 0
            ? custPayments.map(p=>`
          <tr>
            <td>${fmtDate(p.date||p.createdAt)}</td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;
              background:${p.isPaid?'#dcfce7':'#fef9c3'};border:1px solid ${p.isPaid?'#86efac':'#fde047'};
              color:${p.isPaid?'#15803d':'#854d0e'};">${p.isPaid?'Full':'Partial'}</span></td>
            <td style="color:#15803d;font-weight:700;">&#8377;${fmt(p.amountPaid||p.amount)}</td>
            <td style="color:#64748b;">${p.note||'—'}</td>
          </tr>`).join('')
            : `<tr><td colspan="4" style="text-align:center;color:#94a3b8;font-style:italic;padding:10px;">No payments recorded this week</td></tr>`;
        const paymentDetails = `
        <div style="margin-top:10px;">
          <div style="font-size:11px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Payments This Week</div>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Amount Paid</th><th>Note</th></tr></thead>
            <tbody>${payRows}</tbody>
          </table>
        </div>`;

        return `
      <div class="cust-block">
        <div class="cust-header">
          <div>
            <div class="cust-name">${custName}</div>
            ${custPhone?`<div class="cust-phone">📞 ${custPhone}</div>`:''}
          </div>
          <div class="cust-totals">
            <div class="cust-total-box blue">
              <div class="lbl">This Week</div>
              <div class="val" style="font-size:14px;color:#1d4ed8;">₹${fmt(grandTotal)}</div>
            </div>
            ${carryFwd>0?`
            <div class="cust-total-box" style="background:#fff5f5;border-color:#fca5a5;">
              <div class="lbl" style="color:#dc2626;">⏮ Carry Fwd</div>
              <div class="val" style="font-size:14px;color:#dc2626;">₹${fmt(carryFwd)}</div>
            </div>`:'' }
            <div class="cust-total-box highlight">
              <div class="lbl">Balance Due</div>
              <div class="val">₹${fmt(balance)}</div>
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>${dateHeader}<th>Material</th><th>Vehicles</th><th>Type</th><th>Trips/Qty</th>
              <th>Rate</th><th>Delivery Amt</th><th>Royalty Amt</th><th>Grand Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="total-row">
              ${showDates?'<td>TOTAL</td>':''}
              <td colspan="${showDates?2:2}">TOTAL</td>
              <td></td>
              <td style="font-weight:900;">${totalTripsSummary}</td>
              <td></td>
              <td>₹${fmt(deliveryTotal)}</td>
              <td style="color:#fde68a;">₹${fmt(royTotal)}</td>
              <td>₹${fmt(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>

        <div class="summary">
          <div class="summary-row"><span>Total Trips / Qty</span><span style="font-weight:800;">${totalTripsSummary}</span></div>
          <div class="summary-row"><span>Delivery Total</span><span style="color:#1d4ed8;font-weight:700;">₹${fmt(deliveryTotal)}</span></div>
          ${royTotal>0?`<div class="summary-row royalty"><span>Total Royalty <span class="royalty-badge">ROYALTY</span></span><span>₹${fmt(royTotal)}</span></div>`:''}
          <div class="summary-row" style="font-weight:700;"><span>This Week Total</span><span>₹${fmt(grandTotal)}</span></div>
          ${carryFwd>0?`<div class="summary-row carry"><span>⏮ Carried Forward (prev. unpaid)</span><span>₹${fmt(carryFwd)}</span></div>`:''}
          ${carryFwd>0?`<div class="summary-row" style="font-weight:800;font-size:13px;"><span>Net Bill (incl. carry fwd)</span><span>₹${fmt(netBill)}</span></div>`:''}
          ${paid>0?`<div class="summary-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <div style="display:flex;justify-content:space-between;width:100%;"><span>Amount Paid</span><span style="color:#15803d;font-weight:700;"><span class="paid-chip">✓ Paid</span> &nbsp;₹${fmt(paid)}</span></div>
            ${custPayments.map(p=>`<div style="display:flex;justify-content:space-between;width:100%;padding-left:10px;font-size:11px;color:#475569;">
              <span>📅 ${fmtDate(p.date||p.createdAt)} &nbsp;·&nbsp; ${p.isPaid?'Full':'Partial'}</span>
              <span style="color:#15803d;font-weight:600;">₹${fmt(p.amountPaid||p.amount)}</span>
            </div>`).join('')}
          </div>`:''}

          <div class="summary-row grand"><span>Balance Due</span><span style="color:#c2410c;">₹${fmt(balance)}</span></div>
        </div>

        ${paymentDetails}
      </div>`;
    };

    // ── Print: single customer weekly bill (called from Customers tab & Weekly Summary tab) ──
    const printCustomerWeekly = (custName, custPhone, weekOrders, payments, weekStart, weekEnd, carryForward = 0) => {
        const body = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
        <div>
          <h3>Weekly Bill</h3>
          <p>Week: <strong>${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</strong></p>
        </div>
      </div>
      ${buildCustomerBlock(custName, custPhone, weekOrders, payments, weekStart, weekEnd, carryForward, true)}`;
        printBill(body, `Weekly Bill — ${custName}`);
    };

    // ── Print: single customer daily bill ──
    const printCustomerDaily = (custName, custPhone, date, ordersForDay) => {
        const deliveryTotal = ordersForDay.reduce((s,o)=>s+(o.totalAmount||0),0);
        const royTotal      = ordersForDay.reduce((s,o)=>s+getRoyaltyAmt(o),0);
        const grandTotal    = deliveryTotal + royTotal;
        const rows = buildOrderRows(ordersForDay, false);

        const body = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
        <div>
          <h3>Daily Bill</h3>
          <p>Customer: <strong>${custName}</strong>${custPhone?` &nbsp;·&nbsp; <strong>${custPhone}</strong>`:''}</p>
          <p>Date: <strong>${fmtDate(date)}</strong></p>
        </div>
        <div style="background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:12px 20px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Grand Total</div>
          <div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(grandTotal)}</div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th>Material</th><th>Vehicles</th><th>Type</th><th>Trips/Qty</th>
          <th>Rate</th><th>Delivery Amt</th><th>Royalty Amt</th><th>Grand Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div class="summary-row"><span>Delivery Amount</span><span style="color:#1d4ed8;font-weight:700;">₹${fmt(deliveryTotal)}</span></div>
        ${royTotal>0?`<div class="summary-row royalty"><span>Royalty Amount <span class="royalty-badge">ROYALTY</span></span><span>₹${fmt(royTotal)}</span></div>`:''}
        <div class="summary-row grand"><span>Grand Total</span><span>₹${fmt(grandTotal)}</span></div>
      </div>`;
        printBill(body, `Daily Bill — ${custName}`);
    };

    // ── Print: ALL customers — Weekly Summary (replaces printSection for weeklysummary tab) ──
    const printWeeklySummaryAll = () => {
        if (!khetWeeklySummary) return;
        const { customers, payments, weekStart, weekEnd, grandTotal, weekRoyalty, weekTrips, weekQty, weekPaid, carriedBalance, netDue } = khetWeeklySummary;

        const customerBlocks = customers.map(cs =>
            buildCustomerBlock(cs.customerName, cs.customerPhone, cs.orders, payments, weekStart, weekEnd, cs.carryForward||0, true)
        ).join('');

        const tripsLabel = (weekTrips||0)>0&&(weekQty||0)===0 ? 'Total Trips'
            : (weekQty||0)>0&&(weekTrips||0)===0 ? 'Total Qty' : 'Trips / Qty';
        const tripsVal = (weekTrips||0)>0&&(weekQty||0)===0 ? weekTrips
            : (weekQty||0)>0&&(weekTrips||0)===0 ? weekQty : `${weekTrips}t + ${weekQty}q`;

        const body = `
      <div style="margin-bottom:24px;">
        <h3 style="font-size:20px;margin-bottom:4px;">Khet Weekly Summary</h3>
        <p>Week: <strong>${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</strong></p>
      </div>

      ${carriedBalance>0?`<div class="carry-banner">⏮ Carried from previous week: <strong>₹${fmt(carriedBalance)}</strong></div>`:''}

      ${customerBlocks}

      <div class="grand-summary">
        <div class="grand-summary-title">Weekly Totals</div>
        <div class="grand-grid">
          <div class="grand-cell"><div class="lbl">${tripsLabel}</div><div class="val val-blue">${tripsVal}</div></div>
          <div class="grand-cell"><div class="lbl">Week Total</div><div class="val val-yellow">₹${fmt(grandTotal)}</div></div>
          <div class="grand-cell"><div class="lbl">Royalty</div><div class="val val-orange">₹${fmt(weekRoyalty||0)}</div></div>
          <div class="grand-cell"><div class="lbl">Carried Fwd</div><div class="val val-red">₹${fmt(carriedBalance)}</div></div>
          <div class="grand-cell"><div class="lbl">Paid</div><div class="val val-green">₹${fmt(weekPaid)}</div></div>
          <div class="grand-cell"><div class="lbl">Net Due</div><div class="val ${netDue===0?'val-green':'val-red'}">₹${fmt(netDue)}</div></div>
        </div>
      </div>`;

        printBill(body, 'Khet Weekly Summary');
    };

    // ── Print: ALL customers — Weekly Bill (replaces printSection for summary tab) ──
    const printWeeklyBillAll = () => {
        if (!weeklyBill) return;
        const { byCustomer, payments, weekStart, weekEnd, weekTotal, weekRoyalty, weekGrand, weekTrips, weekQty, weekPaid, carriedBalance, netDue } = weeklyBill;

        const customerBlocks = byCustomer.map(cg =>
            buildCustomerBlock(cg.name, cg.phone, cg.orders, payments, weekStart, weekEnd, cg.carryForward||0, true)
        ).join('');

        // Payments table
        let paymentsHtml = '';
        if (payments?.length > 0) {
            const rows = payments.map(p=>`<tr>
        <td>${fmtDay(p.date)}</td>
        <td>${p.customerName}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
          background:${p.isPaid?'rgba(21,128,61,0.1)':'rgba(133,77,14,0.1)'};
          color:${p.isPaid?'#15803d':'#854d0e'};
          border:1px solid ${p.isPaid?'#86efac':'#fde047'};">${p.isPaid?'Full':'Partial'}</span></td>
        <td style="color:#15803d;font-weight:700;">₹${fmt(p.amountPaid||p.amount)}</td>
        <td style="color:#64748b;">${p.note||'—'}</td>
      </tr>`).join('');
            paymentsHtml = `
        <div class="payments-section">
          <h4>Payments This Week</h4>
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
        }

        const tripsLabel = (weekTrips||0)>0&&(weekQty||0)===0?'Total Trips':(weekQty||0)>0&&(weekTrips||0)===0?'Total Qty':'Trips/Qty';
        const tripsVal   = (weekTrips||0)>0&&(weekQty||0)===0?weekTrips:(weekQty||0)>0&&(weekTrips||0)===0?weekQty:`${weekTrips}t+${weekQty}q`;

        const body = `
      <div style="margin-bottom:24px;">
        <h3 style="font-size:20px;margin-bottom:4px;">Khet Weekly Bill</h3>
        <p>Week: <strong>${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</strong></p>
      </div>

      ${carriedBalance>0?`<div class="carry-banner">⏮ Carried from previous week: <strong>₹${fmt(carriedBalance)}</strong></div>`:''}

      ${customerBlocks}

      ${paymentsHtml}

      <div class="grand-summary">
        <div class="grand-summary-title">Weekly Totals</div>
        <div class="grand-grid">
          <div class="grand-cell"><div class="lbl">${tripsLabel}</div><div class="val val-blue">${tripsVal}</div></div>
          <div class="grand-cell"><div class="lbl">Delivery</div><div class="val val-yellow">₹${fmt(weekTotal||weekGrand)}</div></div>
          <div class="grand-cell"><div class="lbl">Royalty</div><div class="val val-orange">₹${fmt(weekRoyalty||0)}</div></div>
          <div class="grand-cell"><div class="lbl">Carried</div><div class="val val-red">₹${fmt(carriedBalance)}</div></div>
          <div class="grand-cell"><div class="lbl">Paid</div><div class="val val-green">₹${fmt(weekPaid)}</div></div>
          <div class="grand-cell"><div class="lbl">Net Due</div><div class="val ${netDue===0?'val-green':'val-red'}">₹${fmt(netDue)}</div></div>
        </div>
      </div>`;

        printBill(body, 'Khet Weekly Bill');
    };

    const printCustomerWeeklyFromOrders = (c, allOrders, dateStr) => {
        const { start, end } = getWeekBoundsFor(dateStr);
        const weekOrders = allOrders.filter(o => {
            const d = new Date(o.date);
            return d >= start && d <= end;
        });
        if (weekOrders.length === 0) { toast.error('No orders for this customer in the selected week'); return; }
        const key = c.name+'|'+(c.phone||'');
        const cf = customerCarryForwards[key] || 0;
        const custPays = (customerPayments[key] || []).filter(p => { const d = new Date(p.date||p.createdAt); return d >= start && d <= end; });
        printCustomerWeekly(c.name, c.phone, weekOrders, custPays, start.toISOString(), end.toISOString(), cf);
    };

    if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Khet Billing</h1>
                <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-secondary" onClick={()=>{
                        const d=new Date(billDate); const dow=d.getDay(); d.setDate(d.getDate()-(dow===0?6:dow-1)); d.setHours(0,0,0,0);
                        setBillPayWeekStart(toLocalDateStr(d)); setBillPayWeekMonth(toLocalDateStr(d).slice(0,7));
                        setModal('payment');
                    }}>Payment</button>
                    <button className="btn btn-primary" onClick={()=>{setOrderForm(emptyOrder);setModal('order');}}>+ Place Order</button>
                </div>
            </div>

            <div className="stats-grid" style={{marginBottom:24}}>
                <div className="stat-card yellow"><div className="stat-icon">👥</div><div className="stat-info"><div className="stat-value">{customers.length}</div><div className="stat-label">Customers</div></div></div>
                <div className="stat-card blue"><div className="stat-icon">📦</div><div className="stat-info"><div className="stat-value">{orders.length}</div><div className="stat-label">Total Orders</div></div></div>
                <div className="stat-card green"><div className="stat-icon">💰</div><div className="stat-info"><div className="stat-value">₹{fmt(orders.reduce((s,o)=>s+(o.grandTotal||(o.totalAmount||0)+(o.totalRoyalty||0)),0))}</div><div className="stat-label">Total Amount</div></div></div>
                <div className="stat-card red"><div className="stat-icon">📅</div><div className="stat-info"><div className="stat-value"><button className="btn btn-secondary" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>{setTab('summary');loadBill(billDate);}}>View</button></div><div className="stat-label">Weekly Bill</div></div></div>
            </div>

            <div style={{display:'flex',gap:8,marginBottom:16}}>
                <button className={`btn ${tab==='customers'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('customers')}>Customers</button>
                <button className={`btn ${tab==='weeklysummary'?'btn-primary':'btn-secondary'}`} onClick={()=>{setTab('weeklysummary');loadWeeklySummary(billDate);}}>Weekly Summary</button>
                <button className={`btn ${tab==='summary'?'btn-primary':'btn-secondary'}`} onClick={()=>{setTab('summary');loadBill(billDate);}}>Weekly Bill</button>
            </div>

            {tab==='customers' && (
                <>
                    <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>
                        <input placeholder="Search by name or phone..." value={search} onChange={e=>setSearch(e.target.value)}
                               style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:8,padding:'10px 14px',color:'#e0e0e0',fontSize:14,flex:1,outline:'none'}}/>
                        <div style={{display:'flex',alignItems:'center',gap:8,background:'#141414',border:'1px solid #2a2a2a',borderRadius:8,padding:'6px 12px'}}>
                            <span style={{fontSize:12,color:'#555',whiteSpace:'nowrap'}}>Week for print:</span>
                            <input type="date" value={weekPrintDate} onChange={e=>setWeekPrintDate(e.target.value)}
                                   style={{background:'transparent',border:'none',color:'#e0e0e0',fontSize:13,outline:'none'}}/>
                        </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                        {filteredCustomers.length===0 && <div className="card" style={{textAlign:'center',color:'#444',padding:40}}>No customers yet.</div>}
                        {filteredCustomers.map((c,i)=>{
                            const key = c.name+'|'+c.phone;
                            const isOpen = expandedCustomer===key;
                            return (
                                <div key={i} className="card" style={{padding:0,overflow:'hidden'}}>
                                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',cursor:'pointer',background:isOpen?'#1a1800':'#141414'}}
                                         onClick={()=>{setExpandedCustomer(isOpen?null:key);if(!isOpen)loadCustomerOrders(c.name,c.phone);}}>
                                        <div style={{display:'flex',alignItems:'center',gap:14}}>
                                            <div style={{fontSize:22}}>{isOpen?'📂':'📁'}</div>
                                            <div>
                                                <div style={{fontWeight:700,color:'#f0f0f0',fontSize:15}}>{c.name}</div>
                                                <div style={{fontSize:12,color:'#666',marginTop:2}}>
                                                    {c.phone && <span style={{marginRight:12}}>📞 {c.phone}</span>}
                                                    <span>{c.orderCount} orders · ₹{fmt(c.totalAmount)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{display:'flex',alignItems:'center',gap:8}} onClick={e=>e.stopPropagation()}>
                                            <button className="btn btn-primary" style={{padding:'4px 12px',fontSize:11,fontWeight:700}}
                                                    onClick={()=>{
                                                        setOrderForm({...emptyOrder,customerName:c.name,customerPhone:c.phone||'',date:new Date().toISOString().slice(0,10)});
                                                        setModal('order');
                                                    }}>
                                                + Order
                                            </button>
                                            {customerOrders[key] && customerOrders[key].length > 0 && (
                                                <button className="btn btn-secondary" style={{padding:'4px 10px',fontSize:11}}
                                                        onClick={()=>printCustomerWeeklyFromOrders(c, customerOrders[key], weekPrintDate)}>
                                                    Print Weekly Bill
                                                </button>
                                            )}
                                            {customerOrders[key] && customerOrders[key].length > 0 && (() => {
                                                const { start, end } = getWeekBoundsFor(weekPrintDate);
                                                const wOrders = customerOrders[key].filter(o=>{const d=new Date(o.date);return d>=start&&d<=end;});
                                                if (wOrders.length === 0) return null;
                                                const key2 = c.name+'|'+(c.phone||'');
                                                const cf = customerCarryForwards[key2]||0;
                                                const custPays = (customerPayments[key2]||[]).filter(p=>{const d=new Date(p.date||p.createdAt);return d>=start&&d<=end;});
                                                const body = `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;"><div><h3>Weekly Bill</h3><p>Week: <strong>${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}</strong></p></div></div>${buildCustomerBlock(c.name,c.phone,wOrders,custPays,start.toISOString(),end.toISOString(),cf,true)}`;
                                                return (
                                                    <button title="Share on WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:500}}
                                                            onClick={()=>shareBillAsPdf(body,`Weekly Bill — ${c.name}`)}>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                                        WhatsApp
                                                    </button>
                                                );
                                            })()}
                                            <button className="btn btn-secondary" style={{padding:'4px 10px',fontSize:11,color:'#60a5fa',borderColor:'#1d4ed8'}}
                                                    onClick={()=>setEditingCustomer({original:c,name:c.name,phone:c.phone||''})}>
                                                ✏️ Edit
                                            </button>
                                            <button className="btn btn-danger" style={{padding:'4px 10px',fontSize:11}}
                                                    onClick={()=>handleDeleteCustomer(c)}>
                                                Delete
                                            </button>
                                            <span style={{color:'#444',fontSize:18}}>{isOpen?'▲':'▼'}</span>
                                        </div>
                                    </div>
                                    {isOpen && (
                                        <div>
                                            {!customerOrders[key] ? (
                                                <div style={{padding:16,color:'#444',fontSize:13}}>Loading...</div>
                                            ) : customerOrders[key].length===0 ? (
                                                <div style={{padding:16,color:'#444',fontSize:13,fontStyle:'italic'}}>No orders yet</div>
                                            ) : (
                                                <>
                                                    {(()=>{
                                                        // ── Group orders by week (Mon–Sun) ──
                                                        const getWkStart = (dateStr) => {
                                                            const d = new Date(dateStr);
                                                            const day = d.getDay();
                                                            d.setDate(d.getDate() + (day===0?-6:1-day));
                                                            d.setHours(0,0,0,0);
                                                            return d;
                                                        };
                                                        const weekMap = {};
                                                        customerOrders[key].forEach(o => {
                                                            const ws = getWkStart(o.date);
                                                            const we = new Date(ws); we.setDate(ws.getDate()+6);
                                                            const wKey = ws.toISOString();
                                                            if (!weekMap[wKey]) weekMap[wKey] = { ws, we, orders:[] };
                                                            weekMap[wKey].orders.push(o);
                                                        });
                                                        const weeks = Object.values(weekMap).sort((a,b)=>b.ws-a.ws);

                                                        return (
                                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                                                <thead>
                                                                <tr>{['Date','Type','Material','Vehicles','Trips/Qty','Delivery','Royalty','Grand Total',''].map(h=>(
                                                                    <th key={h} style={{padding:'8px 16px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>
                                                                ))}</tr>
                                                                </thead>
                                                                <tbody>
                                                                {weeks.map(({ ws, we, orders: wOrders }) => {
                                                                    const wTrips  = wOrders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
                                                                    const wDelivery = wOrders.reduce((s,o)=>s+(o.totalAmount||0),0);
                                                                    const wRoyalty  = wOrders.reduce((s,o)=>s+getRoyaltyAmt(o),0);
                                                                    const wTotal    = wOrders.reduce((s,o)=>s+(o.grandTotal||(o.totalAmount+getRoyaltyAmt(o))),0);
                                                                    return (
                                                                        <React.Fragment key={ws.toISOString()}>
                                                                            {/* ── Week header row ── */}
                                                                            <tr style={{background:'#0d1f3c'}}>
                                                                                <td colSpan={4} style={{padding:'7px 16px',color:'#60a5fa',fontWeight:700,fontSize:12,letterSpacing:'0.3px'}}>
                                                                                    📅 WEEK: {fmtDate(ws)} — {fmtDate(we)}
                                                                                </td>
                                                                                <td style={{padding:'7px 16px',color:'#60a5fa',fontWeight:700,fontSize:12}}>{wTrips} trips</td>
                                                                                <td style={{padding:'7px 16px',color:'#eab308',fontWeight:700,fontSize:12}}>₹{fmt(wDelivery)}</td>
                                                                                <td style={{padding:'7px 16px',color:'#d97706',fontWeight:700,fontSize:12}}>{wRoyalty>0?`₹${fmt(wRoyalty)}`:'—'}</td>
                                                                                <td style={{padding:'7px 16px',color:'#eab308',fontWeight:700,fontSize:12}}>₹{fmt(wTotal)}</td>
                                                                                <td style={{background:'#0d1f3c'}}></td>
                                                                            </tr>
                                                                            {/* ── Order rows ── */}
                                                                            {wOrders.map(o => {
                                                                                const royAmt = getRoyaltyAmt(o);
                                                                                return (
                                                                                    <tr key={o._id} style={{borderBottom:'1px solid #161616'}}>
                                                                                        <td style={{padding:'10px 16px',color:'#ccc'}}>{fmtDate(o.date)}</td>
                                                                                        <td style={{padding:'10px 16px'}}><span className={`badge ${o.billingType==='Trip'?'badge-blue':'badge-yellow'}`}>{o.billingType}</span></td>
                                                                                        <td style={{padding:'10px 16px',color:'#888'}}>{o.material||'—'}</td>
                                                                                        <td style={{padding:'10px 16px'}}>{o.vehicles.map((v,vi)=><span key={vi} className="badge badge-blue" style={{marginRight:4}}>{v.vehicle?.vehicleNumber||v.vehicleNumber||'—'}</span>)}</td>
                                                                                        <td style={{padding:'10px 16px',color:'#fff',fontWeight:600}}>
                                                                                            {o.billingType==='Trip' ? `${o.vehicles.reduce((s,v)=>s+(v.numberOfTrips||0),0)} trips` : `${o.vehicles.reduce((s,v)=>s+(v.quantity||0),0)} ${o.quantityUnit}`}
                                                                                        </td>
                                                                                        <td style={{padding:'10px 16px',color:'#eab308',fontWeight:600}}>₹{fmt(o.totalAmount)}</td>
                                                                                        <td style={{padding:'10px 16px'}}>
                                                                                            {royAmt > 0
                                                                                                ? <div>
                                                                                                    <div style={{color:'#d97706',fontWeight:700,fontSize:13}}>₹{fmt(royAmt)}</div>
                                                                                                    <div style={{fontSize:10,color:'#78716c',marginTop:1}}>{o.royaltyQuantity} × ₹{fmt(o.royaltyRate)}</div>
                                                                                                </div>
                                                                                                : <span style={{color:'#3a3a3a',fontSize:12}}>—</span>
                                                                                            }
                                                                                        </td>
                                                                                        <td style={{padding:'10px 16px',color:'#fbbf24',fontWeight:700,fontSize:14}}>
                                                                                            ₹{fmt(o.grandTotal||(o.totalAmount+royAmt))}
                                                                                        </td>
                                                                                        <td style={{padding:'10px 16px',display:'flex',gap:4}}>
                                                                                            <button className="btn btn-secondary" style={{padding:'3px 7px',fontSize:11}}
                                                                                                    onClick={()=>printCustomerDaily(c.name,c.phone,o.date,[o])}>Print</button>
                                                                                            <button title="WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:5,padding:'3px 7px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:3,fontSize:11}}
                                                                                                    onClick={()=>{
                                                                                                        const dTotal=o.totalAmount||0; const rTotal=getRoyaltyAmt(o);
                                                                                                        const rows=buildOrderRows([o],false);
                                                                                                        const body=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;"><div><h3>Daily Bill</h3><p>Customer: <strong>${c.name}</strong>${c.phone?` &nbsp;·&nbsp; <strong>${c.phone}</strong>`:''}</p><p>Date: <strong>${fmtDate(o.date)}</strong></p></div><div style="background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:12px 20px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Grand Total</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(dTotal+rTotal)}</div></div></div><table><thead><tr><th>Material</th><th>Vehicles</th><th>Type</th><th>Trips/Qty</th><th>Rate</th><th>Delivery Amt</th><th>Royalty Amt</th><th>Grand Total</th></tr></thead><tbody>${rows}</tbody></table><div class="summary"><div class="summary-row"><span>Delivery Amount</span><span style="color:#1d4ed8;font-weight:700;">₹${fmt(dTotal)}</span></div>${rTotal>0?`<div class="summary-row royalty"><span>Royalty Amount</span><span>₹${fmt(rTotal)}</span></div>`:''}<div class="summary-row grand"><span>Grand Total</span><span>₹${fmt(dTotal+rTotal)}</span></div></div>`;
                                                                                                        shareBillAsPdf(body,`Daily Bill — ${c.name}`);
                                                                                                    }}>
                                                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                                                                                WA
                                                                                            </button>
                                                                                            <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeleteOrder(o._id)}>Del</button>
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </React.Fragment>
                                                                    );
                                                                })}
                                                                </tbody>
                                                                <tfoot>
                                                                <tr style={{background:'#1a1a1a',borderTop:'2px solid #2a2a2a'}}>
                                                                    <td colSpan={5} style={{padding:'8px 16px',color:'#666',fontWeight:600,fontSize:12}}>Totals</td>
                                                                    <td style={{padding:'8px 16px',color:'#eab308',fontWeight:700}}>
                                                                        ₹{fmt(customerOrders[key].reduce((s,o)=>s+(o.totalAmount||0),0))}
                                                                    </td>
                                                                    <td style={{padding:'8px 16px',color:'#d97706',fontWeight:700}}>
                                                                        ₹{fmt(customerOrders[key].reduce((s,o)=>s+getRoyaltyAmt(o),0))}
                                                                    </td>
                                                                    <td style={{padding:'8px 16px',color:'#fbbf24',fontWeight:700,fontSize:14}}>
                                                                        ₹{fmt(customerOrders[key].reduce((s,o)=>s+(o.grandTotal||(o.totalAmount+getRoyaltyAmt(o))),0))}
                                                                    </td>
                                                                    <td></td>
                                                                </tr>
                                                                </tfoot>
                                                            </table>
                                                        );
                                                    })()}

                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {tab==='weeklysummary' && (
                <div>
                    {/* ── Date Range Mode Bar ── */}
                    <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
                        {[
                            { id:'weekly',  label:'📅 Weekly' },
                            { id:'monthly', label:'🗓️ Monthly' },
                            { id:'custom',  label:'📐 Custom' },
                        ].map(m=>(
                            <button key={m.id}
                                    className={`btn ${billRangeMode===m.id?'btn-primary':'btn-secondary'}`}
                                    onClick={()=>{
                                        setBillRangeMode(m.id);
                                        setKhetWeeklySummary(null);
                                        if (m.id==='monthly') {
                                            const d = billDate ? new Date(billDate) : new Date();
                                            const ms = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10);
                                            const me = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
                                            setCustomRangeStart(ms); setCustomRangeEnd(me);
                                        }
                                    }}>
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Controls Row ── */}
                    <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                        {billRangeMode==='weekly' && (
                            <input type="date" value={billDate}
                                   onChange={e=>{setBillDate(e.target.value);if(e.target.value)loadWeeklySummary(e.target.value);}}
                                   style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                        )}

                        {billRangeMode==='monthly' && (
                            <>
                                <input type="month"
                                       value={customRangeStart.slice(0,7)}
                                       onChange={e=>{
                                           if (!e.target.value) return;
                                           const [yr,mo] = e.target.value.split('-').map(Number);
                                           if (!yr || !mo || isNaN(yr) || isNaN(mo)) return;
                                           const ms = new Date(yr,mo-1,1).toISOString().slice(0,10);
                                           const me = new Date(yr,mo,0).toISOString().slice(0,10);
                                           setCustomRangeStart(ms); setCustomRangeEnd(me);
                                       }}
                                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                                <span style={{color:'#555',fontSize:13}}>{customRangeStart && customRangeEnd ? `${fmtDate(customRangeStart)} → ${fmtDate(customRangeEnd)}` : ''}</span>
                            </>
                        )}

                        {billRangeMode==='custom' && (
                            <>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <label style={{fontSize:12,color:'#888'}}>From</label>
                                    <input type="date" value={customRangeStart}
                                           onChange={e=>setCustomRangeStart(e.target.value)}
                                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                                </div>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <label style={{fontSize:12,color:'#888'}}>To</label>
                                    <input type="date" value={customRangeEnd}
                                           onChange={e=>setCustomRangeEnd(e.target.value)}
                                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                                </div>
                            </>
                        )}

                        <button className="btn btn-primary" onClick={()=>{
                            if (billRangeMode==='weekly') loadWeeklySummary(billDate);
                            else loadRangeSummary(customRangeStart, customRangeEnd);
                        }}>Refresh</button>

                        <input placeholder="Search customer..." value={summarySearch} onChange={e=>setSummarySearch(e.target.value)}
                               style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13,flex:1,minWidth:160,outline:'none'}}/>

                        {/* ── Daily/Weekly order view toggle (only for weekly range mode) ── */}
                        {billRangeMode==='weekly' && (<>
                            <button
                                className={`btn ${summaryViewMode==='weekly'?'btn-primary':'btn-secondary'}`}
                                onClick={()=>setSummaryViewMode('weekly')}>
                                📅 Weekly
                            </button>
                            <button
                                className={`btn ${summaryViewMode==='daily'?'btn-primary':'btn-secondary'}`}
                                onClick={()=>setSummaryViewMode('daily')}>
                                📆 Daily
                            </button>
                        </>)}

                        {khetWeeklySummary && (
                            <button className="btn btn-secondary" onClick={printWeeklySummaryAll}>Print Summary</button>
                        )}
                        {khetWeeklySummary && (
                            <button title="Share on WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:500}}
                                    onClick={()=>{
                                        const {customers,payments,weekStart,weekEnd,grandTotal,weekRoyalty,weekTrips,weekQty,weekPaid,carriedBalance,netDue}=khetWeeklySummary;
                                        const blocks=customers.map(cs=>buildCustomerBlock(cs.customerName,cs.customerPhone,cs.orders,payments,weekStart,weekEnd,cs.carryForward||0,true)).join('');
                                        const tLabel=(weekTrips||0)>0&&(weekQty||0)===0?'Total Trips':(weekQty||0)>0&&(weekTrips||0)===0?'Total Qty':'Trips / Qty';
                                        const tVal=(weekTrips||0)>0&&(weekQty||0)===0?weekTrips:(weekQty||0)>0&&(weekTrips||0)===0?weekQty:`${weekTrips}t + ${weekQty}q`;
                                        const body=`<div style="margin-bottom:24px;"><h3 style="font-size:20px;margin-bottom:4px;">Khet Weekly Summary</h3><p>Week: <strong>${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</strong></p></div>${carriedBalance>0?`<div class="carry-banner">⏮ Carried from previous week: <strong>₹${fmt(carriedBalance)}</strong></div>`:''}${blocks}<div class="grand-summary"><div class="grand-summary-title">Weekly Totals</div><div class="grand-grid"><div class="grand-cell"><div class="lbl">${tLabel}</div><div class="val val-blue">${tVal}</div></div><div class="grand-cell"><div class="lbl">Week Total</div><div class="val val-yellow">₹${fmt(grandTotal)}</div></div><div class="grand-cell"><div class="lbl">Royalty</div><div class="val val-orange">₹${fmt(weekRoyalty||0)}</div></div><div class="grand-cell"><div class="lbl">Carried Fwd</div><div class="val val-red">₹${fmt(carriedBalance)}</div></div><div class="grand-cell"><div class="lbl">Paid</div><div class="val val-green">₹${fmt(weekPaid)}</div></div><div class="grand-cell"><div class="lbl">Net Due</div><div class="val ${netDue===0?'val-green':'val-red'}">₹${fmt(netDue)}</div></div></div></div>`;
                                        shareBillAsPdf(body,'Khet Weekly Summary');
                                    }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                WhatsApp Summary
                            </button>
                        )}
                    </div>
                    {!khetWeeklySummary ? <div className="card" style={{color:'#444',textAlign:'center',padding:32}}>
                        {billRangeMode==='weekly' ? 'Select date and refresh' : billRangeMode==='monthly' ? 'Select month and refresh' : 'Select date range and refresh'}
                    </div> : (
                        <div>
                            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:16}}>
                                {(()=>{
                                    // In daily mode, compute totals only from the selected day's orders
                                    const allVisibleOrders = (billRangeMode==='weekly' && summaryViewMode==='daily')
                                        ? khetWeeklySummary.customers.flatMap(cs=>cs.orders.filter(o=>(o.date||'').slice(0,10)===billDate))
                                        : null; // null means use server weekly totals
                                    const dayTrips = allVisibleOrders ? allVisibleOrders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0) : (khetWeeklySummary.weekTrips||0);
                                    const dayQty   = allVisibleOrders ? allVisibleOrders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0) : (khetWeeklySummary.weekQty||0);
                                    const dayTotal = allVisibleOrders ? allVisibleOrders.reduce((s,o)=>s+(o.grandTotal||(o.totalAmount+getRoyaltyAmt(o))),0) : khetWeeklySummary.grandTotal;
                                    const dayRoyalty = allVisibleOrders ? allVisibleOrders.reduce((s,o)=>s+getRoyaltyAmt(o),0) : (khetWeeklySummary.weekRoyalty||0);
                                    const tripsVal = dayTrips>0&&dayQty===0?`${dayTrips}`:(dayQty>0&&dayTrips===0?`${dayQty}`:`${dayTrips+dayQty}`);
                                    const tripsLabel = dayTrips>0?'Total Trips':'Total Qty';
                                    return (<>
                                        <div className="stat-card blue"><div className="stat-icon">🚛</div><div className="stat-info"><div className="stat-value">{tripsVal}</div><div className="stat-label">{tripsLabel}</div></div></div>
                                        <div className="stat-card yellow"><div className="stat-icon">💰</div><div className="stat-info"><div className="stat-value">₹{fmt(dayTotal)}</div><div className="stat-label">{billRangeMode==='weekly'?(summaryViewMode==='daily'?'Day Total':'Week Total'):billRangeMode==='monthly'?'Month Total':'Range Total'}</div></div></div>
                                        <div className="stat-card" style={{background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)'}}><div className="stat-icon">👑</div><div className="stat-info"><div className="stat-value" style={{color:'#d97706'}}>{fmt(Math.round(dayRoyalty/1500))}</div><div className="stat-label">Royalty Qty</div></div></div>
                                        <div className="stat-card red"><div className="stat-icon">⏮</div><div className="stat-info"><div className="stat-value">₹{fmt(khetWeeklySummary.carriedBalance)}</div><div className="stat-label">Carried Fwd</div></div></div>
                                        <div className="stat-card green"><div className="stat-icon">✅</div><div className="stat-info"><div className="stat-value">₹{fmt(khetWeeklySummary.weekPaid)}</div><div className="stat-label">Paid</div></div></div>
                                        <div className="stat-card red"><div className="stat-icon">⏳</div><div className="stat-info"><div className="stat-value">₹{fmt(khetWeeklySummary.netDue)}</div><div className="stat-label">Net Due</div></div></div>
                                    </>);
                                })()}
                            </div>
                            <div style={{display:'flex',flexDirection:'column',gap:8}}>
                                {khetWeeklySummary.customers.length===0 && <div className="card" style={{color:'#444',textAlign:'center',padding:32}}>
                                    {billRangeMode==='weekly' ? 'No orders this week' : billRangeMode==='monthly' ? 'No orders this month' : 'No orders in selected range'}
                                </div>}
                                {khetWeeklySummary.customers.filter(cs=>cs.customerName.toLowerCase().includes(summarySearch.toLowerCase())).map((cs,i)=>{
                                    // ── Filter orders by daily date if in daily mode (weekly range only) ──
                                    const visibleOrders = (billRangeMode==='weekly' && summaryViewMode==='daily')
                                        ? cs.orders.filter(o => (o.date||'').slice(0,10) === billDate)
                                        : cs.orders;
                                    // Hide customer card entirely if daily mode and no orders that day
                                    if (billRangeMode==='weekly' && summaryViewMode==='daily' && visibleOrders.length===0) return null;
                                    const dayTotal    = visibleOrders.reduce((s,o)=>s+(o.totalAmount||0),0);
                                    const dayRoyalty  = visibleOrders.reduce((s,o)=>s+getRoyaltyAmt(o),0);
                                    const dayGrand    = visibleOrders.reduce((s,o)=>s+(o.grandTotal||(o.totalAmount+getRoyaltyAmt(o))),0);
                                    return (
                                        <div key={i} className="card" style={{padding:0,overflow:'hidden'}}>
                                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',background:'#141414'}}>
                                                <div>
                                                    <div style={{fontWeight:700,color:'#f0f0f0',fontSize:15}}>{cs.customerName}</div>
                                                    {cs.customerPhone && <div style={{fontSize:12,color:'#666'}}>📞 {cs.customerPhone}</div>}
                                                </div>
                                                <div style={{display:'flex',gap:12,alignItems:'center'}}>
                                                    <div style={{textAlign:'center'}}><div style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Orders</div><div style={{color:'#fff',fontWeight:600}}>{visibleOrders.length}</div></div>
                                                    <div style={{textAlign:'center'}}>
                                                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Delivery</div>
                                                        <div style={{color:'#eab308',fontWeight:700,fontSize:13}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.total:dayTotal)}</div>
                                                    </div>
                                                    {((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.royalty:dayRoyalty)>0 && (
                                                        <div style={{textAlign:'center'}}>
                                                            <div style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Royalty</div>
                                                            <div style={{color:'#d97706',fontWeight:700,fontSize:13}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.royalty:dayRoyalty)}</div>
                                                        </div>
                                                    )}
                                                    <div style={{textAlign:'center'}}>
                                                        <div style={{fontSize:11,color:'#555',textTransform:'uppercase'}}>Grand Total</div>
                                                        <div style={{color:'#fbbf24',fontWeight:700,fontSize:16}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.grandTotal:dayGrand)}</div>
                                                    </div>
                                                    <button className="btn btn-secondary" style={{padding:'4px 10px',fontSize:11}}
                                                            onClick={()=>printCustomerWeekly(cs.customerName,cs.customerPhone,cs.orders,khetWeeklySummary.payments||[],khetWeeklySummary.weekStart,khetWeeklySummary.weekEnd,cs.carryForward||0)}>
                                                        Print
                                                    </button>
                                                    <button title="WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:500}}
                                                            onClick={()=>{
                                                                const body=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;"><div><h3>Weekly Bill</h3><p>Week: <strong>${fmtDate(khetWeeklySummary.weekStart)} to ${fmtDate(khetWeeklySummary.weekEnd)}</strong></p></div></div>${buildCustomerBlock(cs.customerName,cs.customerPhone,cs.orders,khetWeeklySummary.payments||[],khetWeeklySummary.weekStart,khetWeeklySummary.weekEnd,cs.carryForward||0,true)}`;
                                                                shareBillAsPdf(body,`Weekly Bill — ${cs.customerName}`);
                                                            }}>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                                        WA
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="table-wrap">
                                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                                    <thead>
                                                    <tr>
                                                        {['Date','Type','Material','Vehicles','Trips/Qty','Delivery Amt','Royalty Amt','Grand Total'].map(h=>(
                                                            <th key={h} style={{padding:'7px 14px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>
                                                        ))}
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                    {visibleOrders.map((o)=>{
                                                        const royAmt = getRoyaltyAmt(o);
                                                        return (
                                                            <tr key={o._id}>
                                                                <td style={{padding:'9px 14px',color:'#ccc',borderBottom:'1px solid #161616'}}>{fmtDate(o.date)}</td>
                                                                <td style={{padding:'9px 14px',borderBottom:'1px solid #161616'}}><span className={`badge ${o.billingType==='Trip'?'badge-blue':'badge-yellow'}`}>{o.billingType}</span></td>
                                                                <td style={{padding:'9px 14px',color:'#888',borderBottom:'1px solid #161616'}}>{o.material||'—'}</td>
                                                                <td style={{padding:'9px 14px',borderBottom:'1px solid #161616'}}>{o.vehicles.map((v,vi)=><span key={vi} className="badge badge-blue" style={{marginRight:4}}>{v.vehicle?.vehicleNumber||v.vehicleNumber||'—'}</span>)}</td>
                                                                <td style={{padding:'9px 14px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>
                                                                    {o.billingType==='Trip'
                                                                        ? `${o.vehicles.reduce((s,v)=>s+(v.numberOfTrips||0),0)} trips`
                                                                        : `${o.vehicles.reduce((s,v)=>s+(v.quantity||0),0)} ${o.quantityUnit}`}
                                                                </td>
                                                                <td style={{padding:'9px 14px',borderBottom:'1px solid #161616',color:'#eab308',fontWeight:600}}>₹{fmt(o.totalAmount)}</td>
                                                                <td style={{padding:'9px 14px',borderBottom:'1px solid #161616'}}>
                                                                    {royAmt>0
                                                                        ? <div>
                                                                            <div style={{color:'#d97706',fontWeight:700}}>₹{fmt(royAmt)}</div>
                                                                            <div style={{fontSize:10,color:'#78716c'}}>{o.royaltyQuantity} × ₹{fmt(o.royaltyRate)}</div>
                                                                        </div>
                                                                        : <span style={{color:'#3a3a3a'}}>—</span>
                                                                    }
                                                                </td>
                                                                <td style={{padding:'9px 14px',borderBottom:'1px solid #161616',color:'#fbbf24',fontWeight:700}}>
                                                                    ₹{fmt(o.grandTotal||(o.totalAmount+royAmt))}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    </tbody>
                                                    <tfoot>
                                                    <tr style={{background:'#1a1a1a',borderTop:'2px solid #2a2a2a'}}>
                                                        <td colSpan={3} style={{padding:'8px 14px',color:'#666',fontWeight:600,fontSize:12}}>Total</td>
                                                        <td style={{padding:'8px 14px'}}></td>
                                                        <td style={{padding:'8px 14px',color:'#fff',fontWeight:800,fontSize:13}}>
                                                            {(() => {
                                                                const trips = visibleOrders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
                                                                const qty   = visibleOrders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0);
                                                                if (trips>0 && qty===0) return trips+' trips';
                                                                if (qty>0 && trips===0) return qty+' '+(visibleOrders.find(o=>o.quantityUnit)?.quantityUnit||'units');
                                                                return trips+' trips + '+qty+' units';
                                                            })()}
                                                        </td>
                                                        <td style={{padding:'8px 14px',color:'#eab308',fontWeight:700}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.total:dayTotal)}</td>
                                                        <td style={{padding:'8px 14px',color:'#d97706',fontWeight:700}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.royalty:dayRoyalty)}</td>
                                                        <td style={{padding:'8px 14px',color:'#fbbf24',fontWeight:700}}>₹{fmt((billRangeMode==='weekly'&&summaryViewMode==='weekly')?cs.grandTotal:dayGrand)}</td>
                                                    </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                            <div style={{padding:'10px 16px',background:'#0a0a0a'}}>
                                                <CustPaySection
                                                    custName={cs.customerName} custPhone={cs.customerPhone}
                                                    weekStart={khetWeeklySummary.weekStart}
                                                    orders={cs.orders} allPayments={khetWeeklySummary.payments||[]}
                                                    carryForward={cs.carryForward || 0}
                                                    overrideDue={cs.netDue}
                                                    onPaySaved={()=>billRangeMode==='weekly'?loadWeeklySummary(billDate):loadRangeSummary(customRangeStart,customRangeEnd)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab==='summary' && (
                <div className="card">
                    <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                        <input type="date" value={billDate} onChange={e=>{setBillDate(e.target.value);if(e.target.value)loadBill(e.target.value);}}
                               style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                        <button className="btn btn-secondary" onClick={()=>loadBill(billDate)}>Refresh</button>
                        <button className="btn btn-secondary" onClick={()=>{
                            const d=new Date(billDate); const dow=d.getDay(); d.setDate(d.getDate()-(dow===0?6:dow-1)); d.setHours(0,0,0,0);
                            setBillPayWeekStart(toLocalDateStr(d)); setBillPayWeekMonth(toLocalDateStr(d).slice(0,7));
                            setModal('payment');
                        }}>Payment</button>
                        {weeklyBill && <button className="btn btn-primary" onClick={printWeeklyBillAll}>Print All</button>}
                        {weeklyBill && (
                            <button title="Share on WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:500}}
                                    onClick={()=>{
                                        const {byCustomer,payments,weekStart,weekEnd,weekTotal,weekRoyalty,weekGrand,weekTrips,weekQty,weekPaid,carriedBalance,netDue}=weeklyBill;
                                        const blocks=byCustomer.map(cg=>buildCustomerBlock(cg.name,cg.phone,cg.orders,payments,weekStart,weekEnd,cg.carryForward||0,true)).join('');
                                        let payHtml='';
                                        if(payments?.length>0){const rows=payments.map(p=>`<tr><td>${fmtDay(p.date)}</td><td>${p.customerName}</td><td>${p.isPaid?'Full':'Partial'}</td><td style="color:#15803d;font-weight:700;">₹${fmt(p.amountPaid||p.amount)}</td><td>${p.note||'—'}</td></tr>`).join('');payHtml=`<div class="payments-section"><h4>Payments This Week</h4><table><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;}
                                        const tLabel=(weekTrips||0)>0&&(weekQty||0)===0?'Total Trips':(weekQty||0)>0&&(weekTrips||0)===0?'Total Qty':'Trips/Qty';
                                        const tVal=(weekTrips||0)>0&&(weekQty||0)===0?weekTrips:(weekQty||0)>0&&(weekTrips||0)===0?weekQty:`${weekTrips}t+${weekQty}q`;
                                        const body=`<div style="margin-bottom:24px;"><h3 style="font-size:20px;margin-bottom:4px;">Khet Weekly Bill</h3><p>Week: <strong>${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</strong></p></div>${carriedBalance>0?`<div class="carry-banner">⏮ Carried from previous week: <strong>₹${fmt(carriedBalance)}</strong></div>`:''}${blocks}${payHtml}<div class="grand-summary"><div class="grand-summary-title">Weekly Totals</div><div class="grand-grid"><div class="grand-cell"><div class="lbl">${tLabel}</div><div class="val val-blue">${tVal}</div></div><div class="grand-cell"><div class="lbl">Delivery</div><div class="val val-yellow">₹${fmt(weekTotal||weekGrand)}</div></div><div class="grand-cell"><div class="lbl">Royalty</div><div class="val val-orange">₹${fmt(weekRoyalty||0)}</div></div><div class="grand-cell"><div class="lbl">Carried</div><div class="val val-red">₹${fmt(carriedBalance)}</div></div><div class="grand-cell"><div class="lbl">Paid</div><div class="val val-green">₹${fmt(weekPaid)}</div></div><div class="grand-cell"><div class="lbl">Net Due</div><div class="val ${netDue===0?'val-green':'val-red'}">₹${fmt(netDue)}</div></div></div></div>`;
                                        shareBillAsPdf(body,'Khet Weekly Bill');
                                    }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                WhatsApp All
                            </button>
                        )}
                    </div>

                    {!weeklyBill ? <div style={{color:'#444',textAlign:'center',padding:32}}>Select date and refresh</div> : (
                        <div>
                            <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:12,marginBottom:16}}>
                                <div style={{fontSize:20,fontWeight:700,color:'#f0f0f0'}}>Khet Weekly Bill</div>
                                <div style={{fontSize:13,color:'#888',marginTop:4}}>Week: {fmtDate(weeklyBill.weekStart)} to {fmtDate(weeklyBill.weekEnd)}</div>
                            </div>

                            {weeklyBill.carriedBalance>0 && (
                                <div style={{background:'#1a0a00',border:'1px solid #3a1a00',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13}}>
                                    Carried from previous week: <strong style={{color:'#f87171'}}>₹{fmt(weeklyBill.carriedBalance)}</strong>
                                </div>
                            )}

                            {weeklyBill.byCustomer.map((cg,gi)=>{
                                const royTotal  = cg.royalty || cg.orders.reduce((s,o)=>s+getRoyaltyAmt(o),0);
                                const custGrand = cg.grandTotal || (cg.total + royTotal);
                                const custCarry = cg.carryForward || 0;
                                const custNetBill = custCarry + custGrand;
                                const custPaid  = (weeklyBill.payments||[]).filter(p=>p.customerName===cg.name&&p.customerPhone===(cg.phone||'')).reduce((s,p)=>s+(p.amountPaid||p.amount||0),0);
                                const custBalance = Math.max(0, custNetBill - custPaid);
                                return (
                                    <div key={gi} style={{marginBottom:16,border:'1px solid #1e1e1e',borderRadius:8,overflow:'hidden'}}>
                                        <div style={{background:'#1a1a1a',padding:'8px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                            <div>
                                                <span style={{fontWeight:700,color:'#f0f0f0',fontSize:14}}>{cg.name}</span>
                                                {cg.phone && <span style={{color:'#666',fontSize:12,marginLeft:10}}>📞 {cg.phone}</span>}
                                            </div>
                                            <div style={{display:'flex',gap:12,alignItems:'center'}}>
                                                {royTotal>0 && (
                                                    <div style={{textAlign:'center'}}>
                                                        <div style={{fontSize:10,color:'#78716c',textTransform:'uppercase'}}>Royalty</div>
                                                        <div style={{color:'#d97706',fontWeight:700,fontSize:13}}>₹{fmt(royTotal)}</div>
                                                    </div>
                                                )}
                                                <div style={{textAlign:'center'}}>
                                                    <div style={{fontSize:10,color:'#666',textTransform:'uppercase'}}>This Week</div>
                                                    <div style={{color:'#fbbf24',fontWeight:700,fontSize:14}}>₹{fmt(custGrand)}</div>
                                                </div>
                                                {custCarry>0 && (
                                                    <div style={{textAlign:'center',background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:6,padding:'4px 10px'}}>
                                                        <div style={{fontSize:10,color:'#f87171',textTransform:'uppercase'}}>⏮ Carry Fwd</div>
                                                        <div style={{color:'#f87171',fontWeight:700,fontSize:14}}>₹{fmt(custCarry)}</div>
                                                    </div>
                                                )}
                                                {custCarry>0 && (
                                                    <div style={{textAlign:'center',background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:6,padding:'4px 10px'}}>
                                                        <div style={{fontSize:10,color:'#fbbf24',textTransform:'uppercase'}}>Net Due</div>
                                                        <div style={{color:'#fbbf24',fontWeight:800,fontSize:16}}>₹{fmt(custNetBill)}</div>
                                                    </div>
                                                )}
                                                {custCarry===0 && (
                                                    <div style={{textAlign:'center'}}>
                                                        <div style={{fontSize:10,color:'#666',textTransform:'uppercase'}}>Grand Total</div>
                                                        <div style={{color:'#fbbf24',fontWeight:700,fontSize:16}}>₹{fmt(custGrand)}</div>
                                                    </div>
                                                )}
                                                <button className="btn btn-secondary" style={{padding:'3px 8px',fontSize:11}}
                                                        onClick={()=>printCustomerWeekly(cg.name,cg.phone,cg.orders,weeklyBill.payments||[],weeklyBill.weekStart,weeklyBill.weekEnd,custCarry)}>
                                                    Print
                                                </button>
                                                <button title="WhatsApp" style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:500}}
                                                        onClick={()=>{
                                                            const body=`<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;"><div><h3>Weekly Bill</h3><p>Week: <strong>${fmtDate(weeklyBill.weekStart)} to ${fmtDate(weeklyBill.weekEnd)}</strong></p></div></div>${buildCustomerBlock(cg.name,cg.phone,cg.orders,weeklyBill.payments||[],weeklyBill.weekStart,weeklyBill.weekEnd,custCarry,true)}`;
                                                            shareBillAsPdf(body,`Weekly Bill — ${cg.name}`);
                                                        }}>
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                                                    WA
                                                </button>
                                            </div>
                                        </div>
                                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                            <thead>
                                            <tr>
                                                {['Date','Material','Vehicles','Type','Trips/Qty','Rate','Delivery Amt','Royalty Amt','Grand Total'].map(h=>(
                                                    <th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>
                                                ))}
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {cg.orders.map((o)=>{
                                                const royAmt = getRoyaltyAmt(o);
                                                return (
                                                    <React.Fragment key={o._id}>
                                                        {o.vehicles.map((v,vi)=>(
                                                            <tr key={`${o._id}-${vi}`}>
                                                                {vi===0 && <td rowSpan={o.vehicles.length} style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616',verticalAlign:'top'}}>{fmtDay(o.date)}</td>}
                                                                {vi===0 && <td rowSpan={o.vehicles.length} style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616',verticalAlign:'top'}}>{o.material||'—'}</td>}
                                                                <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{v.vehicle?.vehicleNumber||v.vehicleNumber||'—'}</td>
                                                                <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}><span className={`badge ${o.billingType==='Trip'?'badge-blue':'badge-yellow'}`}>{o.billingType}</span></td>
                                                                <td style={{padding:'9px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{o.billingType==='Trip'?`${v.numberOfTrips} trips`:`${v.quantity} ${o.quantityUnit}`}</td>
                                                                <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(v.rateApplied)}</td>
                                                                <td style={{padding:'9px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(v.totalAmount)}</td>
                                                                {vi===0 && (
                                                                    <td rowSpan={o.vehicles.length} style={{padding:'9px 12px',borderBottom:'1px solid #161616',verticalAlign:'top'}}>
                                                                        {royAmt>0
                                                                            ? <div>
                                                                                <div style={{color:'#d97706',fontWeight:700}}>₹{fmt(royAmt)}</div>
                                                                                <div style={{fontSize:10,color:'#78716c',marginTop:2}}>{o.royaltyQuantity} {o.quantityUnit} × ₹{fmt(o.royaltyRate)}</div>
                                                                            </div>
                                                                            : <span style={{color:'#3a3a3a',fontSize:12}}>—</span>
                                                                        }
                                                                    </td>
                                                                )}
                                                                {vi===0 && (
                                                                    <td rowSpan={o.vehicles.length} style={{padding:'9px 12px',color:'#fbbf24',fontWeight:700,fontSize:14,borderBottom:'1px solid #161616',verticalAlign:'top'}}>
                                                                        ₹{fmt(o.grandTotal||(o.totalAmount+royAmt))}
                                                                    </td>
                                                                )}
                                                            </tr>
                                                        ))}
                                                    </React.Fragment>
                                                );
                                            })}
                                            </tbody>
                                            <tfoot>
                                            <tr style={{background:'#1a1a1a',borderTop:'2px solid #2a2a2a'}}>
                                                <td colSpan={4} style={{padding:'8px 12px',color:'#666',fontWeight:600}}>Total</td>
                                                <td style={{padding:'8px 12px',color:'#fff',fontWeight:800,fontSize:13}}>
                                                    {(() => {
                                                        const trips = cg.orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.numberOfTrips||0),0),0);
                                                        const qty   = cg.orders.reduce((s,o)=>s+o.vehicles.reduce((ss,v)=>ss+(v.quantity||0),0),0);
                                                        if (trips>0 && qty===0) return trips+' trips';
                                                        if (qty>0 && trips===0) return qty+' '+(cg.orders.find(o=>o.quantityUnit)?.quantityUnit||'units');
                                                        return trips+' trips + '+qty+' units';
                                                    })()}
                                                </td>
                                                <td style={{padding:'8px 12px',color:'#888',fontWeight:600}}>—</td>
                                                <td style={{padding:'8px 12px',color:'#eab308',fontWeight:700}}>₹{fmt(cg.total)}</td>
                                                <td style={{padding:'8px 12px',color:'#d97706',fontWeight:700}}>₹{fmt(royTotal)}</td>
                                                <td style={{padding:'8px 12px',color:'#fbbf24',fontWeight:700}}>₹{fmt(custGrand)}</td>
                                            </tr>
                                            {custPaid>0 && (
                                                <tr style={{background:'#0a1a0a'}}>
                                                    <td colSpan={8} style={{padding:'6px 12px',color:'#4ade80',fontSize:12}}>Amount Paid</td>
                                                    <td style={{padding:'6px 12px',color:'#4ade80',fontWeight:600}}>₹{fmt(custPaid)}</td>
                                                </tr>
                                            )}
                                            {custCarry>0 && (
                                                <tr style={{background:'#1a0a00',borderTop:'1px solid #3a1a00'}}>
                                                    <td colSpan={8} style={{padding:'6px 12px',color:'#f87171',fontSize:12}}>⏮ Carried Forward (prev. unpaid)</td>
                                                    <td style={{padding:'6px 12px',color:'#f87171',fontWeight:600}}>₹{fmt(custCarry)}</td>
                                                </tr>
                                            )}
                                            {custBalance>0 && (
                                                <tr style={{background:'#1a0000'}}>
                                                    <td colSpan={8} style={{padding:'6px 12px',color:'#f87171',fontWeight:600,fontSize:12}}>Balance Due</td>
                                                    <td style={{padding:'6px 12px',color:'#f87171',fontWeight:700}}>₹{fmt(custBalance)}</td>
                                                </tr>
                                            )}
                                            </tfoot>
                                        </table>
                                        <div style={{padding:'10px 16px',background:'#0a0a0a'}}>
                                            <CustPaySection
                                                custName={cg.name} custPhone={cg.phone}
                                                weekStart={weeklyBill.weekStart}
                                                orders={cg.orders}
                                                allPayments={weeklyBill.payments||[]}
                                                carryForward={cg.carryForward || 0}
                                                onPaySaved={()=>loadBill(billDate)}
                                            />
                                        </div>
                                    </div>
                                );
                            })}

                            {weeklyBill.payments?.length>0 && (
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8}}>Payments This Week</div>
                                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                        <thead><tr>{['Date','Customer','Type','Amount','Note',''].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
                                        <tbody>
                                        {weeklyBill.payments.map((p)=>(
                                            <tr key={p._id}>
                                                <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{fmtDay(p.date)}</td>
                                                <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{p.customerName}</td>
                                                <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}>
                            <span style={{display:'inline-block',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600,
                                background:p.paymentType==='full'?'rgba(74,222,128,0.15)':'rgba(234,179,8,0.15)',
                                color:p.paymentType==='full'?'#4ade80':'#eab308',
                                border:`1px solid ${p.paymentType==='full'?'#4ade80':'#eab308'}`}}>
                              {p.paymentType==='full'?'Full':'Partial'}
                            </span>
                                                </td>
                                                <td style={{padding:'9px 12px',color:'#4ade80',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(p.amountPaid||p.amount)}</td>
                                                <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{p.note||'—'}</td>
                                                <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}><button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeletePayment(p._id)}>Del</button></td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:10,padding:20}}>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:16}}>
                                    {[
                                        {label: (weeklyBill.weekTrips||0)>0&&(weeklyBill.weekQty||0)===0 ? 'Total Trips' : (weeklyBill.weekQty||0)>0&&(weeklyBill.weekTrips||0)===0 ? 'Total Qty' : 'Trips / Qty',
                                            val: null, trips: weeklyBill.weekTrips||0, qty: weeklyBill.weekQty||0, color:'#60a5fa', isTrips:true},
                                        {label:'Delivery',   val:weeklyBill.weekTotal||weeklyBill.grandTotal, color:'#eab308'},
                                        {label:'Royalty',    val:weeklyBill.weekRoyalty||0,                   color:'#d97706'},
                                        {label:'Carried',    val:weeklyBill.carriedBalance,                   color:'#f87171'},
                                        {label:'Paid',       val:weeklyBill.weekPaid,                         color:'#4ade80'},
                                        {label:'Net Due',    val:weeklyBill.netDue,                           color:weeklyBill.netDue===0?'#4ade80':'#f87171'},
                                    ].map(item=>(
                                        <div key={item.label} style={{textAlign:'center'}}>
                                            <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>{item.label}</div>
                                            {item.isTrips
                                                ? <div style={{fontSize:20,fontWeight:700,color:item.color}}>
                                                    {item.trips>0&&item.qty===0 ? item.trips : item.qty>0&&item.trips===0 ? item.qty : `${item.trips}t+${item.qty}q`}
                                                </div>
                                                : <div style={{fontSize:20,fontWeight:700,color:item.color}}>₹{fmt(item.val)}</div>
                                            }
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16}}>
                                <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Khet Owner Signature</div></div>
                                <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Authorised Signature</div></div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {modal==='order' && (
                <div className="modal-overlay" onClick={()=>setModal(null)}>
                    <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header"><h3>Place Khet Order</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                        <div className="form-grid">
                            <div className="form-group"><label>Customer Name *</label><input placeholder="Customer name" value={orderForm.customerName} onChange={e=>setOrderForm({...orderForm,customerName:e.target.value})}/></div>
                            <div className="form-group"><label>Customer Phone</label><input placeholder="Phone number" value={orderForm.customerPhone} onChange={e=>setOrderForm({...orderForm,customerPhone:e.target.value})}/></div>
                            <div className="form-group"><label>Date</label><input type="date" value={orderForm.date} onChange={e=>setOrderForm({...orderForm,date:e.target.value})}/></div>
                            <div className="form-group"><label>Billing Type</label>
                                <select value={orderForm.billingType} onChange={e=>setOrderForm({...orderForm,billingType:e.target.value})}>
                                    <option value="Trip">Per Trip</option><option value="Quantity">Per Quantity</option>
                                </select>
                            </div>
                            {orderForm.billingType==='Quantity' && (
                                <div className="form-group"><label>Unit</label>
                                    <select value={orderForm.quantityUnit} onChange={e=>setOrderForm({...orderForm,quantityUnit:e.target.value})}>
                                        {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label>Material {materials.length>0 && <span style={{fontSize:11,color:'#4ade80',marginLeft:6}}>({materials.length} in stock)</span>}</label>
                                {materials.length>0 ? (
                                    <select value={orderForm.material} onChange={e=>setOrderForm({...orderForm,material:e.target.value})}>
                                        <option value="">Select material...</option>
                                        {materials.map(m=>(
                                            <option key={m._id} value={m.name}>
                                                {m.name} — {m.currentStock} {m.unit} available
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input placeholder="e.g. Sand, Murum" value={orderForm.material} onChange={e=>setOrderForm({...orderForm,material:e.target.value})}/>
                                )}
                            </div>
                            <div className="form-group"><label>Destination</label><input placeholder="Where to deliver" value={orderForm.destination} onChange={e=>setOrderForm({...orderForm,destination:e.target.value})}/></div>
                            <div className="form-group">
                                <label>Royalty Quantity <span style={{color:'#555'}}>(optional)</span></label>
                                <input type="number" placeholder="0" value={orderForm.royaltyQuantity} onChange={e=>setOrderForm({...orderForm,royaltyQuantity:e.target.value})}/>
                            </div>
                            <div className="form-group">
                                <label>Royalty Rate (₹/unit)</label>
                                <input type="number" placeholder="0" value={orderForm.royaltyRate} onChange={e=>setOrderForm({...orderForm,royaltyRate:e.target.value})}/>
                                {orderForm.royaltyQuantity && orderForm.royaltyRate && (
                                    <div style={{fontSize:12,color:'#d97706',marginTop:4,fontWeight:600}}>
                                        Royalty Amount: ₹{fmt((Number(orderForm.royaltyQuantity)||0)*(Number(orderForm.royaltyRate)||0))}
                                    </div>
                                )}
                            </div>
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={orderForm.note} onChange={e=>setOrderForm({...orderForm,note:e.target.value})}/></div>
                        </div>
                        <div style={{marginTop:8}}>
                            <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span>Vehicles <span style={{fontSize:11,color:'#555',fontWeight:400}}>(all optional)</span></span>
                                <button className="btn btn-secondary" style={{padding:'5px 10px',fontSize:12}} onClick={addVehicleRow}>+ Add Vehicle</button>
                            </div>
                            {orderForm.vehicles.map((v,i)=>{
                                const rowAmt = orderForm.billingType==='Trip'?(Number(v.numberOfTrips)||0)*(Number(v.rateApplied)||0):(Number(v.quantity)||0)*(Number(v.rateApplied)||0);
                                return (
                                    <div key={i} style={{background:'#0e0e0e',border:'1px solid #1e1e1e',borderRadius:8,padding:12,marginBottom:10}}>
                                        <div style={{display:'grid',gridTemplateColumns:orderForm.billingType==='Trip'?'2fr 1fr 1fr 1fr 1fr auto':'2fr 1fr 1fr 1fr auto',gap:8,marginBottom:8,alignItems:'end'}}>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Vehicle</label>
                                                <select value={v.vehicleId} onChange={e=>updateVehicleRow(i,'vehicleId',e.target.value)}>
                                                    <option value="">No vehicle</option>
                                                    <optgroup label="Own">{vehicles.filter(vh=>vh.ownershipType==='Own').map(vh=><option key={vh._id} value={vh._id}>{vh.vehicleNumber}</option>)}</optgroup>
                                                    <optgroup label="Rental">{vehicles.filter(vh=>vh.ownershipType==='Rental').map(vh=><option key={vh._id} value={vh._id}>{vh.vehicleNumber}</option>)}</optgroup>
                                                </select>
                                            </div>
                                            {orderForm.billingType==='Trip'
                                                ?<div className="form-group" style={{marginBottom:0}}><label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Trips</label><input type="number" placeholder="0" value={v.numberOfTrips} onChange={e=>updateVehicleRow(i,'numberOfTrips',e.target.value)}/></div>
                                                :<div className="form-group" style={{marginBottom:0}}><label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Qty</label><input type="number" placeholder="0" value={v.quantity} onChange={e=>updateVehicleRow(i,'quantity',e.target.value)}/></div>}
                                            {orderForm.billingType==='Trip' && (
                                                <div className="form-group" style={{marginBottom:0}}>
                                                    <label style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'0.6px'}}>Brass/Trip</label>
                                                    <input type="number" placeholder="e.g. 3" value={v.brassPerTrip} onChange={e=>updateVehicleRow(i,'brassPerTrip',e.target.value)}/>
                                                </div>
                                            )}
                                            <div className="form-group" style={{marginBottom:0}}><label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Rate (₹)</label><input type="number" placeholder="0" value={v.rateApplied} onChange={e=>updateVehicleRow(i,'rateApplied',e.target.value)}/></div>
                                            <div style={{textAlign:'center'}}><div style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Amount</div><div style={{color:'#eab308',fontWeight:600,fontSize:14,padding:'11px 0'}}>₹{fmt(rowAmt)}</div></div>
                                            <button className="btn btn-danger" style={{padding:'8px 10px',marginTop:18}} onClick={()=>removeVehicleRow(i)} disabled={orderForm.vehicles.length===1}>✕</button>
                                        </div>
                                        {!v.vehicleId && (
                                            <div className="form-group" style={{marginBottom:8}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Vehicle Number (manual)</label>
                                                {(()=>{
                                                    // Last 5 unique vehicle numbers used for this customer
                                                    const custName = orderForm.customerName.trim().toLowerCase();
                                                    const recentNums = custName
                                                        ? [...new Map(
                                                            [...orders]
                                                                .filter(o=>o.customerName?.trim().toLowerCase()===custName)
                                                                .sort((a,b)=>new Date(b.date)-new Date(a.date))
                                                                .flatMap(o=>o.vehicles.map(vv=>vv.vehicleNumber||vv.vehicle?.vehicleNumber).filter(Boolean))
                                                                .map(n=>[n,n])
                                                        ).keys()].slice(0,5)
                                                        : [];
                                                    return recentNums.length > 0 ? (
                                                        <div>
                                                            <input
                                                                placeholder="e.g. MH-12-AB-1234"
                                                                value={v.vehicleNumber}
                                                                onChange={e=>updateVehicleRow(i,'vehicleNumber',e.target.value)}
                                                                style={{marginBottom:6}}
                                                            />
                                                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                                                {recentNums.filter(num=>!dismissedVehicleNums.includes(num)).map(num=>(
                                                                    <div key={num} style={{display:'flex',alignItems:'center',
                                                                        background: v.vehicleNumber===num ? '#2563eb' : '#1a1a2e',
                                                                        border: `1px solid ${v.vehicleNumber===num ? '#3b82f6' : '#2a3a5a'}`,
                                                                        borderRadius:6, overflow:'hidden',
                                                                    }}>
                                                                        <button
                                                                            type="button"
                                                                            onClick={()=>updateVehicleRow(i,'vehicleNumber',num)}
                                                                            style={{
                                                                                background:'transparent', border:'none',
                                                                                padding:'3px 8px 3px 10px', fontSize:12,
                                                                                color: v.vehicleNumber===num ? '#fff' : '#93c5fd',
                                                                                cursor:'pointer', fontWeight:600,
                                                                            }}>
                                                                            {num}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={()=>setDismissedVehicleNums(d=>[...d,num])}
                                                                            title="Remove"
                                                                            style={{
                                                                                background:'transparent', border:'none',
                                                                                borderLeft: `1px solid ${v.vehicleNumber===num ? '#3b82f680' : '#2a3a5a'}`,
                                                                                padding:'3px 7px', fontSize:11,
                                                                                color: v.vehicleNumber===num ? '#bfdbfe' : '#4a5a7a',
                                                                                cursor:'pointer', lineHeight:1,
                                                                            }}>
                                                                            ✕
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <input placeholder="e.g. MH-12-AB-1234" value={v.vehicleNumber} onChange={e=>updateVehicleRow(i,'vehicleNumber',e.target.value)}/>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Driver <span style={{color:'#3a3a3a'}}>(optional)</span></label>
                                                <select value={v.driverId} onChange={e=>updateVehicleRow(i,'driverId',e.target.value)}>
                                                    <option value="">No driver</option>
                                                    {staff.filter(s=>s.role==='Driver').map(s=><option key={s._id} value={s._id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Conductor <span style={{color:'#3a3a3a'}}>(optional)</span></label>
                                                <select value={v.conductorId} onChange={e=>updateVehicleRow(i,'conductorId',e.target.value)}>
                                                    <option value="">No conductor</option>
                                                    {staff.filter(s=>s.role==='Conductor').map(s=><option key={s._id} value={s._id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {orderTotal > 0 && (
                            <div style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:8,padding:'12px 16px',marginTop:8}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                                    <span style={{color:'#888'}}>Total Trips / Qty</span>
                                    <span style={{color:'#60a5fa',fontWeight:700}}>
                          {(()=>{
                              const trips = orderForm.vehicles.reduce((s,v)=>s+(Number(v.numberOfTrips)||0),0);
                              const qty   = orderForm.vehicles.reduce((s,v)=>s+(Number(v.quantity)||0),0);
                              if (orderForm.billingType==='Trip') return trips+' trips';
                              return qty+' '+orderForm.quantityUnit;
                          })()}
                        </span>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                                    <span style={{color:'#888'}}>Delivery Amount</span>
                                    <span style={{color:'#eab308',fontWeight:600}}>₹{fmt(orderForm.vehicles.reduce((s,v)=>s+(orderForm.billingType==='Trip'?(Number(v.numberOfTrips)||0)*(Number(v.rateApplied)||0):(Number(v.quantity)||0)*(Number(v.rateApplied)||0)),0))}</span>
                                </div>
                                {orderForm.royaltyQuantity && orderForm.royaltyRate && (
                                    <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                                        <span style={{color:'#78716c'}}>Royalty Amount</span>
                                        <span style={{color:'#d97706',fontWeight:600}}>₹{fmt((Number(orderForm.royaltyQuantity)||0)*(Number(orderForm.royaltyRate)||0))}</span>
                                    </div>
                                )}
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:15,borderTop:'1px solid #2a2a2a',paddingTop:8,marginTop:4}}>
                                    <span style={{color:'#ccc',fontWeight:700}}>Grand Total</span>
                                    <span style={{color:'#fbbf24',fontWeight:700}}>₹{fmt(orderTotal)}</span>
                                </div>
                            </div>
                        )}
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>{setModal(null);setDismissedVehicleNums([]);}}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleOrder} disabled={saving}>{saving?'Placing...':'Place Order'}</button>
                        </div>
                    </div>
                </div>
            )}

            {modal==='payment' && (
                <div className="modal-overlay" onClick={()=>setModal(null)}>
                    <div className="modal" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header"><h3>Record Khet Payment</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                        {weeklyBill && (
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,padding:'12px 20px',background:'#0a0a0a',borderBottom:'1px solid #1e1e1e'}}>
                                <div style={{textAlign:'center'}}><div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:3}}>This Week</div><div style={{color:'#eab308',fontWeight:700,fontSize:15}}>₹{fmt(weeklyBill.grandTotal)}</div></div>
                                <div style={{textAlign:'center'}}><div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:3}}>Already Paid</div><div style={{color:'#4ade80',fontWeight:700,fontSize:15}}>₹{fmt(weeklyBill.weekPaid)}</div></div>
                                <div style={{textAlign:'center'}}><div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:3}}>Balance Due</div><div style={{color:'#f87171',fontWeight:700,fontSize:15}}>₹{fmt(weeklyBill.netDue)}</div></div>
                            </div>
                        )}
                        <div style={{padding:'0 20px 0'}}>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
                                {[{val:'full',label:'Full Paid',desc:'Clears entire balance',color:'#4ade80'},{val:'partial',label:'Partial',desc:'Partial payment',color:'#eab308'}].map(opt=>(
                                    <div key={opt.val} onClick={()=>setPaymentForm(f=>({...f,paymentType:opt.val,amount:opt.val==='full'?String(weeklyBill?.netDue||0):f.amount}))}
                                         style={{border:`2px solid ${paymentForm.paymentType===opt.val?opt.color:'#2a2a2a'}`,borderRadius:8,padding:'10px 14px',cursor:'pointer',
                                             background:paymentForm.paymentType===opt.val?`${opt.color}18`:'#0e0e0e'}}>
                                        <div style={{fontWeight:600,color:paymentForm.paymentType===opt.val?opt.color:'#888',fontSize:13}}>{opt.label}</div>
                                        <div style={{fontSize:11,color:'#555',marginTop:3}}>{opt.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="form-grid" style={{padding:'0 20px'}}>
                            <div className="form-group">
                                <label>Amount (₹) *</label>
                                <input type="number" placeholder="0" value={paymentForm.amount} onChange={e=>setPaymentForm({...paymentForm,amount:e.target.value})} style={{fontSize:16,fontWeight:600}}/>
                                {paymentForm.paymentType==='partial' && Number(paymentForm.amount)>0 && weeklyBill && (
                                    <div style={{fontSize:12,color:'#eab308',marginTop:4}}>Balance after: <strong>₹{fmt(Math.max(0,weeklyBill.netDue-Number(paymentForm.amount)))}</strong></div>
                                )}
                            </div>
                            <div className="form-group"><label>Date</label><input type="date" value={paymentForm.date} onChange={e=>setPaymentForm({...paymentForm,date:e.target.value})}/></div>
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={paymentForm.note} onChange={e=>setPaymentForm({...paymentForm,note:e.target.value})}/></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handlePayment} disabled={saving}
                                    style={{background:paymentForm.paymentType==='full'?'#16a34a':'#ca8a04'}}>
                                {saving?'Saving...':paymentForm.paymentType==='full'?'Record Full Payment':'Record Partial Payment'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editingCustomer && (
                <div className="modal-overlay" onClick={()=>setEditingCustomer(null)}>
                    <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
                        <div className="modal-header">
                            <h3>Edit Customer</h3>
                            <button className="modal-close" onClick={()=>setEditingCustomer(null)}>✕</button>
                        </div>
                        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
                            <div className="form-group" style={{marginBottom:0}}>
                                <label>Customer Name *</label>
                                <input
                                    value={editingCustomer.name}
                                    onChange={e=>setEditingCustomer(ec=>({...ec,name:e.target.value}))}
                                    placeholder="Enter name"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group" style={{marginBottom:0}}>
                                <label>Phone Number</label>
                                <input
                                    value={editingCustomer.phone}
                                    onChange={e=>setEditingCustomer(ec=>({...ec,phone:e.target.value}))}
                                    placeholder="Enter phone (optional)"
                                    type="tel"
                                />
                            </div>
                            <div style={{fontSize:11,color:'#555',background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px'}}>
                                ⚠️ This will update the customer name/phone across all their orders and payments.
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setEditingCustomer(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleEditCustomer} disabled={saving}>
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}