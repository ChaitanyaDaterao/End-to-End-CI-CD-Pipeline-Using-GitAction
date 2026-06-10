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
const fmtDay  = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit' });

const emptyPokland  = { name:'', ownershipType:'Own', pricePerTrip:'', rentalOwnerName:'', rentalOwnerPhone:'', note:'' };
const emptyEntry    = { date:new Date().toISOString().slice(0,10), entryType:'Trip', numberOfTrips:'', pricePerTrip:'', hoursUsed:'', hourlyRate:'', dailyCharge:'', brassQuantity:'', brassRate:'', dieselCost:'', maintenanceCost:'', note:'' };
const emptyOperator = { name:'', phone:'' };

/* ── Reusable pay/partial UI ── */
function PaySection({ netAmount, poklandId, weekStart, paymentFor, onSaved, refreshKey }) {
  const [existingPay, setExistingPay] = useState(null);
  const [open,        setOpen]        = useState(false);
  const [payType,     setPayType]     = useState('full'); // 'full' | 'partial'
  const [partialAmt,  setPartialAmt]  = useState('');
  const [note,        setNote]        = useState('');
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(true);

  // Load existing payment whenever poklandId/weekStart/paymentFor/refreshKey changes
  useEffect(() => {
    if (!poklandId || !weekStart || !paymentFor) { setLoading(false); return; }
    setLoading(true);
    api.get(`/pokland/${poklandId}/payment?weekStart=${weekStart}&paymentFor=${paymentFor}`)
        .then(r => { setExistingPay(r.data); })
        .catch(() => setExistingPay(null))
        .finally(() => setLoading(false));
  }, [poklandId, weekStart, paymentFor, refreshKey]);

  const alreadyPaid = existingPay?.amountPaid || 0;
  const remaining   = Math.max(0, netAmount - alreadyPaid);
  const pAmt        = Number(partialAmt) || 0;
  const overLimit   = payType === 'partial' && (alreadyPaid + pAmt) > netAmount;

  const openForm = () => {
    // Reset to sensible defaults when opening
    setPayType('full');
    setPartialAmt('');
    setNote('');
    setOpen(true);
  };

  const save = async () => {
    if (payType === 'partial' && pAmt <= 0) return toast.error('Enter a valid amount');
    if (overLimit) return toast.error(`Cannot exceed remaining ₹${fmt(remaining)}`);
    setSaving(true);
    try {
      // Full paid: amountPaid = total netAmount (not just remaining) so it's always correct
      const amountToSend = payType === 'full' ? netAmount : (alreadyPaid + pAmt);
      const res = await api.post(`/pokland/${poklandId}/payment`, {
        weekStart, paymentFor,
        totalBill:  netAmount,
        amountPaid: amountToSend,
        isPaid:     payType === 'full',
        isPartial:  payType === 'partial',
        note,
      });
      // Update local state immediately with the saved record
      setExistingPay(res.data);
      toast.success(payType === 'full' ? '✅ Fully Paid' : `⚡ Partial ₹${fmt(amountToSend)} recorded`);
      setOpen(false);
      setPartialAmt('');
      if (onSaved) onSaved();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Error saving payment';
      toast.error(`Payment error: ${msg}`);
      console.error('Payment save error:', err);
    }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{marginTop:12,padding:'10px 14px',background:'#1a1a1a',borderRadius:8,fontSize:13,color:'#444'}}>Loading payment status...</div>;

  const statusBadge = existingPay?.isPaid
      ? <span style={{display:'inline-block',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:'rgba(74,222,128,0.15)',color:'#4ade80',border:'1px solid #4ade80'}}>✅ Fully Paid</span>
      : existingPay?.isPartial
          ? <span style={{display:'inline-block',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:'rgba(234,179,8,0.15)',color:'#eab308',border:'1px solid #eab308'}}>⚡ Partial — ₹{fmt(alreadyPaid)} paid</span>
          : <span style={{display:'inline-block',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:'rgba(248,113,113,0.15)',color:'#f87171',border:'1px solid #f87171'}}>Unpaid</span>;

  const payDateLabel = existingPay?.updatedAt
      ? <span style={{fontSize:11,color:'#555',marginLeft:6}}>📅 {new Date(existingPay.updatedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      : null;

  return (
      <div style={{marginTop:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#1a1a1a',borderRadius:8,padding:'10px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:13,color:'#888'}}>Payment:</span>
            {statusBadge}
            {payDateLabel}
            {existingPay && remaining > 0 && <span style={{fontSize:12,color:'#666'}}>Remaining: ₹{fmt(remaining)}</span>}
          </div>
          <button className="btn btn-secondary" style={{padding:'4px 10px',fontSize:12}} onClick={open ? ()=>setOpen(false) : openForm}>
            {open ? 'Cancel' : existingPay ? '✏️ Update' : '+ Record'}
          </button>
        </div>

        {open && (
            <div style={{border:'1px solid #2a2a2a',borderRadius:8,padding:16,marginTop:8,background:'#0e0e0e'}}>
              {/* Balance summary */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14,padding:'10px',background:'#141414',borderRadius:6}}>
                {[
                  {l:'Net Amount',   v:netAmount,    c:'#eab308'},
                  {l:'Already Paid', v:alreadyPaid,  c:'#4ade80'},
                  {l:'Remaining',    v:remaining,    c:remaining>0?'#f87171':'#4ade80'},
                ].map(x=>(
                    <div key={x.l} style={{textAlign:'center'}}>
                      <div style={{fontSize:10,color:'#555',textTransform:'uppercase',marginBottom:2}}>{x.l}</div>
                      <div style={{color:x.c,fontWeight:700,fontSize:14}}>₹{fmt(x.v)}</div>
                    </div>
                ))}
              </div>

              {/* Payment type toggle */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                {[
                  {val:'full',    label:'✅ Full Paid',  desc:`Pay remaining ₹${fmt(remaining)}`, color:'#4ade80'},
                  {val:'partial', label:'⚡ Partial',     desc:'Enter amount below',               color:'#eab308'},
                ].map(opt=>(
                    <div key={opt.val} onClick={()=>{ setPayType(opt.val); if(opt.val==='full') setPartialAmt(''); }}
                         style={{border:`2px solid ${payType===opt.val?opt.color:'#2a2a2a'}`,borderRadius:8,padding:'8px 12px',cursor:'pointer',
                           background:payType===opt.val?`${opt.color}18`:'transparent'}}>
                      <div style={{fontWeight:600,color:payType===opt.val?opt.color:'#888',fontSize:12}}>{opt.label}</div>
                      <div style={{fontSize:11,color:'#555',marginTop:2}}>{opt.desc}</div>
                    </div>
                ))}
              </div>

              {payType === 'partial' && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.4px'}}>Amount (₹) *</label>
                      <input type="number" placeholder="0" value={partialAmt}
                             onChange={e=>setPartialAmt(e.target.value)}
                             style={{borderColor:overLimit?'#f87171':undefined}}/>
                      {overLimit && <div style={{fontSize:11,color:'#f87171',marginTop:3}}>⚠️ Exceeds remaining ₹{fmt(remaining)}</div>}
                      {!overLimit && pAmt>0 && <div style={{fontSize:11,color:'#eab308',marginTop:3}}>Total paid will be: ₹{fmt(alreadyPaid+pAmt)} | Remaining: ₹{fmt(Math.max(0,netAmount-alreadyPaid-pAmt))}</div>}
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.4px'}}>Note</label>
                      <input placeholder="Optional" value={note} onChange={e=>setNote(e.target.value)}/>
                    </div>
                  </div>
              )}

              <button className="btn btn-primary" onClick={save}
                      disabled={saving || overLimit || (payType==='partial' && pAmt<=0) || remaining<=0}
                      style={{background:payType==='full'?'#16a34a':'#ca8a04',width:'100%'}}>
                {saving ? 'Saving...' : payType==='full' ? `✅ Mark Fully Paid (₹${fmt(remaining)})` : `⚡ Record ₹${fmt(pAmt)} Payment`}
              </button>

              {remaining <= 0 && <div style={{fontSize:12,color:'#4ade80',textAlign:'center',marginTop:8}}>✅ Already fully paid</div>}
            </div>
        )}
      </div>
  );
}

export default function PoklandPage() {
  const [poklands,       setPoklands]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [tab,            setTab]            = useState('all');
  const [modal,          setModal]          = useState(null);
  const [selected,       setSelected]       = useState(null);
  const [form,           setForm]           = useState(emptyPokland);
  const [entryForm,      setEntryForm]      = useState(emptyEntry);
  const [operatorForm,   setOperatorForm]   = useState(emptyOperator);
  const [operators,      setOperators]      = useState([]);
  const [operatorWeeks,  setOperatorWeeks]  = useState([]);
  const [weeklyBill,     setWeeklyBill]     = useState(null);
  const [billDate,       setBillDate]       = useState(new Date().toISOString().slice(0,10));
  const [customFrom,     setCustomFrom]     = useState('');
  const [customTo,       setCustomTo]       = useState('');
  const [customEntries,  setCustomEntries]  = useState(null); // null = not in custom mode
  const [customLoading,  setCustomLoading]  = useState(false);
  const [opWeekForm,     setOpWeekForm]     = useState({ operatorId:'', weeklyAmount:'', date:new Date().toISOString().slice(0,10), markPresent:true });
  const [saving,         setSaving]         = useState(false);
  const [summary,        setSummary]        = useState(null);
  const [operatorBill,   setOperatorBill]   = useState(null);
  const [opBillModal,    setOpBillModal]    = useState(false);

  // Payment managed by PaySection component (self-loading)
  const [monthlyTrips,   setMonthlyTrips]   = useState(null);
  const [monthDate,      setMonthDate]      = useState(new Date().toISOString().slice(0,10));
  const [weeklyTrips,    setWeeklyTrips]    = useState(null); // separate weekly trip counter
  const [payHistory,     setPayHistory]     = useState([]);
  const [payHistModal,   setPayHistModal]   = useState(false);
  const [carryforward,   setCarryforward]   = useState(null); // null=loading, 0=cleared, >0=pending
  const [tripCarryforward, setTripCarryforward] = useState(0); // trips from unpaid/partial previous weeks
  const [payRefreshKey,  setPayRefreshKey]  = useState(0);   // bump to force PaySection re-fetch
  const [weekPaidAmount, setWeekPaidAmount] = useState(0);   // amount already paid for current week

  const opBillRef  = useRef();
  const printRef   = useRef();
  const summaryRef = useRef();
  const operatorRef = useRef();
  const isPrinting = useRef(false);

  const getWeekStart = (d) => {
    const date = new Date(d); const day = date.getDay();
    const diff = day===0?-6:1-day; date.setDate(date.getDate()+diff); date.setHours(0,0,0,0); return date;
  };

  const load = useCallback(async () => {
    try { const { data } = await api.get('/pokland'); setPoklands(data); }
    catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);



  const openAdd  = () => { setForm(emptyPokland); setModal('add'); };
  const openEdit = (p) => {
    setSelected(p);
    setForm({ name:p.name, ownershipType:p.ownershipType, pricePerTrip:p.pricePerTrip, rentalOwnerName:p.rentalOwnerName, rentalOwnerPhone:p.rentalOwnerPhone, note:p.note });
    setModal('edit');
  };
  const openEntry = (p) => {
    setSelected(p);
    const defaultType = 'Trip';
    setEntryForm({ ...emptyEntry, entryType:defaultType, pricePerTrip:p.pricePerTrip||'', date:new Date().toISOString().slice(0,10) });
    setModal('entry');
  };
  const openBill = async (p) => {
    setSelected(p); setWeeklyBill(null); setTripCarryforward(0); setCarryforward(null);
    setModal('bill');
    await loadBill(p._id, billDate);
  };
  const openOperators = async (p) => {
    setSelected(p);
    const { data } = await api.get(`/pokland/${p._id}/operators`);
    setOperators(data);
    const wRes = await api.get(`/pokland/operator-week/${p._id}?date=${new Date().toISOString().slice(0,10)}`);
    setOperatorWeeks(wRes.data);
    setOpWeekForm({ operatorId:data[0]?._id||'', weeklyAmount:'', date:new Date().toISOString().slice(0,10), markPresent:true });
    setModal('operators');
  };

  const loadWeekPaid = async (poklandId, weekStart, paymentFor) => {
    try {
      const { data } = await api.get(`/pokland/${poklandId}/payment?weekStart=${weekStart}&paymentFor=${paymentFor}`);
      setWeekPaidAmount(data?.amountPaid || 0);
    } catch { setWeekPaidAmount(0); }
  };

  const loadBill = async (id, date) => {
    try {
      const { data } = await api.get(`/pokland/${id}/weekly?date=${date}`);
      setWeeklyBill(data);
      if (data.pokland.ownershipType==='Own') {
        const opRes = await api.get(`/pokland/operator-week/${id}?date=${date}`);
        setOperatorWeeks(opRes.data);
      }
      // Use prevOutstanding already computed by backend — no separate frontend fetch needed
      setCarryforward(data.prevOutstanding ?? 0);
      setTripCarryforward(0); // trip carry-forward not used in display logic, keep at 0
      // Load monthly trip stats and current week paid amount
      await loadMonthlyTrips(id, date);
      const payFor = data.pokland.ownershipType==='Own' ? 'owner' : 'rental';
      const ws = getWeekStart(new Date(date)).toLocaleDateString('en-CA');
      await loadWeekPaid(id, ws, payFor);
    } catch { toast.error('Failed to load bill'); }
  };

  const loadCustomRange = async (id, from, to) => {
    if (!from || !to) return;
    setCustomLoading(true);
    setCustomEntries(null);
    try {
      const { data } = await api.get(`/pokland/${id}/entries-range?from=${from}&to=${to}`);
      setCustomEntries(data);
    } catch {
      toast.error('Failed to load custom range');
      setCustomEntries([]);
    } finally { setCustomLoading(false); }
  };

  const loadOperatorBill = async (pokland, date) => {
    try {
      const { data } = await api.get(`/pokland/${pokland._id}/operator-bill?date=${date}`);
      setOperatorBill(data);
      setOpBillModal(true);
    } catch { toast.error('Failed to load operator bill'); }
  };

  const loadSummary = async () => {
    try { const { data } = await api.get(`/pokland/summary/weekly?date=${billDate}`); setSummary(data); }
    catch { toast.error('Failed to load summary'); }
  };

  // Monthly trip count for selected pokland
  const loadMonthlyTrips = async (poklandId, date) => {
    try {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthLabel = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      const todayStr = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" local

      // Collect all Monday week-starts that overlap with this month
      const weekStarts = [];
      // Start from Monday of the first day of month
      const firstDay = new Date(year, month, 1);
      const firstDow = firstDay.getDay();
      const firstMonday = new Date(firstDay);
      firstMonday.setDate(firstDay.getDate() - (firstDow === 0 ? 6 : firstDow - 1));

      let ws = new Date(firstMonday);
      const monthEnd = new Date(year, month + 1, 0); // last day of month
      while (ws <= monthEnd) {
        weekStarts.push(ws.toLocaleDateString('en-CA'));
        ws = new Date(ws); ws.setDate(ws.getDate() + 7);
      }

      // Fetch each week's bill and aggregate trips + amounts
      let totalTrips = 0;
      let todayTrips = 0;
      let totalAmount = 0;
      await Promise.all(weekStarts.map(async (wDate) => {
        try {
          const { data: wb } = await api.get(`/pokland/${poklandId}/weekly?date=${wDate}`);
          (wb?.entries || []).forEach(e => {
            const eDate = e.date?.slice(0, 10);
            // Only count if entry actually falls in this month
            const ed = new Date(eDate);
            if (ed.getFullYear() === year && ed.getMonth() === month) {
              // Count net amount (after diesel/maintenance deductions) for all entry types
              const net = (Number(e.totalAmount) || 0) - (Number(e.dieselCost) || 0) - (Number(e.maintenanceCost) || 0);
              totalAmount += net;
              if (e.entryType !== 'Trip') return;
              totalTrips += Number(e.numberOfTrips) || 0;
              if (eDate === todayStr) todayTrips += Number(e.numberOfTrips) || 0;
            }
          });
        } catch { /* skip week */ }
      }));

      setMonthlyTrips({ total: totalTrips, today: todayTrips, month: monthLabel, amount: totalAmount });
    } catch { setMonthlyTrips(null); }
  };

  // Payment history for a pokland
  const loadPayHistory = async (poklandId) => {
    try {
      const { data } = await api.get(`/pokland/${poklandId}/payments`);
      setPayHistory(data || []);
      setPayHistModal(true);
    } catch { toast.error('Failed to load payment history'); }
  };

  const handleSummaryPrint = () => {
    if (!summary) return;
    const summaryHtml = buildSummaryHtml();
    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(summaryHtml); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  /* ── Exact same sharePdfFromHtml as Materials.js ── */
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

  /* ── Build HTML helpers (reused by print + share) ── */
  const buildPoklandBillHtml = (overrideEntries = null, overrideFrom = null, overrideTo = null) => {
    if (!weeklyBill) return '';
    const pok = weeklyBill.pokland;
    const isCustom   = overrideEntries !== null;
    const printEntries = isCustom ? overrideEntries : weeklyBill.entries;

    // Stats computed from the active entries set
    const grossAmt    = printEntries.reduce((s,e)=>s+(e.totalAmount||0),0);
    const totalDiesel = printEntries.reduce((s,e)=>s+(e.dieselCost||0),0);
    const totalMaint  = printEntries.reduce((s,e)=>s+(e.maintenanceCost||0),0);
    const totalTrips  = printEntries.filter(e=>e.entryType==='Trip').reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0);
    const weekNetAmount = isCustom ? (grossAmt - totalDiesel - totalMaint) : (weeklyBill.totalAmount - (weeklyBill.totalDiesel||0) - (weeklyBill.totalMaintenance||0));
    const cf = isCustom ? 0 : (carryforward || 0);
    const netAmount = weekNetAmount + cf;
    const periodLabel = isCustom
        ? `${overrideFrom} to ${overrideTo}`
        : `${fmtDate(weeklyBill.weekStart)} to ${fmtDate(weeklyBill.weekEnd)}`;
    let rowNum = 1;
    const rows = printEntries.map(e => {
      const net = e.totalAmount - (e.dieselCost||0) - (e.maintenanceCost||0);
      const details =
          e.entryType==='Trip'   ? `${e.numberOfTrips} trips × ₹${fmt(e.pricePerTrip)}` :
              e.entryType==='Hourly' ? `${e.hoursUsed} hrs × ₹${fmt(e.hourlyRate)}` :
                  e.entryType==='Daily'  ? 'Daily charge' :
                      e.entryType==='Brass'  ? `${e.brassQuantity} brass × ₹${fmt(e.brassRate)}` : '—';
      const bg = rowNum%2===0 ? 'background:#f8fafc;' : '';
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rowNum++}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(e.date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"><span style="display:inline-block;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;color:#1d4ed8;">${e.entryType}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;">${details}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(e.totalAmount)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#dc2626;">${e.dieselCost>0?`−₹${fmt(e.dieselCost)}`:'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#ea580c;">${e.maintenanceCost>0?`−₹${fmt(e.maintenanceCost)}`:'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:#15803d;">₹${fmt(net)}</td>
      </tr>`;
    }).join('');
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pokland Bill — ${pok.name}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.r{text-align:right;}
      td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
      <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">${pok.ownershipType} Pokland Bill</div>
        <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${pok.name}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${periodLabel}</div>
      </div>
    </div>
    <div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;">
      <strong>Pokland:</strong> ${pok.name} &nbsp;·&nbsp; <strong>Type:</strong> ${pok.ownershipType}
      ${pok.ownershipType==='Rental' && pok.rentalOwnerName ? `<br/><strong>Owner:</strong> ${pok.rentalOwnerName}${pok.rentalOwnerPhone?' &nbsp;·&nbsp; '+pok.rentalOwnerPhone:''}` : ''}
    </div>
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div>
        <div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(grossAmt)}</div>
      </div>
      ${totalDiesel>0||totalMaint>0 ? `<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Deductions</div><div style="font-size:22px;font-weight:900;color:#dc2626;">−₹${fmt(totalDiesel+totalMaint)}</div></div>` : ''}
      ${cf>0 ? `<div style="flex:1;background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">⚠️ Unpaid Carry-Fwd</div><div style="font-size:22px;font-weight:900;color:#dc2626;">+₹${fmt(cf)}</div><div style="font-size:10px;color:#999;margin-top:3px;">from prev. weeks</div></div>` : ''}
      ${monthlyTrips?.amount > 0 ? `<div style="flex:1;background:#eff6ff;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">${monthlyTrips.month} Total</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(monthlyTrips.amount)}</div><div style="font-size:10px;color:#999;margin-top:3px;">net this month</div></div>` : ''}
      ${totalTrips>0?`<div style="flex:1;background:#f0fdf4;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Trips</div><div style="font-size:22px;font-weight:900;color:#15803d;">${totalTrips}</div></div>`:''}
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Payable</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(netAmount)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th style="width:32px;">#</th><th>Date</th><th>Method</th><th>Details</th><th class="r">Amount (₹)</th><th class="r">⛽ Diesel</th><th class="r">🔧 Maint.</th><th class="r">Net (₹)</th></tr></thead>
      <tbody>${rows.length ? rows : `<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">No entries this week</td></tr>`}</tbody>
      <tfoot><tr>
        <td colspan="4" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Totals${totalTrips>0?` · ${totalTrips} trips`:''}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:right;">₹${fmt(grossAmt)}</td>
        <td style="background:#0f172a;color:#fca5a5;padding:11px 12px;font-weight:800;text-align:right;">${totalDiesel>0?`−₹${fmt(totalDiesel)}`:'—'}</td>
        <td style="background:#0f172a;color:#fdba74;padding:11px 12px;font-weight:800;text-align:right;">${totalMaint>0?`−₹${fmt(totalMaint)}`:'—'}</td>
        <td style="background:#0f172a;color:#86efac;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹${fmt(netAmount)}</td>
      </tr></tfoot>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <div style="width:400px;">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;">This Week's Bill</div>
        <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;"><span style="color:#475569;">Gross Amount</span><span style="font-weight:700;">₹${fmt(grossAmt)}</span></div>
          ${totalDiesel>0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;"><span>⛽ Diesel Deduction</span><span style="font-weight:700;">−₹${fmt(totalDiesel)}</span></div>` : ''}
          ${totalMaint>0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#ea580c;"><span>🔧 Maintenance Deduction</span><span style="font-weight:700;">−₹${fmt(totalMaint)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 14px;font-size:14px;font-weight:800;background:#f0fdf4;"><span style="color:#15803d;">This Week Net</span><span style="color:#15803d;">₹${fmt(weekNetAmount)}</span></div>
        </div>
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;">Total Outstanding</div>
        <div style="border:1px solid #fca5a5;border-radius:8px;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #fee2e2;font-size:13px;"><span style="color:#475569;">This Week Net</span><span style="font-weight:700;color:#15803d;">₹${fmt(weekNetAmount)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #fee2e2;font-size:13px;color:${cf>0?'#dc2626':'#94a3b8'};"><span>⚠️ Previous Unpaid (carry-forward)</span><span style="font-weight:700;">${cf>0?`+₹${fmt(cf)}`:'₹0'}</span></div>
          ${monthlyTrips?.amount > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #fee2e2;font-size:13px;color:#1d4ed8;"><span>📅 ${monthlyTrips.month} Total (net)</span><span style="font-weight:700;">₹${fmt(monthlyTrips.amount)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#fef2f2;">
            <span style="font-size:14px;font-weight:700;color:#dc2626;">Total Remaining to Pay</span>
            <span style="font-size:22px;font-weight:900;color:#dc2626;">₹${fmt(netAmount)}</span>
          </div>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Customer Signature</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>
    </body></html>`;
  };

  const buildSummaryHtml = () => {
    if (!summary) return '';
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const weekStart = getWeekStart(new Date(billDate));
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
    const periodStr = `${fmtDate(weekStart)} to ${fmtDate(weekEnd)}`;
    const totalNet   = summary.summary.reduce((a,s)=>a+s.netAmount,0);
    const totalGross = summary.summary.reduce((a,s)=>a+s.totalAmount,0);
    const totalOp    = summary.summary.reduce((a,s)=>a+(s.operatorCost||0),0);
    const rows = summary.summary.map((s,i)=>{
      const bg = i%2===0?'':'background:#f8fafc;';
      const isOwn = s.pokland.ownershipType==='Own';
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${s.pokland.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"><span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${isOwn?'#dcfce7':'#fef9c3'};color:${isOwn?'#15803d':'#92400e'};border:1px solid ${isOwn?'#86efac':'#fde047'};">${s.pokland.ownershipType}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;">${s.pokland.rentalOwnerName||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${s.entries}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">₹${fmt(s.totalAmount)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#dc2626;">${isOwn?`₹${fmt(s.operatorCost)}`:'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:#15803d;">₹${fmt(s.netAmount)}</td>
      </tr>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pokland Weekly Summary</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.r{text-align:right;} th.c{text-align:center;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}
      tfoot{display:table-row-group!important;}
      @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
      <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;text-transform:uppercase;letter-spacing:0.4px;">Chand Laluwale &amp; Roshan Laluwale</div></div></div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Pokland Weekly Summary</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">Period: ${periodStr}</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-bottom:22px;">
      <div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹${fmt(totalGross)}</div></div>
      <div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Operator Cost</div><div style="font-size:22px;font-weight:900;color:#dc2626;">₹${fmt(totalOp)}</div></div>
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Total</div><div style="font-size:22px;font-weight:900;color:#15803d;">₹${fmt(totalNet)}</div></div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th class="c">Entries</th><th class="r">Total (₹)</th><th class="r">Operator (₹)</th><th class="r">Net (₹)</th></tr></thead>
      <tbody>${rows.length ? rows : `<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">No data for this week</td></tr>`}</tbody>
      <tfoot><tr>
        <td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Totals</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:center;">${summary.summary.reduce((a,s)=>a+s.entries,0)}</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:right;">₹${fmt(totalGross)}</td>
        <td style="background:#0f172a;color:#fca5a5;padding:11px 12px;font-weight:800;text-align:right;">₹${fmt(totalOp)}</td>
        <td style="background:#0f172a;color:#86efac;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹${fmt(totalNet)}</td>
      </tr></tfoot>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <div style="width:340px;">
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;"><span style="color:#475569;">Grand Total Billed</span><span style="font-weight:700;">₹${fmt(totalGross)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;"><span>Operator Cost</span><span style="font-weight:700;">−₹${fmt(totalOp)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#dcfce7;border:2px solid #86efac;border-radius:8px;margin-top:6px;">
          <span style="font-size:14px;font-weight:700;color:#15803d;">Net Total</span>
          <span style="font-size:20px;font-weight:900;color:#15803d;">₹${fmt(totalNet)}</span>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Prepared By</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>
    <div style="text-align:center;margin-top:36px;font-size:10px;color:#94a3b8;">Developed by Chaitanya H Daterao &nbsp;|&nbsp; Mob: 9766150846</div>
    </body></html>`;
  };

  const buildOpBillHtml = () => {
    if (!operatorBill) return '';
    const pok = operatorBill.pokland;
    const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const weekStart = new Date(operatorBill.weekStart);
    const weekEnd   = new Date(operatorBill.weekEnd);
    const totalPayable = operatorBill.totalOperatorCost;
    const rows = operatorBill.operatorWeeks.map((w, i) => {
      const bg = i % 2 === 0 ? '' : 'background:#f8fafc;';
      const payable = w.cameAtAll ? w.weeklyAmount : 0;
      return `<tr style="${bg}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${w.operator?.name || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;">${w.daysPresent?.length || 0} days</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"><span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${w.cameAtAll ? '#dcfce7' : '#fee2e2'};color:${w.cameAtAll ? '#15803d' : '#dc2626'};border:1px solid ${w.cameAtAll ? '#86efac' : '#fca5a5'};">${w.cameAtAll ? 'Yes — Full Pay' : 'No — No Pay'}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(w.weeklyAmount)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:${w.cameAtAll ? '#15803d' : '#94a3b8'};">₹${fmt(payable)}</td>
      </tr>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pokland Operator Bill — ${pok.name}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
      th.r{text-align:right;}
      td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
      tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}
      tfoot{display:table-row-group!important;}
      @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
    </style></head><body>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>
      <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Operator Bill</div>
        <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${pok.name}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">Week: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-bottom:20px;">
      <div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Payable</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">&#8377;${fmt(totalPayable)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Operator</th><th>Days Present</th><th>Came This Week</th><th class="r">Weekly Amount</th><th class="r">Payable</th></tr></thead>
      <tbody>${rows.length ? rows : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No operators assigned this week</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total Payable</td>
        <td style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;text-align:right;"></td>
        <td style="background:#0f172a;color:#86efac;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">&#8377;${fmt(totalPayable)}</td>
      </tr></tfoot>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <div style="width:300px;">
        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#dcfce7;border:2px solid #86efac;border-radius:8px;margin-top:6px;">
          <span style="font-size:14px;font-weight:700;color:#15803d;">Net Payable</span>
          <span style="font-size:20px;font-weight:900;color:#15803d;">&#8377;${fmt(totalPayable)}</span>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:56px;">
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Operator Signature</div></div>
      <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
    </div>
    <div style="text-align:center;margin-top:36px;font-size:10px;color:#94a3b8;">Developed by Chaitanya H Daterao &nbsp;|&nbsp; Mob: 9766150846</div>
    </body></html>`;
  };

  /* ── WhatsApp PDF share handlers ── */
  const handleSharePdfBill    = () => { const n = weeklyBill?.pokland?.name||'pokland'; const html = customEntries !== null ? buildPoklandBillHtml(customEntries, customFrom, customTo) : buildPoklandBillHtml(); sharePdfFromHtml(html, 'Pokland_Bill_'+n+'.pdf'); };
  const handleSharePdfSummary = () => { sharePdfFromHtml(buildSummaryHtml(), 'Pokland_Summary.pdf'); };
  const handleSharePdfOpBill  = () => { const n = operatorBill?.pokland?.name||'pokland'; sharePdfFromHtml(buildOpBillHtml(), 'Pokland_OperatorBill_'+n+'.pdf'); };

  const handleSave = async () => {
    if (!form.name) return toast.error('Name required');
    setSaving(true);
    try {
      if (modal==='add') { await api.post('/pokland', form); toast.success('Pokland added'); }
      else { await api.put(`/pokland/${selected._id}`, form); toast.success('Updated'); }
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove?')) return;
    try { await api.delete(`/pokland/${id}`); toast.success('Removed'); load(); }
    catch { toast.error('Error'); }
  };

  const handleEntry = async () => {
    const { entryType } = entryForm;
    if (entryType==='Trip'   && (!entryForm.numberOfTrips||!entryForm.pricePerTrip)) return toast.error('Enter trips and price');
    if (entryType==='Hourly' && (!entryForm.hoursUsed||!entryForm.hourlyRate))      return toast.error('Enter hours and rate');
    if (entryType==='Daily'  && !entryForm.dailyCharge)                              return toast.error('Enter daily charge');
    if (entryType==='Brass'  && (!entryForm.brassQuantity||!entryForm.brassRate))   return toast.error('Enter brass and rate');
    setSaving(true);
    try { await api.post(`/pokland/${selected._id}/entry`, entryForm); toast.success('Entry added'); setModal(null); }
    catch (e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const handleAddOperator = async () => {
    if (!operatorForm.name) return toast.error('Name required');
    setSaving(true);
    try {
      const { data } = await api.post(`/pokland/${selected._id}/operators`, operatorForm);
      setOperators(prev=>[...prev,data]); setOperatorForm(emptyOperator); toast.success('Operator added');
    } catch { toast.error('Error'); }
    finally { setSaving(false); }
  };

  const handleDeleteOpWeek = async (weekId, poklandId, date) => {
    if (!window.confirm('Remove this operator from this week\'s billing?')) return;
    try {
      await api.delete(`/pokland/operator-week/${weekId}`);
      toast.success('Removed from billing');
      // Reload operator weeks and bill
      const wRes = await api.get(`/pokland/operator-week/${poklandId}?date=${date}`);
      setOperatorWeeks(wRes.data);
      await loadBill(poklandId, date);
    } catch { toast.error('Error removing'); }
  };

  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Delete this entry? This will reverse all amounts from the bill.')) return;
    try {
      await api.delete(`/pokland/entry/${entryId}`);
      toast.success('Entry deleted');
      await loadBill(selected._id, billDate);
    } catch { toast.error('Failed to delete entry'); }
  };

  const handleDeleteOperator = async (opId) => {
    if (!window.confirm('Remove this operator?')) return;
    try {
      await api.delete(`/pokland/operators/${opId}`);
      setOperators(prev => prev.filter(op => op._id !== opId));
      toast.success('Operator removed');
    } catch { toast.error('Error removing operator'); }
  };

  const handleOpWeek = async () => {
    if (!opWeekForm.operatorId) return toast.error('Select operator');
    setSaving(true);
    try {
      await api.post('/pokland/operator-week', { poklandId:selected._id, ...opWeekForm });
      toast.success('Updated');
      const wRes = await api.get(`/pokland/operator-week/${selected._id}?date=${opWeekForm.date}`);
      setOperatorWeeks(wRes.data);
    } catch { toast.error('Error'); }
    finally { setSaving(false); }
  };

  const handlePrint = () => {
    if (!weeklyBill) return;
    const poklandHtml = customEntries !== null
        ? buildPoklandBillHtml(customEntries, customFrom, customTo)
        : buildPoklandBillHtml();
    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(poklandHtml); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  const handleOpBillPrint = () => {
    if (!operatorBill) return;
    const opBillHtml = buildOpBillHtml();
    let iframe = document.getElementById('__print_iframe__');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = '__print_iframe__';
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
    }
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(opBillHtml); iDoc.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
  };

  const calcEntry = () => {
    const { entryType, numberOfTrips, pricePerTrip, hoursUsed, hourlyRate, dailyCharge, brassQuantity, brassRate } = entryForm;
    if (entryType==='Trip')   return (Number(numberOfTrips)||0)*(Number(pricePerTrip)||0);
    if (entryType==='Hourly') return (Number(hoursUsed)||0)*(Number(hourlyRate)||0);
    if (entryType==='Daily')  return Number(dailyCharge)||0;
    if (entryType==='Brass')  return (Number(brassQuantity)||0)*(Number(brassRate)||0);
    return 0;
  };
  const calcDeductions = () => (Number(entryForm.dieselCost)||0) + (Number(entryForm.maintenanceCost)||0);
  const calcNet        = () => Math.max(0, calcEntry() - calcDeductions());

  const filtered = poklands.filter(p=>tab==='all'?true:p.ownershipType===(tab==='own'?'Own':'Rental'));

  if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

  const billWeekStart = weeklyBill ? getWeekStart(new Date(billDate)).toLocaleDateString('en-CA') : null;

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">🏗️ Pokland</h1>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={()=>{setTab('summary');loadSummary();}}>📊 Summary</button>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Pokland</button>
          </div>
        </div>

        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card yellow"><div className="stat-icon">🏗️</div><div className="stat-info"><div className="stat-value">{poklands.length}</div><div className="stat-label">Total</div></div></div>
          <div className="stat-card blue"><div className="stat-icon">🔑</div><div className="stat-info"><div className="stat-value">{poklands.filter(p=>p.ownershipType==='Own').length}</div><div className="stat-label">Own</div></div></div>
          <div className="stat-card red"><div className="stat-icon">📋</div><div className="stat-info"><div className="stat-value">{poklands.filter(p=>p.ownershipType==='Rental').length}</div><div className="stat-label">Rental</div></div></div>
          <div className="stat-card green"><div className="stat-icon">👷</div><div className="stat-info"><div className="stat-value">Op+Trip</div><div className="stat-label">Own Billing</div></div></div>
        </div>

        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {['all','own','rental','summary'].map(t=>(
              <button key={t} className={`btn ${tab===t?'btn-primary':'btn-secondary'}`}
                      onClick={()=>{setTab(t);if(t==='summary')loadSummary();}}>
                {t==='all'?'All':t==='own'?'🔑 Own':t==='rental'?'📋 Rental':'📊 Summary'}
              </button>
          ))}
        </div>

        {/* Summary */}
        {tab==='summary' && (
            <div className="card">
              <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center'}}>
                <input type="date" value={billDate} onChange={e=>setBillDate(e.target.value)} style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={loadSummary}>Refresh</button>
                {summary && <button className="btn btn-secondary" onClick={handleSummaryPrint}>🖨️ Print</button>}
                {summary && (
                    <button onClick={handleSharePdfSummary} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'8px 14px',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </button>
                )}
              </div>
              {!summary
                  ? <div style={{color:'#444',textAlign:'center',padding:32}}>Select date and refresh</div>
                  : (
                      <div ref={summaryRef}>
                        <div className="table-wrap">
                          <table>
                            <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Entries</th><th>Total (₹)</th><th>Operator (₹)</th><th>Net (₹)</th></tr></thead>
                            <tbody>
                            {summary.summary.map((s,i)=>(
                                <tr key={i}>
                                  <td style={{fontWeight:600,color:'#f0f0f0'}}>{s.pokland.name}</td>
                                  <td><span className={`badge ${s.pokland.ownershipType==='Own'?'badge-green':'badge-yellow'}`}>{s.pokland.ownershipType}</span></td>
                                  <td style={{color:'#888'}}>{s.pokland.rentalOwnerName||'—'}</td>
                                  <td>{s.entries}</td>
                                  <td style={{color:'#eab308'}}>₹{fmt(s.totalAmount)}</td>
                                  <td style={{color:'#f87171'}}>{s.pokland.ownershipType==='Own'?`₹${fmt(s.operatorCost)}`:'—'}</td>
                                  <td style={{color:'#4ade80',fontWeight:700}}>₹{fmt(s.netAmount)}</td>
                                </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                  )
              }
            </div>
        )}

        {/* List */}
        {tab!=='summary' && (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Type</th><th>Details</th><th>Actions</th></tr></thead>
                  <tbody>
                  {filtered.length===0 && <tr><td colSpan={4} style={{textAlign:'center',color:'#444',padding:32}}>No poklands found.</td></tr>}
                  {filtered.map(p=>(
                      <tr key={p._id}>
                        <td style={{fontWeight:700,color:'#f0f0f0',fontSize:15}}>{p.name}</td>
                        <td><span className={`badge ${p.ownershipType==='Own'?'badge-green':'badge-yellow'}`}>{p.ownershipType}</span></td>
                        <td style={{color:'#888'}}>{p.ownershipType==='Own'?`₹${fmt(p.pricePerTrip)}/trip`:`${p.rentalOwnerName}${p.rentalOwnerPhone?' · '+p.rentalOwnerPhone:''}`}</td>
                        <td>
                          <div style={{display:'flex',gap:6}}>
                            <button className="btn btn-primary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openEntry(p)}>+ Entry</button>
                            {p.ownershipType==='Own' && <>
                              <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openOperators(p)}>👷 Operator</button>
                              <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>loadOperatorBill(p,new Date().toISOString().slice(0,10))}>🧾 Op Bill</button>
                            </>}
                            <button className="btn btn-primary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openBill(p)}>🧾 Bill</button>
                            <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>loadPayHistory(p._id)}>📜 History</button>
                            <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openEdit(p)}>✏️</button>
                            <button className="btn btn-danger" style={{padding:'6px 10px',fontSize:12}} onClick={()=>handleDelete(p._id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>
        )}

        {/* Add/Edit */}
        {(modal==='add'||modal==='edit') && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h3>{modal==='add'?'Add Pokland':'Edit Pokland'}</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                <div className="form-grid">
                  <div className="form-group"><label>Name *</label><input placeholder="e.g. Pokland 1" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
                  <div className="form-group"><label>Ownership *</label>
                    <select value={form.ownershipType} onChange={e=>setForm({...form,ownershipType:e.target.value})}>
                      <option value="Own">Own</option><option value="Rental">Rental</option>
                    </select>
                  </div>
                  {form.ownershipType==='Own' && <div className="form-group"><label>Price per Trip (₹)</label><input type="number" placeholder="0" value={form.pricePerTrip} onChange={e=>setForm({...form,pricePerTrip:e.target.value})}/></div>}
                  {form.ownershipType==='Rental' && <>
                    <div className="form-group"><label>Rental Owner Name</label><input placeholder="Owner name" value={form.rentalOwnerName} onChange={e=>setForm({...form,rentalOwnerName:e.target.value})}/></div>
                    <div className="form-group"><label>Owner Phone</label><input placeholder="Phone" value={form.rentalOwnerPhone} onChange={e=>setForm({...form,rentalOwnerPhone:e.target.value})}/></div>
                  </>}
                  <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Add Entry */}
        {modal==='entry' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h3>Add Entry — {selected?.name}</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                <div className="modal-stock-info">
                  {selected?.ownershipType==='Own'?<>Own · Rate: <strong style={{color:'#eab308'}}>₹{fmt(selected?.pricePerTrip)}/trip</strong></>:<>Rental · Owner: <strong style={{color:'#eab308'}}>{selected?.rentalOwnerName}</strong></>}
                </div>
                <div className="form-grid">
                  <div className="form-group"><label>Date</label><input type="date" value={entryForm.date} onChange={e=>setEntryForm({...entryForm,date:e.target.value})}/></div>
                  <div className="form-group"><label>Billing Method</label>
                    <select value={entryForm.entryType} onChange={e=>setEntryForm({...entryForm,entryType:e.target.value})}>
                      {selected?.ownershipType==='Own'
                          ? <option value="Trip">Per Trip</option>
                          : <><option value="Trip">Per Trip</option><option value="Hourly">Hourly</option><option value="Daily">Daily</option><option value="Brass">Per Brass</option></>}
                    </select>
                  </div>
                  {entryForm.entryType==='Trip'   && <><div className="form-group"><label>Number of Trips *</label><input type="number" placeholder="0" value={entryForm.numberOfTrips} onChange={e=>setEntryForm({...entryForm,numberOfTrips:e.target.value})}/></div><div className="form-group"><label>Price per Trip (₹)</label><input type="number" placeholder="0" value={entryForm.pricePerTrip} onChange={e=>setEntryForm({...entryForm,pricePerTrip:e.target.value})}/></div></>}
                  {entryForm.entryType==='Hourly' && <><div className="form-group"><label>Hours Used *</label><input type="number" placeholder="0" value={entryForm.hoursUsed} onChange={e=>setEntryForm({...entryForm,hoursUsed:e.target.value})}/></div><div className="form-group"><label>Hourly Rate (₹)</label><input type="number" placeholder="0" value={entryForm.hourlyRate} onChange={e=>setEntryForm({...entryForm,hourlyRate:e.target.value})}/></div></>}
                  {entryForm.entryType==='Daily'  && <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Daily Charge (₹) *</label><input type="number" placeholder="0" value={entryForm.dailyCharge} onChange={e=>setEntryForm({...entryForm,dailyCharge:e.target.value})}/></div>}
                  {entryForm.entryType==='Brass'  && <><div className="form-group"><label>Brass Quantity *</label><input type="number" placeholder="0" value={entryForm.brassQuantity} onChange={e=>setEntryForm({...entryForm,brassQuantity:e.target.value})}/></div><div className="form-group"><label>Rate per Brass (₹)</label><input type="number" placeholder="0" value={entryForm.brassRate} onChange={e=>setEntryForm({...entryForm,brassRate:e.target.value})}/></div></>}
                  {/* Diesel & Maintenance — both types, filled manually by owner */}
                  <div className="form-group" style={{background:'#0a1a0a',border:'1px solid #1a3a1a',borderRadius:8,padding:'10px 12px'}}>
                    <label style={{color:'#4ade80',fontSize:11,textTransform:'uppercase',letterSpacing:'0.5px'}}>⛽ Diesel Cost (₹) <span style={{color:'#555',fontWeight:400}}>— deducted from bill</span></label>
                    <input type="number" placeholder="0" value={entryForm.dieselCost} onChange={e=>setEntryForm({...entryForm,dieselCost:e.target.value})}/>
                  </div>
                  <div className="form-group" style={{background:'#1a0a00',border:'1px solid #3a2000',borderRadius:8,padding:'10px 12px'}}>
                    <label style={{color:'#fb923c',fontSize:11,textTransform:'uppercase',letterSpacing:'0.5px'}}>🔧 Maintenance Cost (₹) <span style={{color:'#555',fontWeight:400}}>— deducted from bill</span></label>
                    <input type="number" placeholder="0" value={entryForm.maintenanceCost} onChange={e=>setEntryForm({...entryForm,maintenanceCost:e.target.value})}/>
                  </div>
                  <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={entryForm.note} onChange={e=>setEntryForm({...entryForm,note:e.target.value})}/></div>
                </div>
                {calcEntry()>0 && (
                    <div className="modal-total" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,textAlign:'center'}}>
                      <div><div style={{fontSize:11,color:'#666',marginBottom:2}}>Gross Amount</div><div style={{color:'#eab308',fontWeight:700}}>₹{fmt(calcEntry())}</div></div>
                      <div><div style={{fontSize:11,color:'#666',marginBottom:2}}>Deductions</div><div style={{color:'#f87171',fontWeight:700}}>−₹{fmt(calcDeductions())}</div></div>
                      <div><div style={{fontSize:11,color:'#666',marginBottom:2}}>Net Payable</div><div style={{color:'#4ade80',fontWeight:700,fontSize:16}}>₹{fmt(calcNet())}</div></div>
                    </div>
                )}
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleEntry} disabled={saving}>{saving?'Saving...':'Add Entry'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Operators */}
        {modal==='operators' && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h3>Operators — {selected?.name}</h3><button className="modal-close" onClick={()=>setModal(null)}>✕</button></div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:10}}>Add New Operator</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:8,alignItems:'end'}}>
                    <div className="form-group" style={{marginBottom:0}}><label>Name *</label><input placeholder="Operator name" value={operatorForm.name} onChange={e=>setOperatorForm({...operatorForm,name:e.target.value})}/></div>
                    <div className="form-group" style={{marginBottom:0}}><label>Phone</label><input placeholder="Phone" value={operatorForm.phone} onChange={e=>setOperatorForm({...operatorForm,phone:e.target.value})}/></div>
                    <button className="btn btn-primary" style={{padding:'11px 14px'}} onClick={handleAddOperator} disabled={saving}>Add</button>
                  </div>
                </div>
                {operators.length>0 && (
                    <div style={{marginBottom:20}}>
                      <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8}}>Operators</div>
                      {operators.map(op=>(
                          <div key={op._id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:'#0e0e0e',borderRadius:6,marginBottom:4}}>
                            <div>
                              <span style={{color:'#ccc'}}>{op.name}</span>
                              {op.phone && <span style={{color:'#666',fontSize:12,marginLeft:10}}>{op.phone}</span>}
                            </div>
                            <button className="btn btn-danger" style={{padding:'3px 8px',fontSize:11}} onClick={()=>handleDeleteOperator(op._id)}>🗑 Remove</button>
                          </div>
                      ))}
                    </div>
                )}
                <div style={{borderTop:'1px solid #1e1e1e',paddingTop:16}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:10}}>Weekly Operator Entry</div>
                  <div style={{fontSize:12,color:'#555',marginBottom:10}}>If comes even 1 day → full weekly pay. If absent all week → ₹0.</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
                    <div className="form-group" style={{marginBottom:0}}><label>Operator</label>
                      <select value={opWeekForm.operatorId} onChange={e=>setOpWeekForm({...opWeekForm,operatorId:e.target.value})}>
                        <option value="">Select...</option>
                        {operators.map(op=><option key={op._id} value={op._id}>{op.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}><label>Weekly Amount (₹)</label><input type="number" placeholder="0" value={opWeekForm.weeklyAmount} onChange={e=>setOpWeekForm({...opWeekForm,weeklyAmount:e.target.value})}/></div>
                    <div className="form-group" style={{marginBottom:0}}><label>Date (mark present)</label><input type="date" value={opWeekForm.date} onChange={e=>setOpWeekForm({...opWeekForm,date:e.target.value})}/></div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <input type="checkbox" id="markPresent" checked={opWeekForm.markPresent} onChange={e=>setOpWeekForm({...opWeekForm,markPresent:e.target.checked})} style={{width:16,height:16}}/>
                    <label htmlFor="markPresent" style={{fontSize:13,color:'#ccc',cursor:'pointer'}}>Mark as present on selected date</label>
                  </div>
                  <button className="btn btn-primary" onClick={handleOpWeek} disabled={saving}>Save</button>
                </div>
                {operatorWeeks.length>0 && (
                    <div style={{marginTop:16,borderTop:'1px solid #1e1e1e',paddingTop:16}}>
                      <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8}}>This Week's Operator Status</div>
                      {operatorWeeks.map(w=>(
                          <div key={w._id} style={{background:'#0e0e0e',border:'1px solid #1e1e1e',borderRadius:8,padding:12,marginBottom:8}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                              <span style={{color:'#f0f0f0',fontWeight:600}}>{w.operator?.name}</span>
                              <span className={`badge ${w.cameAtAll?'badge-green':'badge-red'}`}>{w.cameAtAll?'Present':'Absent'}</span>
                            </div>
                            <div style={{fontSize:12,color:'#666',marginTop:4}}>
                              Days present: {w.daysPresent.length} · Weekly amount: <span style={{color:'#eab308'}}>₹{fmt(w.weeklyAmount)}</span>
                              · Payable: <span style={{color:w.cameAtAll?'#4ade80':'#f87171'}}>₹{w.cameAtAll?fmt(w.weeklyAmount):'0'}</span>
                            </div>
                          </div>
                      ))}
                    </div>
                )}
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
                    <div style={{display:'flex',alignItems:'center',gap:6,background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:8,padding:'4px 8px'}}>
                      <span style={{fontSize:11,color:'#555',whiteSpace:'nowrap'}}>Week of:</span>
                      <input type="date" value={billDate} onChange={e=>{setBillDate(e.target.value);setCustomEntries(null);setCustomFrom('');setCustomTo('');loadBill(selected._id,e.target.value);}}
                             style={{background:'transparent',border:'none',color:'#e0e0e0',fontSize:13,outline:'none'}}/>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:4,background:'#0e0e0e',border:'1px solid #1e3a5f',borderRadius:8,padding:'4px 8px'}}>
                      <span style={{fontSize:11,color:'#3b82f6',whiteSpace:'nowrap'}}>📅 Custom:</span>
                      <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                             style={{background:'transparent',border:'none',color:'#e0e0e0',fontSize:13,outline:'none'}}/>
                      <span style={{color:'#555',fontSize:12}}>→</span>
                      <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                             style={{background:'transparent',border:'none',color:'#e0e0e0',fontSize:13,outline:'none'}}/>
                      <button onClick={()=>{if(customFrom&&customTo){loadCustomRange(selected._id,customFrom,customTo);}else{toast.error('Select both From and To dates');}}}
                              style={{background:'#1e3a5f',border:'none',borderRadius:5,color:'#3b82f6',fontWeight:700,fontSize:11,padding:'3px 8px',cursor:'pointer'}}>Go</button>
                      {customEntries!==null && <button onClick={()=>{setCustomEntries(null);setCustomFrom('');setCustomTo('');}}
                                                       style={{background:'#2a0e0e',border:'none',borderRadius:5,color:'#f87171',fontWeight:700,fontSize:11,padding:'3px 8px',cursor:'pointer'}}>✕</button>}
                    </div>
                    <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={e=>{e.stopPropagation();handlePrint();}}>🖨️ Print</button>
                    <button onClick={handleSharePdfBill} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </button>
                    <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                  </div>
                </div>
                {!weeklyBill ? <div style={{textAlign:'center',padding:32,color:'#444'}}>Loading...</div> : (
                    <div ref={printRef}>
                      <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:12,marginBottom:16}}>
                        <div style={{fontSize:20,fontWeight:700,color:'#f0f0f0'}}>{selected?.ownershipType==='Own'?'Own':'Rental'} Pokland Weekly Bill</div>
                        <div style={{fontSize:13,color:'#888',marginTop:4}}>
                          Pokland: <strong style={{color:'#eab308'}}>{weeklyBill.pokland.name}</strong>
                          {weeklyBill.pokland.ownershipType==='Rental' && weeklyBill.pokland.rentalOwnerName && <>&nbsp;·&nbsp; Owner: <strong style={{color:'#fff'}}>{weeklyBill.pokland.rentalOwnerName}</strong></>}
                          &nbsp;·&nbsp; Week: {fmtDate(weeklyBill.weekStart)} to {fmtDate(weeklyBill.weekEnd)}
                        </div>
                      </div>

                      {/* Trip Stats Bar — Today / This Week / This Month / Carry-Forward */}
                      {(() => {
                        const weekTrips = (weeklyBill.entries||[]).filter(e=>e.entryType==='Trip').reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0);
                        const todayStr  = new Date().toISOString().slice(0,10);
                        const todayTrips = (weeklyBill.entries||[]).filter(e=>e.entryType==='Trip' && e.date?.slice(0,10)===todayStr).reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0);
                        const monthTotal = monthlyTrips?.total ?? weekTrips;
                        const colCount = 3 + (tripCarryforward > 0 ? 1 : 0) + (carryforward > 0 ? 1 : 0) + (monthlyTrips?.amount > 0 ? 1 : 0);
                        return (
                            <div style={{display:'grid',gridTemplateColumns:`repeat(${colCount},1fr)`,gap:10,marginBottom:14}}>
                              <div style={{background:'#0e0e1a',border:'1px solid #2a2a4a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Today's Trips</div>
                                <div style={{fontSize:22,fontWeight:800,color:'#818cf8'}}>{monthlyTrips?.today ?? todayTrips}</div>
                              </div>
                              <div style={{background:'#0e1a0e',border:'1px solid #1a3a1a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>This Week's Trips</div>
                                <div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{weekTrips}</div>
                              </div>
                              <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>{monthlyTrips?.month || 'Monthly'} Trips</div>
                                <div style={{fontSize:22,fontWeight:800,color:'#eab308'}}>{monthTotal}</div>
                              </div>
                              {monthlyTrips?.amount > 0 && (
                                  <div style={{background:'#0d1a2a',border:'1px solid #1e3a5a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#60a5fa',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>{monthlyTrips?.month || 'Monthly'} Amount</div>
                                    <div style={{fontSize:20,fontWeight:800,color:'#60a5fa'}}>₹{fmt(monthlyTrips.amount)}</div>
                                    <div style={{fontSize:10,color:'#555',marginTop:3}}>net after deductions</div>
                                  </div>
                              )}
                              {tripCarryforward > 0 && (
                                  <div style={{background:'rgba(248,113,113,0.07)',border:'1px solid #7f1d1d',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#f87171',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>⚠️ Carry-Fwd Trips</div>
                                    <div style={{fontSize:22,fontWeight:800,color:'#f87171'}}>{tripCarryforward}</div>
                                    <div style={{fontSize:10,color:'#555',marginTop:3}}>from prev. weeks</div>
                                  </div>
                              )}
                              {carryforward > 0 && (
                                  <div style={{background:'rgba(248,113,113,0.07)',border:'1px solid #f87171',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#f87171',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>⚠️ Unpaid Carry-Fwd</div>
                                    <div style={{fontSize:20,fontWeight:800,color:'#f87171'}}>₹{fmt(carryforward)}</div>
                                    <div style={{fontSize:10,color:'#555',marginTop:3}}>from prev. weeks</div>
                                  </div>
                              )}
                            </div>
                        );
                      })()}

                      {/* Carryforward Pending Banner */}
                      {carryforward === null && (
                          <div style={{background:'#111',border:'1px solid #2a2a2a',borderRadius:8,padding:'8px 14px',marginBottom:14}}>
                            <span style={{fontSize:12,color:'#555'}}>⏳ Checking carry-forward...</span>
                          </div>
                      )}
                      {carryforward > 0 && (
                          <div style={{background:'rgba(248,113,113,0.08)',border:'1px solid #f87171',borderRadius:8,padding:'10px 14px',marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <div>
                              <span style={{fontSize:12,color:'#f87171',fontWeight:700}}>⚠️ Carry-Forward Pending from Previous Weeks</span>
                              <div style={{fontSize:11,color:'#888',marginTop:2}}>This amount is outstanding from earlier unpaid/partial weeks{tripCarryforward>0?` · ${tripCarryforward} trips pending`:''}</div>
                            </div>
                            <div style={{fontSize:20,fontWeight:800,color:'#f87171'}}>₹{fmt(carryforward)}</div>
                          </div>
                      )}
                      {carryforward === 0 && (
                          <div style={{background:'rgba(74,222,128,0.07)',border:'1px solid #166534',borderRadius:8,padding:'8px 14px',marginBottom:14}}>
                            <span style={{fontSize:12,color:'#4ade80',fontWeight:600}}>✅ No carry-forward — all previous weeks are fully cleared</span>
                          </div>
                      )}

                      {/* Entries table */}
                      {customLoading && <div style={{textAlign:'center',padding:'16px',color:'#555',fontSize:13}}>⏳ Loading custom range...</div>}
                      <div className="table-wrap" style={{marginBottom:16}}>
                        {customEntries !== null && (() => {
                          const customTrips = customEntries.filter(e=>e.entryType==='Trip').reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0);
                          const customNet   = customEntries.reduce((s,e)=>s+(e.totalAmount||0)-(e.dieselCost||0)-(e.maintenanceCost||0),0);
                          const customGross = customEntries.reduce((s,e)=>s+(e.totalAmount||0),0);
                          const customDiesel = customEntries.reduce((s,e)=>s+(e.dieselCost||0),0);
                          const customMaint  = customEntries.reduce((s,e)=>s+(e.maintenanceCost||0),0);
                          return (
                              <>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:10}}>
                                  <div style={{background:'#0e1a0e',border:'1px solid #1a3a1a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Total Trips</div>
                                    <div style={{fontSize:22,fontWeight:800,color:'#4ade80'}}>{customTrips}</div>
                                  </div>
                                  <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Entries</div>
                                    <div style={{fontSize:22,fontWeight:800,color:'#eab308'}}>{customEntries.length}</div>
                                  </div>
                                  <div style={{background:'#0d1a2a',border:'1px solid #1e3a5a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#60a5fa',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Gross Amount</div>
                                    <div style={{fontSize:16,fontWeight:800,color:'#60a5fa'}}>₹{fmt(customGross)}</div>
                                  </div>
                                  <div style={{background:'#1a0e0e',border:'1px solid #3a1a1a',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#f87171',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Deductions</div>
                                    <div style={{fontSize:16,fontWeight:800,color:'#f87171'}}>−₹{fmt(customDiesel+customMaint)}</div>
                                  </div>
                                  <div style={{background:'#0a1a0a',border:'1px solid #166534',borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                                    <div style={{fontSize:10,color:'#4ade80',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Net Amount</div>
                                    <div style={{fontSize:16,fontWeight:800,color:'#4ade80'}}>₹{fmt(customNet)}</div>
                                  </div>
                                </div>
                                <div style={{background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:6,padding:'7px 14px',marginBottom:10,fontSize:12,color:'#3b82f6'}}>
                                  📅 <strong>{customFrom}</strong> → <strong>{customTo}</strong>
                                </div>
                              </>
                          );
                        })()}
                        <table>
                          <thead><tr><th>Date</th><th>Method</th><th>Details</th><th>Amount (₹)</th><th>⛽ Diesel</th><th>🔧 Maintenance</th><th>Net</th><th data-no-print="true"></th></tr></thead>
                          <tbody>
                          {(customEntries !== null ? customEntries : weeklyBill.entries).length===0
                              ? <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:20}}>{customEntries!==null?'No entries in this date range':'No entries this week'}</td></tr>
                              : (customEntries !== null ? customEntries : weeklyBill.entries).map(e=>(
                                  <tr key={e._id}>
                                    <td style={{color:'#ccc'}}>{fmtDay(e.date)}</td>
                                    <td><span className="badge badge-blue">{e.entryType}</span></td>
                                    <td style={{color:'#888'}}>
                                      {e.entryType==='Trip'   && `${e.numberOfTrips} trips × ₹${fmt(e.pricePerTrip)}`}
                                      {e.entryType==='Hourly' && `${e.hoursUsed} hrs × ₹${fmt(e.hourlyRate)}`}
                                      {e.entryType==='Daily'  && 'Daily charge'}
                                      {e.entryType==='Brass'  && `${e.brassQuantity} brass × ₹${fmt(e.brassRate)}`}
                                    </td>
                                    <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(e.totalAmount)}</td>
                                    <td style={{color: e.dieselCost>0?'#f87171':'#333'}}>{e.dieselCost>0?`−₹${fmt(e.dieselCost)}`:'—'}</td>
                                    <td style={{color: e.maintenanceCost>0?'#fb923c':'#333'}}>{e.maintenanceCost>0?`−₹${fmt(e.maintenanceCost)}`:'—'}</td>
                                    <td style={{color:'#4ade80',fontWeight:700}}>₹{fmt(e.totalAmount-(e.dieselCost||0)-(e.maintenanceCost||0))}</td>
                                    <td data-no-print="true">
                                      <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}}
                                              onClick={()=>handleDeleteEntry(e._id)}>🗑</button>
                                    </td>
                                  </tr>
                              ))
                          }
                          </tbody>
                          <tfoot>
                          <tr style={{borderTop:'1px solid #2a2a2a'}}>
                            <td colSpan={3} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>
                              Totals
                              {(()=>{ const t=(weeklyBill.entries||[]).filter(e=>e.entryType==='Trip').reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0); return t>0?<span style={{marginLeft:10,color:'#4ade80',fontWeight:700}}>{t} trips</span>:null; })()}
                            </td>
                            {(()=>{
                              const entries = weeklyBill.entries || [];
                              const totalAmt  = entries.reduce((s,e)=>s+(Number(e.totalAmount)||0),0);
                              const totalDsl  = entries.reduce((s,e)=>s+(Number(e.dieselCost)||0),0);
                              const totalMnt  = entries.reduce((s,e)=>s+(Number(e.maintenanceCost)||0),0);
                              return <>
                                <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(totalAmt)}</td>
                                <td style={{color:'#f87171',fontWeight:700,padding:'10px 16px'}}>{totalDsl>0?`−₹${fmt(totalDsl)}`:'—'}</td>
                                <td style={{color:'#fb923c',fontWeight:700,padding:'10px 16px'}}>{totalMnt>0?`−₹${fmt(totalMnt)}`:'—'}</td>
                                <td style={{color:'#4ade80',fontWeight:700,padding:'10px 16px'}}>₹{fmt(totalAmt-totalDsl-totalMnt)}</td>
                              </>;
                            })()}
                            <td data-no-print="true"></td>
                          </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Operator section — screen only, excluded from print */}
                      {selected?.ownershipType==='Own' && operatorWeeks.length>0 && (
                          <div style={{marginBottom:16}} ref={operatorRef} data-no-print="true">
                            <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                              <span>👷 Operator Charges</span>
                              <button className="btn btn-secondary" style={{padding:'4px 10px',fontSize:12}}
                                      onClick={()=>{
                                        const pokName = selected?.name||'Pokland';
                                        const week = weeklyBill?`${new Date(weeklyBill.weekStart).toLocaleDateString('en-IN')} to ${new Date(weeklyBill.weekEnd).toLocaleDateString('en-IN')}`: '';
                                        const totalPayable = operatorWeeks.filter(w=>w.cameAtAll).reduce((s,w)=>s+(w.weeklyAmount||0),0);
                                        let rn=1;
                                        const opRows = operatorWeeks.map(w=>{
                                          const bg=rn%2===0?'background:#f8fafc;':''; rn++;
                                          return `<tr style="${bg}">
                                            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${w.operator?.name||'—'}</td>
                                            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
                                              <span style="display:inline-block;background:${w.cameAtAll?'#dcfce7':'#fee2e2'};border:1px solid ${w.cameAtAll?'#86efac':'#fca5a5'};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;color:${w.cameAtAll?'#15803d':'#dc2626'};">${w.cameAtAll?`Present (${w.daysPresent.length} days)`:'Absent'}</span>
                                            </td>
                                            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">₹${Number(w.weeklyAmount||0).toLocaleString('en-IN')}</td>
                                            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:${w.cameAtAll?'#15803d':'#94a3b8'};">${w.cameAtAll?`₹${Number(w.weeklyAmount||0).toLocaleString('en-IN')}`:'₹0'}</td>
                                          </tr>`;
                                        }).join('');
                                        const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
                                        const opHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Operator Bill — ${pokName}</title>
                                        <style>
                                          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                                          *{box-sizing:border-box;margin:0;padding:0;}
                                          body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}
                                          table{width:100%;border-collapse:collapse;margin-bottom:16px;}
                                          th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}
                                          th.r{text-align:right;}
                                          td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;}
                                          tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}
                                        </style></head><body>
                                        <div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">${printTime}</div>
                                        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">
                                          <div style="display:flex;align-items:center;gap:12px;"><img src="${logo}" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div>
                                            <div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>
                                            <div style="font-size:11px;color:#64748b;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>
                                          </div></div>
                                          <div style="text-align:right;">
                                            <div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Operator Bill</div>
                                            <div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">${pokName}</div>
                                            <div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ${week}</div>
                                          </div>
                                        </div>
                                        <table>
                                          <thead><tr>
                                            <th>Operator</th><th>Status</th><th class="r">Weekly Amount</th><th class="r">Payable</th>
                                          </tr></thead>
                                          <tbody>${opRows}</tbody>
                                          <tfoot><tr>
                                            <td colspan="3" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Total Payable</td>
                                            <td style="background:#0f172a;color:#86efac;padding:11px 12px;font-weight:900;font-size:14px;text-align:right;">₹${totalPayable.toLocaleString('en-IN')}</td>
                                          </tr></tfoot>
                                        </table>
                                        <div style="display:flex;justify-content:space-between;margin-top:56px;">
                                          <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Operator Signature</div></div>
                                          <div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>
                                        </div>
                                        </body></html>`;
                                        let opIframe = document.getElementById('__op_bill_iframe__');
                                        if (!opIframe) {
                                          opIframe = document.createElement('iframe');
                                          opIframe.id = '__op_bill_iframe__';
                                          opIframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
                                          document.body.appendChild(opIframe);
                                        }
                                        const opDoc = opIframe.contentWindow.document;
                                        opDoc.open(); opDoc.write(opHtml); opDoc.close();
                                        setTimeout(() => {
                                          const prevTitle = document.title;
                                          document.title = pokName;
                                          opIframe.contentWindow.focus();
                                          opIframe.contentWindow.print();
                                          setTimeout(() => { document.title = prevTitle; }, 1000);
                                        }, 500);
                                      }}>🖨️ Print Operator Bill</button>
                            </div>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead><tr>{['Operator','Status','Weekly Amount','Payable',''].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
                              <tbody>
                              {operatorWeeks.map(w=>(
                                  <tr key={w._id}>
                                    <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{w.operator?.name}</td>
                                    <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}><span className={`badge ${w.cameAtAll?'badge-green':'badge-red'}`}>{w.cameAtAll?`Present (${w.daysPresent.length} days)`:'Absent — no pay'}</span></td>
                                    <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(w.weeklyAmount)}</td>
                                    <td style={{padding:'9px 12px',fontWeight:700,borderBottom:'1px solid #161616',color:w.cameAtAll?'#f87171':'#666'}}>{w.cameAtAll?`₹${fmt(w.weeklyAmount)}`:'₹0'}</td>
                                    <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}>
                                      <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}}
                                              onClick={()=>handleDeleteOpWeek(w._id, selected._id, billDate)}
                                              title="Remove from this week's billing">🗑</button>
                                    </td>
                                  </tr>
                              ))}
                              </tbody>
                            </table>
                            {/* Operator payment section — screen only */}
                            {billWeekStart && (
                                <div data-no-print="true">
                                  <PaySection
                                      netAmount={weeklyBill.totalOperatorCost}
                                      poklandId={selected._id}
                                      weekStart={billWeekStart}
                                      paymentFor="operator"
                                      refreshKey={payRefreshKey}
                                      onSaved={()=>{ setPayRefreshKey(k=>k+1); loadBill(selected._id, billDate); }}
                                  />
                                </div>
                            )}
                          </div>
                      )}

                      {/* Grand Total */}
                      {(() => {
                        const entries   = weeklyBill.entries || [];
                        const weekTrips = entries.filter(e=>e.entryType==='Trip').reduce((s,e)=>s+(Number(e.numberOfTrips)||0),0);
                        const totalAmt  = entries.reduce((s,e)=>s+(Number(e.totalAmount)||0),0);
                        const totalDsl  = entries.reduce((s,e)=>s+(Number(e.dieselCost)||0),0);
                        const totalMnt  = entries.reduce((s,e)=>s+(Number(e.maintenanceCost)||0),0);
                        const netAmt    = totalAmt - totalDsl - totalMnt;
                        const opCost    = weeklyBill.totalOperatorCost || 0;
                        const ownNet    = selected?.ownershipType==='Own' ? netAmt - opCost : netAmt;
                        const cf        = carryforward || 0;
                        const totalDue  = ownNet + cf;
                        const remaining = Math.max(0, totalDue - weekPaidAmount);
                        return (
                            <>
                              {weekTrips > 0 && (
                                  <div style={{background:'#0e1a0e',border:'1px solid #1a3a1a',borderRadius:8,padding:'10px 16px',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
                                    <span style={{fontSize:12,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Total Trips This Week:</span>
                                    <span style={{fontSize:20,fontWeight:700,color:'#4ade80'}}>{weekTrips} trips</span>
                                  </div>
                              )}

                              {/* ── This Week's Bill breakdown ── */}
                              <div style={{background:'#0e1400',border:'1px solid #2a2400',borderRadius:10,padding:16,marginBottom:10}}>
                                <div style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:12,fontWeight:700}}>📋 This Week's Bill</div>
                                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#ccc'}}>
                                    <span>Gross Amount</span>
                                    <span style={{fontWeight:700,color:'#eab308'}}>₹{fmt(totalAmt)}</span>
                                  </div>
                                  {totalDsl > 0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#f87171'}}>
                                    <span>⛽ Diesel Deduction</span><span style={{fontWeight:700}}>−₹{fmt(totalDsl)}</span>
                                  </div>}
                                  {totalMnt > 0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#fb923c'}}>
                                    <span>🔧 Maintenance Deduction</span><span style={{fontWeight:700}}>−₹{fmt(totalMnt)}</span>
                                  </div>}
                                  {selected?.ownershipType==='Own' && opCost > 0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#f87171'}}>
                                    <span>👷 Operator Cost</span><span style={{fontWeight:700}}>−₹{fmt(opCost)}</span>
                                  </div>}
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:15,fontWeight:800,color:'#4ade80',borderTop:'1px solid #2a2a2a',paddingTop:8,marginTop:4}}>
                                    <span>This Week Net</span>
                                    <span>₹{fmt(ownNet)}</span>
                                  </div>
                                </div>
                              </div>

                              {/* ── Previous Unpaid + Grand Total ── */}
                              <div style={{background:'#1a0e00',border:'1px solid #3a2000',borderRadius:10,padding:16}}>
                                <div style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:12,fontWeight:700}}>💰 Total Outstanding</div>
                                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#ccc'}}>
                                    <span>This Week Net</span>
                                    <span style={{fontWeight:700,color:'#4ade80'}}>₹{fmt(ownNet)}</span>
                                  </div>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:cf>0?'#f87171':'#555'}}>
                                    <span>⚠️ Previous Unpaid (carry-forward)</span>
                                    <span style={{fontWeight:700}}>{cf>0?`+₹${fmt(cf)}`:'₹0'}</span>
                                  </div>
                                  {weekPaidAmount > 0 && <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#4ade80'}}>
                                    <span>✅ Paid This Week</span><span style={{fontWeight:700}}>−₹{fmt(weekPaidAmount)}</span>
                                  </div>}
                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid #3a2a00',paddingTop:10,marginTop:6}}>
                                    <span style={{fontSize:14,fontWeight:700,color:'#fb923c'}}>Total Remaining to Pay</span>
                                    <span style={{fontSize:28,fontWeight:900,color:remaining>0?'#f87171':'#4ade80'}}>₹{fmt(remaining)}</span>
                                  </div>
                                </div>
                              </div>
                            </>
                        );
                      })()}

                      {/* Owner bill payment — screen only */}
                      {billWeekStart && (
                          <div data-no-print="true">
                            <PaySection
                                netAmount={(selected?.ownershipType==='Own' ? weeklyBill.netAmount : (weeklyBill.rentalNetAmount??weeklyBill.totalAmount)) + (carryforward||0)}
                                poklandId={selected._id}
                                weekStart={billWeekStart}
                                paymentFor={selected?.ownershipType==='Own' ? 'owner' : 'rental'}
                                refreshKey={payRefreshKey}
                                onSaved={()=>{ setPayRefreshKey(k=>k+1); loadBill(selected._id, billDate); }}
                            />
                          </div>
                      )}

                      <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16}}>
                        <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>{selected?.ownershipType==='Rental'?'Owner Signature':'Prepared By'}</div></div>
                        <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Authorised Signature</div></div>
                      </div>
                    </div>
                )}
              </div>
            </div>
        )}

        {/* Payment History Modal */}
        {payHistModal && (
            <div className="modal-overlay" onClick={()=>setPayHistModal(false)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>📜 Payment History</h3>
                  <button className="modal-close" onClick={()=>setPayHistModal(false)}>✕</button>
                </div>
                {payHistory.length === 0
                    ? <div style={{textAlign:'center',padding:32,color:'#444'}}>No payment records found.</div>
                    : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                            <tr>
                              <th>Week Start</th>
                              <th>Payment For</th>
                              <th>Total Bill (₹)</th>
                              <th>Amount Paid (₹)</th>
                              <th>Remaining (₹)</th>
                              <th>Status</th>
                              <th>Date</th>
                              <th>Note</th>
                            </tr>
                            </thead>
                            <tbody>
                            {payHistory.map((p,i)=>{
                              const remaining = Math.max(0,(p.totalBill||0)-(p.amountPaid||0));
                              return (
                                  <tr key={i}>
                                    <td style={{color:'#ccc'}}>{fmtDate(p.weekStart)}</td>
                                    <td><span className={`badge ${p.paymentFor==='owner'||p.paymentFor==='rental'?'badge-yellow':p.paymentFor==='operator'?'badge-blue':'badge-green'}`}>{p.paymentFor}</span></td>
                                    <td style={{color:'#eab308',fontWeight:600}}>₹{fmt(p.totalBill)}</td>
                                    <td style={{color:'#4ade80',fontWeight:600}}>₹{fmt(p.amountPaid)}</td>
                                    <td style={{color:remaining>0?'#f87171':'#4ade80',fontWeight:600}}>₹{fmt(remaining)}</td>
                                    <td>
                                      {p.isPaid
                                          ? <span className="badge badge-green">✅ Fully Paid</span>
                                          : p.isPartial
                                              ? <span className="badge badge-yellow">⚡ Partial</span>
                                              : <span className="badge badge-red">Unpaid</span>}
                                    </td>
                                    <td style={{color:'#888',fontSize:12}}>
                                      {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
                                    </td>
                                    <td style={{color:'#666',fontSize:12}}>{p.note||'—'}</td>
                                  </tr>
                              );
                            })}
                            </tbody>
                            <tfoot>
                            <tr style={{borderTop:'1px solid #2a2a2a'}}>
                              <td colSpan={2} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Totals</td>
                              <td style={{color:'#eab308',fontWeight:700,padding:'10px 16px'}}>₹{fmt(payHistory.reduce((s,p)=>s+(p.totalBill||0),0))}</td>
                              <td style={{color:'#4ade80',fontWeight:700,padding:'10px 16px'}}>₹{fmt(payHistory.reduce((s,p)=>s+(p.amountPaid||0),0))}</td>
                              <td style={{color:'#f87171',fontWeight:700,padding:'10px 16px'}}>₹{fmt(payHistory.reduce((s,p)=>s+Math.max(0,(p.totalBill||0)-(p.amountPaid||0)),0))}</td>
                              <td colSpan={3}></td>
                            </tr>
                            </tfoot>
                          </table>
                        </div>
                    )
                }
              </div>
            </div>
        )}

        {/* Operator Bill Modal */}
        {opBillModal && operatorBill && (
            <div className="modal-overlay" onClick={()=>setOpBillModal(false)}>
              <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Operator Weekly Bill — {operatorBill.pokland.name}</h3>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={handleOpBillPrint}>🖨️ Print</button>
                    <button onClick={handleSharePdfOpBill} style={{display:'flex',alignItems:'center',gap:6,background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </button>
                    <button className="modal-close" onClick={()=>setOpBillModal(false)}>✕</button>
                  </div>
                </div>
                <div ref={opBillRef}>
                  <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:12,marginBottom:16}}>
                    <div style={{fontSize:20,fontWeight:700,color:'#f0f0f0'}}>Pokland Operator Bill</div>
                    <div style={{fontSize:13,color:'#888',marginTop:4}}>
                      Pokland: <strong style={{color:'#eab308'}}>{operatorBill.pokland.name}</strong>
                      &nbsp;·&nbsp; Week: {new Date(operatorBill.weekStart).toLocaleDateString('en-IN')} to {new Date(operatorBill.weekEnd).toLocaleDateString('en-IN')}
                    </div>
                  </div>
                  <div className="table-wrap" style={{marginBottom:16}}>
                    <table>
                      <thead><tr><th>Operator</th><th>Days Present</th><th>Came This Week</th><th>Weekly Amount</th><th>Payable</th><th></th></tr></thead>
                      <tbody>
                      {operatorBill.operatorWeeks.length===0 && <tr><td colSpan={6} style={{textAlign:'center',color:'#444',padding:20}}>No operators assigned this week</td></tr>}
                      {operatorBill.operatorWeeks.map((w,i)=>(
                          <tr key={i}>
                            <td style={{fontWeight:600,color:'#f0f0f0'}}>{w.operator?.name}</td>
                            <td style={{color:'#888'}}>{w.daysPresent?.length||0} days</td>
                            <td><span className={`badge ${w.cameAtAll?'badge-green':'badge-red'}`}>{w.cameAtAll?'Yes — Full Pay':'No — No Pay'}</span></td>
                            <td style={{color:'#eab308'}}>₹{fmt(w.weeklyAmount)}</td>
                            <td style={{fontWeight:700,color:w.cameAtAll?'#4ade80':'#666'}}>₹{w.cameAtAll?fmt(w.weeklyAmount):'0'}</td>
                            <td>
                              <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}}
                                      onClick={async()=>{
                                        if(!window.confirm('Remove from this week?')) return;
                                        try {
                                          await api.delete(`/pokland/operator-week/${w._id}`);
                                          toast.success('Removed');
                                          const d = await api.get(`/pokland/${operatorBill.pokland._id}/operator-bill?date=${new Date(operatorBill.weekStart).toISOString()}`);
                                          setOperatorBill(d.data);
                                        } catch { toast.error('Error'); }
                                      }}>🗑</button>
                            </td>
                          </tr>
                      ))}
                      </tbody>
                      <tfoot>
                      <tr style={{borderTop:'1px solid #2a2a2a'}}>
                        <td colSpan={3} style={{color:'#666',padding:'10px 16px',fontWeight:600}}>Total Payable</td>
                        <td style={{color:'#4ade80',fontWeight:700,padding:'10px 16px',fontSize:16}} colSpan={2}>₹{fmt(operatorBill.totalOperatorCost)}</td>
                        <td></td>
                      </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Operator bill payment section — screen only */}
                  <div data-no-print="true">
                    <PaySection
                        netAmount={operatorBill.totalOperatorCost}
                        poklandId={operatorBill.pokland._id}
                        weekStart={getWeekStart(new Date(operatorBill.weekStart)).toISOString()}
                        paymentFor="operator"
                    />
                  </div>

                  <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16}}>
                    <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Operator Signature</div></div>
                    <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Authorised Signature</div></div>
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}