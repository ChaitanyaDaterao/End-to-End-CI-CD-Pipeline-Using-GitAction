import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
const logo = require('../assets/logo.jpg');

const fmt     = (n) => Number(n||0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});

const VEHICLE_TYPES = ['Truck','Tractor','JCB','Dumper','Mini Truck','Other'];
const emptyVehicle  = { vehicleNumber:'', vehicleType:'Truck', ownershipType:'Own', rentalOwnerName:'', rentalDate:'', rentalAmount:'', rentalAmountPerBrass:'', note:'' };
const emptyRateForm = { date: new Date().toISOString().slice(0,10), ratePerTrip: '', ratePerBrass: '', note: '' };

// ─── Inline editable cell ──────────────────────────────────────────────────────
function EditableCell({ value, color, prefix='₹', onSave, disabled=false }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const inputRef = useRef();

  const start = () => {
    if (disabled) return;
    setVal(Number(value||0));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = async () => {
    setEditing(false);
    const num = Number(val);
    if (num === Number(value||0)) return; // no change
    await onSave(num);
  };

  const onKey = (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
        <input
            ref={inputRef}
            type="number"
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            style={{
              width: 90, padding: '3px 6px', background: '#1a2a1a',
              border: '1px solid #4ade80', borderRadius: 4,
              color: color || '#4ade80', fontSize: 13, outline: 'none'
            }}
        />
    );
  }

  return (
      <span
          onClick={start}
          title={disabled ? '' : 'Click to edit'}
          style={{
            cursor: disabled ? 'default' : 'pointer',
            color: color || '#4ade80',
            fontWeight: 700,
            borderBottom: disabled ? 'none' : '1px dashed rgba(255,255,255,0.2)',
            paddingBottom: 1,
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderBottomColor = color || '#4ade80'; }}
          onMouseLeave={e => { if (!disabled) e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.2)'; }}
      >
      {prefix}{fmt(value)}
    </span>
  );
}

// ─── Daily add row (inside expanded breakdown) ────────────────────────────────
function DailyAddRow({ vehicleId, ownershipType, weekStart, weekEnd, onAdded }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ tripDate: '', trips: '', rent: '', diesel: '' });
  const isRental = ownershipType === 'Rental';

  const submit = async () => {
    if (!form.tripDate || !form.trips) return toast.error('Date and trips required');
    setSaving(true);
    try {
      await api.post(`/vehicles/${vehicleId}/trips`, {
        tripDate:      form.tripDate,
        numberOfTrips: Number(form.trips),
        billingType:   'Trip',
        source:        'Manual entry',
        destination:   '',
        dieselAmount:  !isRental ? Number(form.diesel||0) : 0,
        rentalTripRate: isRental ? (Number(form.trips) > 0 ? Number(form.rent||0)/Number(form.trips) : 0) : undefined,
      });
      toast.success('Entry added');
      setOpen(false);
      setForm({ tripDate:'', trips:'', rent:'', diesel:'' });
      onAdded();
    } catch(e) { toast.error(e.response?.data?.message||'Error'); }
    finally { setSaving(false); }
  };

  const cellSt = { paddingTop:6, paddingRight:12, paddingBottom:3, paddingLeft:0, color:'#555', fontWeight:600, fontSize:11, whiteSpace:'nowrap' };
  const inp = { background:'#0a0a0a', border:'1px solid #2a2a2a', borderRadius:4, color:'#e0e0e0', padding:'3px 6px', fontSize:12, outline:'none' };

  const ws = weekStart?.slice(0,10);
  const we = weekEnd?.slice(0,10);
  const outOfWeek = form.tripDate && (form.tripDate < ws || form.tripDate > we);

  if (!open) return (
      <tr>
        <td colSpan={4} style={{paddingTop:6, paddingBottom:0, paddingLeft:0, paddingRight:0}}>
          <button onClick={()=>setOpen(true)}
                  style={{background:'transparent',border:'1px dashed #1e3a1e',borderRadius:5,color:'#2a5a2a',fontSize:11,padding:'3px 12px',cursor:'pointer',width:'100%',textAlign:'left'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#4ade80';e.currentTarget.style.color='#4ade80';}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#1e3a1e';e.currentTarget.style.color='#2a5a2a';}}>
            + Add day
          </button>
        </td>
      </tr>
  );

  return (
      <>
        <tr style={{borderTop:'1px dashed #1a3a1a'}}>
          <td style={cellSt}>
            <input type="date" value={form.tripDate}
                   onChange={e=>setForm({...form,tripDate:e.target.value})}
                   style={{...inp,width:120, borderColor: outOfWeek ? '#eab308' : '#2a2a2a'}}/>
          </td>
          <td style={cellSt}>
            <input type="number" placeholder="Trips" value={form.trips}
                   onChange={e=>setForm({...form,trips:e.target.value})}
                   style={{...inp,width:55}}/>
          </td>
          <td style={{paddingTop:6, paddingBottom:0, paddingLeft:0, paddingRight:0}}>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {isRental
                  ? <input type="number" placeholder="Rent ₹" value={form.rent}
                           onChange={e=>setForm({...form,rent:e.target.value})}
                           style={{...inp,width:80}}/>
                  : <input type="number" placeholder="Diesel ₹" value={form.diesel}
                           onChange={e=>setForm({...form,diesel:e.target.value})}
                           style={{...inp,width:80}}/>
              }
              <button onClick={submit} disabled={saving}
                      style={{background:'#166534',border:'none',borderRadius:4,color:'#4ade80',padding:'3px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>
                {saving?'...':'✓'}
              </button>
              <button onClick={()=>setOpen(false)}
                      style={{background:'transparent',border:'1px solid #2a2a2a',borderRadius:4,color:'#555',padding:'3px 8px',cursor:'pointer',fontSize:11}}>
                ✕
              </button>
            </div>
          </td>
        </tr>
        {outOfWeek && (
            <tr>
              <td colSpan={4} style={{paddingTop:2,paddingBottom:4,paddingLeft:0,paddingRight:0}}>
                <span style={{fontSize:10,color:'#eab308'}}>⚠️ Date outside this week ({ws} – {we}). Saved but won't show here — switch to that week to view.</span>
              </td>
            </tr>
        )}
      </>
  );
}

// ─── Quick-add trip row ────────────────────────────────────────────────────────
function QuickAddRow({ vehicleId, ownershipType, weekStart, weekEnd, onAdded }) {
  const [open, setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm]   = useState({
    tripDate: new Date().toISOString().slice(0,10),
    numberOfTrips: '',
    dieselAmount:  '',
    rentalTripRate:'',
    rateApplied:   '',
    note: '',
  });

  const isOwn    = ownershipType === 'Own';
  const isRental = ownershipType === 'Rental';

  const submit = async () => {
    if (!form.numberOfTrips) return toast.error('Number of trips required');
    setSaving(true);
    try {
      await api.post(`/vehicles/${vehicleId}/trips`, {
        tripDate:      form.tripDate,
        numberOfTrips: Number(form.numberOfTrips),
        dieselAmount:  isOwn    ? Number(form.dieselAmount || 0) : 0,
        rentalTripRate: isRental ? Number(form.rentalTripRate || 0) : undefined,
        rateApplied:   Number(form.rateApplied || 0),
        billingType:   'Trip',
        note:          form.note,
        source:        'Manual entry',
        destination:   '',
      });
      toast.success('Entry added!');
      setOpen(false);
      setForm({ tripDate: new Date().toISOString().slice(0,10), numberOfTrips:'', dieselAmount:'', rentalTripRate:'', rateApplied:'', note:'' });
      onAdded();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error saving entry');
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
        <tr>
          <td colSpan={isOwn ? 7 : 4} style={{ padding: '6px 16px' }}>
            <button
                onClick={() => setOpen(true)}
                style={{
                  background: 'transparent', border: '1px dashed #2a2a2a',
                  borderRadius: 6, color: '#444', fontSize: 12, padding: '5px 14px',
                  cursor: 'pointer', width: '100%', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#4ade80'; e.currentTarget.style.color='#4ade80'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='#2a2a2a'; e.currentTarget.style.color='#444'; }}
            >
              + Add missing entry
            </button>
          </td>
        </tr>
    );
  }

  return (
      <tr style={{ background: '#0d1f0d', borderTop: '1px dashed #1a3a1a' }}>
        <td style={{ padding: '8px 16px' }}>
          <input type="date" value={form.tripDate}
                 onChange={e => setForm({...form, tripDate: e.target.value})}
                 min={weekStart?.slice(0,10)} max={weekEnd?.slice(0,10)}
                 style={inputStyle} />
        </td>
        <td style={{ padding: '8px 8px' }}>
          <input type="number" placeholder="Trips" value={form.numberOfTrips}
                 onChange={e => setForm({...form, numberOfTrips: e.target.value})}
                 style={{...inputStyle, width: 70}} />
        </td>
        {isOwn && <>
          <td style={{ padding: '8px 8px' }}>
            <input type="number" placeholder="Diesel ₹" value={form.dieselAmount}
                   onChange={e => setForm({...form, dieselAmount: e.target.value})}
                   style={{...inputStyle, width: 100}} />
          </td>
          <td colSpan={2} style={{ padding: '8px 8px' }}>
            <input type="number" placeholder="Bill rate/trip ₹" value={form.rateApplied}
                   onChange={e => setForm({...form, rateApplied: e.target.value})}
                   style={{...inputStyle, width: 120}} />
          </td>
        </>}
        {isRental && <>
          <td style={{ padding: '8px 8px' }}>
            <input type="number" placeholder="Rent rate/trip ₹" value={form.rentalTripRate}
                   onChange={e => setForm({...form, rentalTripRate: e.target.value})}
                   style={{...inputStyle, width: 130}} />
          </td>
        </>}
        <td colSpan={2} style={{ padding: '8px 8px' }}>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input placeholder="Note" value={form.note}
                   onChange={e => setForm({...form, note: e.target.value})}
                   style={{...inputStyle, width: 120}} />
            <button onClick={submit} disabled={saving}
                    style={{ background:'#166534', border:'none', borderRadius:5, color:'#4ade80',
                      padding:'5px 12px', cursor:'pointer', fontSize:12, fontWeight:600, whiteSpace:'nowrap' }}>
              {saving ? '...' : '✓ Save'}
            </button>
            <button onClick={() => setOpen(false)}
                    style={{ background:'transparent', border:'1px solid #2a2a2a', borderRadius:5,
                      color:'#666', padding:'5px 10px', cursor:'pointer', fontSize:12 }}>
              ✕
            </button>
          </div>
        </td>
      </tr>
  );
}

const inputStyle = {
  background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 4,
  color: '#e0e0e0', padding: '5px 8px', fontSize: 12, outline: 'none', width: '100%',
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Vehicles() {
  const [vehicles,    setVehicles]    = useState([]);
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('all');
  const [modal,       setModal]       = useState(null);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState(emptyVehicle);
  const [saving,      setSaving]      = useState(false);
  const [weekDate,    setWeekDate]    = useState(new Date().toISOString().slice(0,10));
  const summaryRef = useRef();

  const [rates,       setRates]       = useState([]);
  const [ratesLoading,setRatesLoading]= useState(false);
  const [rateForm,    setRateForm]    = useState(emptyRateForm);
  const [savingRate,  setSavingRate]  = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const toggleRow = (key) => setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/vehicles');
      setVehicles(data);
    } catch { toast.error('Failed to load vehicles'); }
    finally { setLoading(false); }
  }, []);

  const loadSummary = useCallback(async (date) => {
    try {
      const { data } = await api.get(`/vehicles/summary/weekly?date=${date}`);
      setSummary(data);
    } catch { toast.error('Failed to load summary'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Vehicle add/edit ──────────────────────────────────────────────────────
  const openAdd  = () => { setForm(emptyVehicle); setModal('add'); };
  const openEdit = (v) => {
    setSelected(v);
    setForm({
      vehicleNumber:   v.vehicleNumber,
      vehicleType:     v.vehicleType,
      ownershipType:   v.ownershipType,
      rentalOwnerName: v.rentalOwnerName || '',
      rentalDate:      v.rentalDate ? v.rentalDate.slice(0,10) : '',
      rentalAmount:         v.rentalAmount         || '',
      rentalAmountPerBrass: v.rentalAmountPerBrass  || '',
      note:            v.note || '',
    });
    setModal('edit');
  };

  const handleSave = async () => {
    if (!form.vehicleNumber) return toast.error('Vehicle number required');
    setSaving(true);
    try {
      if (modal === 'add') { await api.post('/vehicles', form); toast.success('Vehicle added'); }
      else { await api.put(`/vehicles/${selected._id}`, form); toast.success('Updated'); }
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this vehicle?')) return;
    try { await api.delete(`/vehicles/${id}`); toast.success('Removed'); load(); }
    catch { toast.error('Error'); }
  };

  // ── Daily rates modal ─────────────────────────────────────────────────────
  const openRates = async (v) => {
    setSelected(v);
    setRateForm({ ...emptyRateForm });
    setModal('rates');
    await loadRates(v._id);
  };

  const loadRates = async (vehicleId) => {
    setRatesLoading(true);
    try {
      const { data } = await api.get(`/vehicles/${vehicleId}/rental-rates`);
      setRates(data);
    } catch { toast.error('Failed to load rates'); }
    finally { setRatesLoading(false); }
  };

  const handleSaveRate = async () => {
    if (!rateForm.date) return toast.error('Date is required');
    if (!rateForm.ratePerTrip && !rateForm.ratePerBrass) return toast.error('Enter at least one rate');
    setSavingRate(true);
    try {
      await api.post(`/vehicles/${selected._id}/rental-rate`, {
        date:         rateForm.date,
        ratePerTrip:  rateForm.ratePerTrip,
        ratePerBrass: rateForm.ratePerBrass,
        note:         rateForm.note,
      });
      toast.success('Rate saved');
      setRateForm({ ...emptyRateForm });
      await loadRates(selected._id);
    } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
    finally { setSavingRate(false); }
  };

  const handleDeleteRate = async (rateId) => {
    if (!window.confirm('Delete this rate?')) return;
    try {
      await api.delete(`/vehicles/${selected._id}/rental-rate/${rateId}`);
      toast.success('Rate deleted');
      await loadRates(selected._id);
    } catch { toast.error('Error'); }
  };

  // ── Inline expense save helpers ───────────────────────────────────────────
  /**
   * Save a quick direct expense for an Own vehicle.
   * We POST a VehicleExpense record then reload the summary.
   * expenseType: 'Diesel' | 'Maintenance' | 'Other'
   */
  const saveExpense = async (vehicleId, expenseType, amount, weekStart, weekEnd) => {
    try {
      // Step 1: Delete all previous inline-edit expense records for this
      // vehicle + week + expenseType so that editing to 0 actually results in 0
      // instead of stacking on top of the previous amount.
      await api.delete('/vehicle-expenses/inline', {
        data: {
          vehicle:     vehicleId,
          expenseType,
          weekStart,
          weekEnd,
          note:        `Inline edit — ${expenseType}`,
        },
      });

      // Step 2: Only create a new record if the amount is non-zero.
      // If the user typed 0, the delete above is all that's needed.
      if (Number(amount) !== 0) {
        await api.post('/vehicle-expenses', {
          vehicle:     vehicleId,
          date:        weekStart,
          expenseType,
          amount,
          note:        `Inline edit — ${expenseType}`,
        });
      }

      toast.success(`${expenseType} updated`);
      await loadSummary(weekDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error saving expense');
    }
  };

  /**
   * Update rent amount for a rental vehicle trip summary.
   * We don't have a single trip ID here, so we update the vehicle's
   * default rentalAmount and re-load.
   */
  const saveRentalDefault = async (vehicleId, rentalAmount) => {
    try {
      await api.put(`/vehicles/${vehicleId}`, { rentalAmount });
      toast.success('Default rent rate updated');
      await loadSummary(weekDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error');
    }
  };

  // Save rent amount override for a rental vehicle week.
  // FIX: Use exact decimal rate (totalRent / trips) — never Math.round.
  // Math.round caused: 11000/6 → 1833 → 6×1833 = 10998 (snaps back!)
  //                    11002/6 → 1834 → 6×1834 = 11004 (doubles error!)
  // With exactRate:    11900/6 = 1983.3333 → 6×1983.3333 = 11900.00 ✓
  const saveRentOverride = async (vehicleId, numberOfTrips, totalRent, weekStart, weekEnd) => {
    try {
      const trips = numberOfTrips || 1;
      const exactRate = totalRent / trips; // exact decimal, no rounding
      await api.put(`/vehicles/${vehicleId}/trips/summary-override`, {
        weekStart,
        weekEnd,
        numberOfTrips: trips,
        rentalTripRate: exactRate,
      });
      toast.success('Rent amount updated');
      await loadSummary(weekDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error updating rent');
    }
  };

  // ── Inline cell save: trips ──────────────────────────────────────────────────
  // Calls PUT /vehicles/:id/trips/summary-override which:
  //   1. Deletes any previous 'Summary edit' trip records for the week
  //   2. Creates one clean record with exactly the number the user typed
  // This means editing always REPLACES, never duplicates.
  const saveTripAdjustment = async (vehicleId, ownershipType, numberOfTrips, dieselAmount, rentalTripRate, weekStart, weekEnd) => {
    try {
      await api.put(`/vehicles/${vehicleId}/trips/summary-override`, {
        weekStart,
        weekEnd,
        numberOfTrips,
        dieselAmount:   ownershipType === 'Own' ? (dieselAmount || 0) : 0,
        rentalTripRate: ownershipType === 'Rental' ? (rentalTripRate || 0) : undefined,
      });
      toast.success('Trips updated');
      await loadSummary(weekDate);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error saving trips');
    }
  };

  const filtered = vehicles.filter(v =>
      tab === 'all' ? true : tab === 'own' ? v.ownershipType === 'Own' : v.ownershipType === 'Rental'
  );

  if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

  return (
      <div>
        <div className="page-header">
          <h1 className="page-title">🚛 Vehicles</h1>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Vehicle</button>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card yellow">
            <div className="stat-icon">🚛</div>
            <div className="stat-info"><div className="stat-value">{vehicles.length}</div><div className="stat-label">Total Vehicles</div></div>
          </div>
          <div className="stat-card blue">
            <div className="stat-icon">🔑</div>
            <div className="stat-info"><div className="stat-value">{vehicles.filter(v=>v.ownershipType==='Own').length}</div><div className="stat-label">Own Vehicles</div></div>
          </div>
          <div className="stat-card red">
            <div className="stat-icon">📋</div>
            <div className="stat-info"><div className="stat-value">{vehicles.filter(v=>v.ownershipType==='Rental').length}</div><div className="stat-label">Rental Vehicles</div></div>
          </div>
          <div className="stat-card green">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <div className="stat-value">
                <button className="btn btn-secondary" style={{fontSize:12,padding:'4px 10px'}}
                        onClick={()=>{setTab('summary');loadSummary(weekDate);}}>View</button>
              </div>
              <div className="stat-label">Weekly Summary</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {['all','own','rental','summary'].map(t=>(
              <button key={t} className={`btn ${tab===t?'btn-primary':'btn-secondary'}`}
                      onClick={()=>{setTab(t);if(t==='summary')loadSummary(weekDate);}}>
                {t==='all'?'All Vehicles':t==='own'?'🔑 Own':t==='rental'?'📋 Rental':'📊 Weekly Summary'}
              </button>
          ))}
        </div>

        {/* ── Weekly Summary Tab ──────────────────────────────────────────────── */}
        {tab==='summary' && (
            <div>
              {/* Controls */}
              <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center'}}>
                <input type="date" value={weekDate}
                       onChange={e=>{setWeekDate(e.target.value);loadSummary(e.target.value);}}
                       style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                <button className="btn btn-primary" onClick={()=>loadSummary(weekDate)}>Refresh</button>

                {/* Edit hint */}
                <span style={{fontSize:11,color:'#444',marginLeft:4}}>
              💡 Click any value to edit inline · Use "+ Add missing entry" for new records
            </span>

                {/* Print */}
                {summary && (
                    <button className="btn btn-secondary" style={{marginLeft:'auto'}} onClick={()=>{
                      const printTime   = new Date().toLocaleString('en-IN');
                      const periodLabel = fmtDate(summary.weekStart) + ' to ' + fmtDate(summary.weekEnd);
                      const ownRows = summary.own.map((s, i) =>
                          '<tr style="' + (i % 2 === 1 ? 'background:#f8fafc;' : '') + '">' +
                          '<td style="font-weight:600;color:#0f172a;">' + s.vehicle.vehicleNumber + '</td>' +
                          '<td style="color:#64748b;">' + s.vehicle.vehicleType + '</td>' +
                          '<td style="color:#1d4ed8;font-weight:700;">' + s.totalTrips + '</td>' +
                          '<td style="color:#dc2626;font-weight:700;">&#8377;' + fmt(s.totalDiesel) + '</td>' +
                          '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.totalMaintenance) + '</td>' +
                          '<td style="color:#64748b;">&#8377;' + fmt(s.totalOthers) + '</td>' +
                          '<td style="color:#15803d;font-weight:800;">&#8377;' + fmt(s.totalExpenses) + '</td>' +
                          '</tr>'
                      ).join('');
                      const ownTotals = {
                        trips: summary.own.reduce((s,v)=>s+v.totalTrips,0),
                        diesel: summary.own.reduce((s,v)=>s+v.totalDiesel,0),
                        maint: summary.own.reduce((s,v)=>s+v.totalMaintenance,0),
                        others: summary.own.reduce((s,v)=>s+v.totalOthers,0),
                        exp: summary.own.reduce((s,v)=>s+v.totalExpenses,0),
                      };
                      const rentalRows = summary.rental.map((s, i) =>
                          '<tr style="' + (i % 2 === 1 ? 'background:#f8fafc;' : '') + '">' +
                          '<td style="font-weight:600;color:#0f172a;">' + s.vehicle.vehicleNumber + '</td>' +
                          '<td style="color:#64748b;">' + (s.vehicle.rentalOwnerName || '—') + '</td>' +
                          '<td style="color:#1d4ed8;font-weight:700;">' + s.totalTrips + '</td>' +
                          '<td style="color:#15803d;font-weight:800;">&#8377;' + fmt(s.totalRent || 0) + '</td>' +
                          '</tr>'
                      ).join('');
                      const rentalTotals = {
                        trips: summary.rental.reduce((s,v)=>s+v.totalTrips,0),
                        rent:  summary.rental.reduce((s,v)=>s+(v.totalRent||0),0),
                      };
                      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Vehicle Weekly Summary</title>' +
                          '<style>' +
                          "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');" +
                          '*{box-sizing:border-box;margin:0;padding:0;}' +
                          "body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:28px 36px;color:#0f172a;background:#fff;font-size:12px;}" +
                          'table{width:100%;border-collapse:collapse;margin-bottom:24px;}' +
                          'th{background:#0f172a;color:#f1f5f9;padding:9px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
                          'td{padding:9px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e2e8f0;}' +
                          'tfoot td{background:#0f172a;color:#f8fafc;padding:10px 12px;font-weight:800;font-size:12px;border-bottom:none;}' +
                          'h2{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;}' +
                          '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:14px 18px;}}' +
                          '</style></head><body>' +
                          '<div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">' + printTime + '</div>' +
                          '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:22px;">' +
                          '<div style="display:flex;align-items:center;gap:12px;">' +
                          '<img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
                          '<div>' +
                          '<div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
                          '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>' +
                          '</div></div>' +
                          '<div style="text-align:right;">' +
                          '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Vehicle Weekly Summary</div>' +
                          '<div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ' + periodLabel + '</div>' +
                          '</div></div>' +
                          '<h2>&#128273; Own Vehicles &mdash; ' + periodLabel + '</h2>' +
                          '<table><thead><tr><th>Vehicle</th><th>Type</th><th>Total Trips</th><th>Diesel (&#8377;)</th><th>Maintenance (&#8377;)</th><th>Others (&#8377;)</th><th>Total Expense (&#8377;)</th></tr></thead>' +
                          '<tbody>' + (ownRows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">No own vehicles</td></tr>') + '</tbody>' +
                          (summary.own.length > 0 ? '<tfoot><tr><td colspan="2">Total</td><td>' + ownTotals.trips + '</td><td>&#8377;' + fmt(ownTotals.diesel) + '</td><td>&#8377;' + fmt(ownTotals.maint) + '</td><td>&#8377;' + fmt(ownTotals.others) + '</td><td>&#8377;' + fmt(ownTotals.exp) + '</td></tr></tfoot>' : '') +
                          '</table>' +
                          '<h2>&#128203; Rental Vehicles &mdash; ' + periodLabel + '</h2>' +
                          '<table><thead><tr><th>Vehicle</th><th>Rental Owner</th><th>Total Trips</th><th>Rent Amount (&#8377;)</th></tr></thead>' +
                          '<tbody>' + (rentalRows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">No rental vehicles</td></tr>') + '</tbody>' +
                          (summary.rental.length > 0 ? '<tfoot><tr><td colspan="2">Total</td><td>' + rentalTotals.trips + '</td><td>&#8377;' + fmt(rentalTotals.rent) + '</td></tr></tfoot>' : '') +
                          '</table></body></html>';
                      let iframe = document.getElementById('__vehicle_summary_print_iframe__');
                      if (!iframe) {
                        iframe = document.createElement('iframe');
                        iframe.id = '__vehicle_summary_print_iframe__';
                        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
                        document.body.appendChild(iframe);
                      }
                      const iDoc = iframe.contentWindow.document;
                      iDoc.open(); iDoc.write(html); iDoc.close();
                      setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 500);
                    }}>🖨️ Print</button>
                )}
              </div>

              {!summary
                  ? <div style={{color:'#444',textAlign:'center',padding:32}}>Select date and click Refresh</div>
                  : (
                      <div ref={summaryRef} style={{display:'flex',flexDirection:'column',gap:20}}>

                        {/* ── Own Vehicles ─────────────────────────────────────────── */}
                        <div className="card">
                          <div style={{fontSize:15,fontWeight:700,color:'#f0f0f0',marginBottom:4,fontFamily:'Syne,sans-serif'}}>
                            🔑 Own Vehicles — {fmtDate(summary.weekStart)} to {fmtDate(summary.weekEnd)}
                          </div>
                          <div style={{fontSize:11,color:'#444',marginBottom:12}}>
                            Click any value (trips, diesel, maintenance, others) to edit it directly.
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                              <tr>
                                <th>Vehicle</th><th>Type</th><th>Total Trips</th>
                                <th>Diesel (₹)</th><th>Maintenance (₹)</th><th>Others (₹)</th><th>Total Expense (₹)</th>
                              </tr>
                              </thead>
                              <tbody>
                              {summary.own.length===0 && (
                                  <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:20}}>No own vehicles</td></tr>
                              )}
                              {summary.own.map((s,i)=>{
                                const rowKey = `own-${s.vehicle._id}`;
                                const isExpanded = !!expandedRows[rowKey];
                                return (
                                    <React.Fragment key={i}>
                                      <tr style={{cursor:'pointer'}} onClick={()=>toggleRow(rowKey)}>
                                        <td style={{fontWeight:600,color:'#f0f0f0'}}>
                                      <span style={{marginRight:6,fontSize:11,color:'#555',userSelect:'none'}}>
                                        {isExpanded ? '▼' : '▶'}
                                      </span>
                                          {s.vehicle.vehicleNumber}
                                        </td>
                                        <td style={{color:'#888'}}>{s.vehicle.vehicleType}</td>

                                        {/* Trips — add a new trip record */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalTrips}
                                              color="#fff"
                                              prefix=""
                                              onSave={async (newVal) => {
                                                if (!newVal || newVal === s.totalTrips) return;
                                                await saveTripAdjustment(s.vehicle._id, 'Own', newVal, 0, 0, summary.weekStart, summary.weekEnd);
                                              }}
                                          />
                                        </td>

                                        {/* Diesel */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalDiesel}
                                              color="#f87171"
                                              onSave={async (newVal) => {
                                                await saveExpense(s.vehicle._id, 'Diesel', newVal, summary.weekStart, summary.weekEnd);
                                              }}
                                          />
                                        </td>

                                        {/* Maintenance */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalMaintenance}
                                              color="#eab308"
                                              onSave={async (newVal) => {
                                                await saveExpense(s.vehicle._id, 'Maintenance', newVal, summary.weekStart, summary.weekEnd);
                                              }}
                                          />
                                        </td>

                                        {/* Others */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalOthers}
                                              color="#888"
                                              onSave={async (newVal) => {
                                                await saveExpense(s.vehicle._id, 'Other', newVal, summary.weekStart, summary.weekEnd);
                                              }}
                                          />
                                        </td>

                                        {/* Total (read only — computed) */}
                                        <td style={{color:'#4ade80',fontWeight:700}}>₹{fmt(s.totalExpenses)}</td>
                                      </tr>
                                      {/* ── Daily breakdown ── */}
                                      {isExpanded && s.dailyBreakdown && s.dailyBreakdown.length > 0 && (
                                          <tr>
                                            <td colSpan={7} style={{padding:0,background:'#080f08'}}>
                                              <div style={{padding:'8px 16px 8px 40px'}}>
                                                <table style={{width:'auto',fontSize:12,borderCollapse:'collapse'}}>
                                                  <thead>
                                                  <tr>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'left',whiteSpace:'nowrap'}}>Date</th>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'right',whiteSpace:'nowrap'}}>Trips</th>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'right',whiteSpace:'nowrap'}}>Diesel (₹)</th>
                                                    <th style={{padding:'4px 0 4px 0',color:'#555',fontWeight:600}}></th>
                                                  </tr>
                                                  </thead>
                                                  <tbody>
                                                  {s.dailyBreakdown.map((d,di)=>{
                                                    const dStr = d.date?.slice(0,10) || d.date;
                                                    return (
                                                        <tr key={di} style={{borderTop:'1px solid #111'}}>
                                                          <td style={{padding:'3px 20px 3px 0',color:'#888',whiteSpace:'nowrap'}}>
                                                            {new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',weekday:'short'})}
                                                          </td>
                                                          <td style={{padding:'3px 20px 3px 0',textAlign:'right'}}>
                                                            <EditableCell value={d.trips} color="#ccc" prefix=""
                                                                          onSave={async(v)=>{ await saveTripAdjustment(s.vehicle._id,'Own',v,0,0,dStr,dStr); }}/>
                                                          </td>
                                                          <td style={{padding:'3px 20px 3px 0',textAlign:'right'}}>
                                                            <EditableCell value={d.dieselAmount||0} color="#f87171"
                                                                          onSave={async(v)=>{ await saveExpense(s.vehicle._id,'Diesel',v,dStr,dStr); }}/>
                                                          </td>
                                                          <td style={{padding:'3px 0 3px 0'}}>
                                                            <button onClick={async()=>{
                                                              if(!window.confirm(`Delete entry for ${new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}?`)) return;
                                                              try { await api.delete(`/vehicles/${s.vehicle._id}/trips/by-date`,{data:{date:dStr}}); toast.success('Deleted'); loadSummary(weekDate); }
                                                              catch(e){ toast.error(e.response?.data?.message||'Error'); }
                                                            }} style={{background:'transparent',border:'none',color:'#444',cursor:'pointer',fontSize:12,padding:'1px 4px',borderRadius:3}}
                                                                    onMouseEnter={e=>e.currentTarget.style.color='#f87171'} onMouseLeave={e=>e.currentTarget.style.color='#444'}>🗑</button>
                                                          </td>
                                                        </tr>
                                                    );
                                                  })}
                                                  <DailyAddRow vehicleId={s.vehicle._id} ownershipType="Own" weekStart={summary.weekStart} weekEnd={summary.weekEnd} onAdded={()=>loadSummary(weekDate)}/>
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                      )}
                                      {isExpanded && (!s.dailyBreakdown || s.dailyBreakdown.length === 0) && (
                                          <tr>
                                            <td colSpan={7} style={{padding:0,background:'#080f08'}}>
                                              <div style={{padding:'8px 16px 8px 40px'}}>
                                                <table style={{width:'auto',fontSize:12,borderCollapse:'collapse'}}>
                                                  <tbody>
                                                  <DailyAddRow vehicleId={s.vehicle._id} ownershipType="Own" weekStart={summary.weekStart} weekEnd={summary.weekEnd} onAdded={()=>loadSummary(weekDate)}/>
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                      )}
                                    </React.Fragment>
                                );
                              })}

                              {/* Quick-add row for missing entries */}
                              {summary.own.length > 0 && (
                                  <QuickAddRow
                                      vehicleId={summary.own[0]?.vehicle?._id}
                                      ownershipType="Own"
                                      weekStart={summary.weekStart}
                                      weekEnd={summary.weekEnd}
                                      onAdded={()=>loadSummary(weekDate)}
                                  />
                              )}
                              </tbody>
                              {summary.own.length>0 && (
                                  <tfoot>
                                  <tr style={{borderTop:'1px solid #2a2a2a'}}>
                                    <td colSpan={2} style={{padding:'10px 16px',color:'#666',fontWeight:600}}>Total</td>
                                    <td style={{padding:'10px 16px',color:'#fff',fontWeight:700}}>{summary.own.reduce((s,v)=>s+v.totalTrips,0)}</td>
                                    <td style={{padding:'10px 16px',color:'#f87171',fontWeight:700}}>₹{fmt(summary.own.reduce((s,v)=>s+v.totalDiesel,0))}</td>
                                    <td style={{padding:'10px 16px',color:'#eab308',fontWeight:700}}>₹{fmt(summary.own.reduce((s,v)=>s+v.totalMaintenance,0))}</td>
                                    <td style={{padding:'10px 16px',color:'#888',fontWeight:700}}>₹{fmt(summary.own.reduce((s,v)=>s+v.totalOthers,0))}</td>
                                    <td style={{padding:'10px 16px',color:'#4ade80',fontWeight:700}}>₹{fmt(summary.own.reduce((s,v)=>s+v.totalExpenses,0))}</td>
                                  </tr>
                                  </tfoot>
                              )}
                            </table>
                          </div>
                        </div>

                        {/* ── Rental Vehicles ───────────────────────────────────────── */}
                        <div className="card">
                          <div style={{fontSize:15,fontWeight:700,color:'#f0f0f0',marginBottom:4,fontFamily:'Syne,sans-serif'}}>
                            📋 Rental Vehicles — {fmtDate(summary.weekStart)} to {fmtDate(summary.weekEnd)}
                          </div>
                          <div style={{fontSize:11,color:'#444',marginBottom:12}}>
                            Click trips or rent amount to edit. Rent amount updates the vehicle's default rate.
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                              <tr><th>Vehicle</th><th>Rental Owner</th><th>Total Trips</th><th>Rent Amount (₹)</th></tr>
                              </thead>
                              <tbody>
                              {summary.rental.length===0 && (
                                  <tr><td colSpan={4} style={{textAlign:'center',color:'#444',padding:20}}>No rental vehicles</td></tr>
                              )}
                              {summary.rental.map((s,i)=>{
                                const rowKey = `rental-${s.vehicle._id}`;
                                const isExpanded = !!expandedRows[rowKey];
                                return (
                                    <React.Fragment key={i}>
                                      <tr style={{cursor:'pointer'}} onClick={()=>toggleRow(rowKey)}>
                                        <td style={{fontWeight:600,color:'#f0f0f0'}}>
                                      <span style={{marginRight:6,fontSize:11,color:'#555',userSelect:'none'}}>
                                        {isExpanded ? '▼' : '▶'}
                                      </span>
                                          {s.vehicle.vehicleNumber}
                                        </td>
                                        <td style={{color:'#888'}}>{s.vehicle.rentalOwnerName||'—'}</td>

                                        {/* Trips */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalTrips}
                                              color="#fff"
                                              prefix=""
                                              onSave={async (newVal) => {
                                                if (!newVal || newVal === s.totalTrips) return;
                                                await saveTripAdjustment(
                                                    s.vehicle._id, 'Rental', newVal,
                                                    0,
                                                    s.vehicle.rentalAmount || 0,
                                                    summary.weekStart, summary.weekEnd
                                                );
                                              }}
                                          />
                                        </td>

                                        {/* Rent Amount */}
                                        <td onClick={e=>e.stopPropagation()}>
                                          <EditableCell
                                              value={s.totalRent || 0}
                                              color="#4ade80"
                                              onSave={async (newVal) => {
                                                if (newVal === (s.totalRent || 0)) return;
                                                // Pass totalRent directly — saveRentOverride handles exact decimal rate
                                                await saveRentOverride(s.vehicle._id, s.totalTrips, newVal, summary.weekStart, summary.weekEnd);
                                              }}
                                          />
                                        </td>
                                      </tr>
                                      {/* ── Daily breakdown ── */}
                                      {isExpanded && s.dailyBreakdown && s.dailyBreakdown.length > 0 && (
                                          <tr>
                                            <td colSpan={4} style={{padding:0,background:'#080f08'}}>
                                              <div style={{padding:'8px 16px 8px 40px'}}>
                                                <table style={{width:'auto',fontSize:12,borderCollapse:'collapse'}}>
                                                  <thead>
                                                  <tr>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'left',whiteSpace:'nowrap'}}>Date</th>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'right',whiteSpace:'nowrap'}}>Trips</th>
                                                    <th style={{padding:'4px 20px 4px 0',color:'#555',fontWeight:600,textAlign:'right',whiteSpace:'nowrap'}}>Rent (₹)</th>
                                                    <th style={{padding:'4px 0 4px 0',color:'#555',fontWeight:600}}></th>
                                                  </tr>
                                                  </thead>
                                                  <tbody>
                                                  {s.dailyBreakdown.map((d,di)=>{
                                                    const dStr = d.date?.slice(0,10) || d.date;
                                                    return (
                                                        <tr key={di} style={{borderTop:'1px solid #111'}}>
                                                          <td style={{padding:'3px 20px 3px 0',color:'#888',whiteSpace:'nowrap'}}>
                                                            {new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',weekday:'short'})}
                                                          </td>
                                                          <td style={{padding:'3px 20px 3px 0',textAlign:'right'}}>
                                                            <EditableCell value={d.trips} color="#ccc" prefix=""
                                                                          onSave={async(v)=>{ await saveTripAdjustment(s.vehicle._id,'Rental',v,0,s.vehicle.rentalAmount||0,dStr,dStr); }}/>
                                                          </td>
                                                          <td style={{padding:'3px 20px 3px 0',textAlign:'right'}}>
                                                            <EditableCell value={d.rentalAmount||0} color="#4ade80"
                                                                          onSave={async(v)=>{ await saveRentOverride(s.vehicle._id,d.trips,v,dStr,dStr); }}/>
                                                          </td>
                                                          <td style={{padding:'3px 0 3px 0'}}>
                                                            <button onClick={async()=>{
                                                              if(!window.confirm(`Delete entry for ${new Date(d.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}?`)) return;
                                                              try { await api.delete(`/vehicles/${s.vehicle._id}/trips/by-date`,{data:{date:dStr}}); toast.success('Deleted'); loadSummary(weekDate); }
                                                              catch(e){ toast.error(e.response?.data?.message||'Error'); }
                                                            }} style={{background:'transparent',border:'none',color:'#444',cursor:'pointer',fontSize:12,padding:'1px 4px',borderRadius:3}}
                                                                    onMouseEnter={e=>e.currentTarget.style.color='#f87171'} onMouseLeave={e=>e.currentTarget.style.color='#444'}>🗑</button>
                                                          </td>
                                                        </tr>
                                                    );
                                                  })}
                                                  <DailyAddRow vehicleId={s.vehicle._id} ownershipType="Rental" weekStart={summary.weekStart} weekEnd={summary.weekEnd} onAdded={()=>loadSummary(weekDate)}/>
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                      )}
                                      {isExpanded && (!s.dailyBreakdown || s.dailyBreakdown.length === 0) && (
                                          <tr>
                                            <td colSpan={4} style={{padding:0,background:'#080f08'}}>
                                              <div style={{padding:'8px 16px 8px 40px'}}>
                                                <table style={{width:'auto',fontSize:12,borderCollapse:'collapse'}}>
                                                  <tbody>
                                                  <DailyAddRow vehicleId={s.vehicle._id} ownershipType="Rental" weekStart={summary.weekStart} weekEnd={summary.weekEnd} onAdded={()=>loadSummary(weekDate)}/>
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                      )}
                                    </React.Fragment>
                                );
                              })}

                              {/* Quick-add row for each rental vehicle */}
                              {summary.rental.map((s,i)=>(
                                  <QuickAddRow
                                      key={`qa-rental-${i}`}
                                      vehicleId={s.vehicle._id}
                                      ownershipType="Rental"
                                      weekStart={summary.weekStart}
                                      weekEnd={summary.weekEnd}
                                      onAdded={()=>loadSummary(weekDate)}
                                  />
                              ))}
                              </tbody>
                              {summary.rental.length>0 && (
                                  <tfoot>
                                  <tr style={{borderTop:'1px solid #2a2a2a'}}>
                                    <td colSpan={2} style={{padding:'10px 16px',color:'#666',fontWeight:600}}>Total</td>
                                    <td style={{padding:'10px 16px',color:'#fff',fontWeight:700}}>{summary.rental.reduce((s,v)=>s+v.totalTrips,0)}</td>
                                    <td style={{padding:'10px 16px',color:'#4ade80',fontWeight:700}}>₹{fmt(summary.rental.reduce((s,v)=>s+(v.totalRent||0),0))}</td>
                                  </tr>
                                  </tfoot>
                              )}
                            </table>
                          </div>
                        </div>

                      </div>
                  )
              }
            </div>
        )}

        {/* ── Vehicle List ──────────────────────────────────────────────────────── */}
        {tab!=='summary' && (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                  <tr>
                    <th>Vehicle No.</th><th>Type</th><th>Ownership</th>
                    <th>Rental Owner</th><th>Default Rate/Trip (₹)</th><th>Default Rate/Brass (₹)</th><th>Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {filtered.length===0 && (
                      <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:32}}>No vehicles found.</td></tr>
                  )}
                  {filtered.map(v=>(
                      <tr key={v._id}>
                        <td style={{fontWeight:600,color:'#f0f0f0',fontSize:15}}>{v.vehicleNumber}</td>
                        <td>{v.vehicleType}</td>
                        <td><span className={`badge ${v.ownershipType==='Own'?'badge-green':'badge-yellow'}`}>{v.ownershipType}</span></td>
                        <td style={{color:'#888'}}>{v.rentalOwnerName||'—'}</td>
                        <td style={{color:'#eab308'}}>
                          {v.rentalAmount ? `₹${fmt(v.rentalAmount)}` : '—'}
                          {v.ownershipType==='Rental' && (
                              <span style={{color:'#555',fontSize:11,marginLeft:6}}>(default)</span>
                          )}
                        </td>
                        <td style={{color:'#a78bfa'}}>
                          {v.ownershipType==='Rental'
                              ? (v.rentalAmountPerBrass ? `₹${fmt(v.rentalAmountPerBrass)}/brass` : '—')
                              : '—'}
                        </td>
                        <td>
                          <div style={{display:'flex',gap:6}}>
                            {v.ownershipType==='Rental' && (
                                <button
                                    className="btn btn-secondary"
                                    style={{padding:'6px 10px',fontSize:12,color:'#eab308',borderColor:'#3a3000'}}
                                    onClick={()=>openRates(v)}
                                    title="Set daily rates">
                                  📅 Rates
                                </button>
                            )}
                            <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={()=>openEdit(v)}>✏️</button>
                            <button className="btn btn-danger"    style={{padding:'6px 10px',fontSize:12}} onClick={()=>handleDelete(v._id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>
        )}

        {/* ── Add / Edit Vehicle Modal ──────────────────────────────────────────── */}
        {(modal==='add'||modal==='edit') && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>{modal==='add'?'Add Vehicle':'Edit Vehicle'}</h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Vehicle Number *</label>
                    <input placeholder="e.g. MH-12-AB-1234" value={form.vehicleNumber}
                           onChange={e=>setForm({...form,vehicleNumber:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label>Vehicle Type *</label>
                    <select value={form.vehicleType} onChange={e=>setForm({...form,vehicleType:e.target.value})}>
                      {VEHICLE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Ownership *</label>
                    <select value={form.ownershipType} onChange={e=>setForm({...form,ownershipType:e.target.value})}>
                      <option value="Own">Own</option>
                      <option value="Rental">Rental</option>
                    </select>
                  </div>
                  {form.ownershipType==='Rental' && (<>
                    <div className="form-group">
                      <label>Rental Owner Name</label>
                      <input placeholder="Owner name" value={form.rentalOwnerName}
                             onChange={e=>setForm({...form,rentalOwnerName:e.target.value})}/>
                    </div>
                    <div className="form-group">
                      <label>Rental Date</label>
                      <input type="date" value={form.rentalDate}
                             onChange={e=>setForm({...form,rentalDate:e.target.value})}/>
                    </div>
                    <div className="form-group">
                      <label>Default Rate per Trip (₹)
                        <span style={{color:'#555',fontWeight:400,fontSize:11,marginLeft:6}}>— fallback when no daily rate set</span>
                      </label>
                      <input type="number" placeholder="0" value={form.rentalAmount}
                             onChange={e=>setForm({...form,rentalAmount:e.target.value})}/>
                    </div>
                    <div className="form-group">
                      <label>Default Rate per Brass (₹)
                        <span style={{color:'#555',fontWeight:400,fontSize:11,marginLeft:6}}>— fallback for quantity billing</span>
                      </label>
                      <input type="number" placeholder="0" value={form.rentalAmountPerBrass}
                             onChange={e=>setForm({...form,rentalAmountPerBrass:e.target.value})}/>
                    </div>
                  </>)}
                  <div className="form-group" style={{gridColumn:'1 / -1'}}>
                    <label>Note</label>
                    <input placeholder="Optional" value={form.note}
                           onChange={e=>setForm({...form,note:e.target.value})}/>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</button>
                </div>
              </div>
            </div>
        )}

        {/* ── Daily Rental Rates Modal ──────────────────────────────────────────── */}
        {modal==='rates' && selected && (
            <div className="modal-overlay" onClick={()=>setModal(null)}>
              <div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h3>
                    📅 Daily Rental Rates — {selected.vehicleNumber}
                    <span style={{fontSize:12,color:'#888',fontWeight:400,marginLeft:8}}>
                  {selected.rentalOwnerName||''}
                </span>
                  </h3>
                  <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                </div>

                <div style={{background:'#0e1a0e',border:'1px solid #1a3a1a',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#6abf6a',lineHeight:1.6}}>
                  <strong>How it works:</strong> Set a rate for any date below. When a trip is recorded
                  for this vehicle — from <em>any module</em> in the app — the system automatically looks
                  up the rate for that trip's date. If no daily rate is set for that date, it falls back
                  to the defaults: <strong style={{color:'#eab308'}}>₹{fmt(selected.rentalAmount)}/trip</strong>
                  {selected.rentalAmountPerBrass ? <> and <strong style={{color:'#a78bfa'}}>₹{fmt(selected.rentalAmountPerBrass)}/brass</strong></> : ''}.
                </div>

                <div style={{background:'#1a1a1a',border:'1px solid #2a2a2a',borderRadius:8,padding:16,marginBottom:20}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:12}}>Set Rate for a Date</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,alignItems:'flex-end'}}>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label>Date *</label>
                      <input type="date" value={rateForm.date}
                             onChange={e=>setRateForm({...rateForm,date:e.target.value})}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label>Rate per Trip (₹)</label>
                      <input type="number" placeholder="e.g. 1200" value={rateForm.ratePerTrip}
                             onChange={e=>setRateForm({...rateForm,ratePerTrip:e.target.value})}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label style={{color:'#a78bfa'}}>Rate per Brass (₹)</label>
                      <input type="number" placeholder="e.g. 80" value={rateForm.ratePerBrass}
                             onChange={e=>setRateForm({...rateForm,ratePerBrass:e.target.value})}/>
                    </div>
                    <div className="form-group" style={{marginBottom:0}}>
                      <label>Note (optional)</label>
                      <input placeholder="e.g. Long route" value={rateForm.note}
                             onChange={e=>setRateForm({...rateForm,note:e.target.value})}/>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
                    <button className="btn btn-primary" onClick={handleSaveRate} disabled={savingRate}>
                      {savingRate ? 'Saving...' : '+ Save Rate'}
                    </button>
                  </div>
                </div>

                <div style={{fontSize:13,fontWeight:600,color:'#888',marginBottom:10}}>Rate History (newest first)</div>
                {ratesLoading ? (
                    <div style={{color:'#444',textAlign:'center',padding:24}}>Loading...</div>
                ) : rates.length === 0 ? (
                    <div style={{color:'#444',textAlign:'center',padding:24,fontStyle:'italic'}}>
                      No daily rates set yet. Trips will use default rate ₹{fmt(selected.rentalAmount)}/trip
                      {selected.rentalAmountPerBrass ? ` and ₹${fmt(selected.rentalAmountPerBrass)}/brass` : ''}.
                    </div>
                ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                        <tr><th>Date</th><th>Rate / Trip (₹)</th><th>Rate / Brass (₹)</th><th>Note</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                        {rates.map((r,i)=>{
                          const isToday = new Date(r.date).toDateString() === new Date().toDateString();
                          return (
                              <tr key={r._id} style={isToday?{background:'rgba(234,179,8,0.05)'}:{}}>
                                <td style={{color: isToday?'#eab308':'#ccc', fontWeight: isToday?700:400}}>
                                  {fmtDate(r.date)}
                                  {isToday && <span style={{fontSize:10,marginLeft:6,background:'#3a2800',color:'#eab308',padding:'1px 6px',borderRadius:4}}>TODAY</span>}
                                </td>
                                <td style={{color:'#4ade80',fontWeight:700,fontSize:15}}>{r.ratePerTrip ? `₹${fmt(r.ratePerTrip)}` : '—'}</td>
                                <td style={{color:'#a78bfa',fontWeight:700,fontSize:15}}>{r.ratePerBrass ? `₹${fmt(r.ratePerBrass)}/brass` : '—'}</td>
                                <td style={{color:'#666',fontStyle:r.note?'normal':'italic'}}>{r.note||'—'}</td>
                                <td>
                                  <button className="btn btn-danger" style={{padding:'4px 8px',fontSize:11}}
                                          onClick={()=>handleDeleteRate(r._id)}>🗑</button>
                                </td>
                              </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    </div>
                )}

                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={()=>setModal(null)}>Close</button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}