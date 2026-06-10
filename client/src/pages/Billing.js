const logo = require('../assets/logo.jpg');
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
// Parse a date value safely — ISO strings from MongoDB are UTC, so we extract
// the YYYY-MM-DD part and build a local noon date to avoid IST rollback.
const safeDate = (d) => {
    if (!d) return new Date();
    const s = typeof d === 'string' ? d : new Date(d).toISOString();
    const [y, mo, day] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, mo - 1, day, 12, 0, 0, 0);
};
const fmtDate = (d) => safeDate(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (d) => safeDate(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit' });
const UNITS = ['brass', 'ton', 'kg', 'bag', 'cubic ft'];

// ── LOCAL date string (YYYY-MM-DD in browser local timezone, not UTC) ──
const toLocalDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const emptyCustomer = { name: '', phone: '', siteAddress: '', billingType: 'Trip', ratePerTrip: '', ratePerQuantity: '', note: '' };
const emptyVehicleEntry = { vehicleId: '', numberOfTrips: '', quantity: '', rateApplied: '', driverId: '', conductorId: '', dailyRent: '' };
const emptyDelivery = { date: new Date().toISOString().slice(0,10), billingType: 'Trip', quantityUnit: 'brass', material: 'Murum', destination: '', note: '', vehicles: [{ ...emptyVehicleEntry }] };
const emptyPayment = { amount: '', date: new Date().toISOString().slice(0,10), note: '' };

export default function Billing() {
    const [customers, setCustomers] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null);
    const [selected, setSelected] = useState(null);
    const [expandedCustomer, setExpandedCustomer] = useState(null);
    const [form, setForm] = useState(emptyCustomer);
    const [deliveryForm, setDeliveryForm] = useState(emptyDelivery);
    const [paymentForm, setPaymentForm] = useState(emptyPayment);
    const [billDate, setBillDate] = useState(new Date().toISOString().slice(0,10));
    const [billType, setBillType] = useState('weekly');
    const [bill, setBill] = useState(null);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('customers');
    const [earnings, setEarnings] = useState(null);
    const [earningsType, setEarningsType] = useState('weekly');
    const [earningsDate, setEarningsDate] = useState(new Date().toISOString().slice(0,10));
    const [earningsMonth, setEarningsMonth] = useState(new Date().toISOString().slice(0,7));
    const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().slice(0,10));
    const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().slice(0,10));
    const [payStatusModal, setPayStatusModal] = useState(null);
    const [payStatusForm, setPayStatusForm] = useState({isPaid:false,isPartial:false,amountPaid:'',note:'',date:new Date().toISOString().slice(0,10)});
    const [savingPay, setSavingPay] = useState(false);
    const [paymentsListModal, setPaymentsListModal] = useState(null); // {customerName, payments:[]}
    const [earningsSearch, setEarningsSearch] = useState('');
    const [deletingPaymentId, setDeletingPaymentId] = useState(null);
    const printRef = useRef();
    const earningsRef = useRef();
    const isPrinting = useRef(false);

    const load = useCallback(async () => {
        try {
            const [cRes, vRes, sRes] = await Promise.all([
                api.get('/billing/customers'),
                api.get('/billing/order-vehicles'),
                api.get('/billing/staff'),
            ]);
            setCustomers(cRes.data);
            setVehicles(vRes.data);
            setStaff(sRes.data);
        } catch { toast.error('Failed to load'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const loadEarnings = async (type, date, monthVal, startDate, endDate) => {
        try {
            let url;
            if (type === 'monthly') {
                const m = monthVal || earningsMonth;
                url = `/billing/earnings/summary?type=monthly&month=${m}`;
            } else if (type === 'custom') {
                const s = startDate || customStartDate;
                const e = endDate || customEndDate;
                url = `/billing/earnings/summary?type=custom&startDate=${s}&endDate=${e}`;
            } else {
                const d = date || earningsDate;
                url = `/billing/earnings/summary?date=${d}&type=${type}`;
            }
            const { data } = await api.get(url);
            setEarnings(data);
        } catch { toast.error('Failed to load earnings'); }
    };

    const handlePayStatus = async () => {
        if (!payStatusModal) return;
        const total = payStatusModal.total;
        const alreadyPaid = payStatusModal?.alreadyPaid || 0;
        const balanceDue = Math.max(0, total - alreadyPaid);
        if (payStatusForm.isPartial) {
            const amt = Number(payStatusForm.amountPaid) || 0;
            if (amt <= 0) return toast.error('Enter a valid amount');
            if (amt > balanceDue) return toast.error(`Amount cannot exceed ₹${fmt(balanceDue)}`);
        }
        setSavingPay(true);
        try {
            // Send only the NEW incremental amount — the backend accumulates the total
            const newEntryAmt = payStatusForm.isPaid
                ? balanceDue   // backend will add remaining balance as one entry
                : payStatusForm.isPartial
                    ? Number(payStatusForm.amountPaid) || 0
                    : 0;
            const paidDate = payStatusForm.date || new Date().toISOString().slice(0,10);
            await api.post('/billing/payment-status', {
                customerId: payStatusModal.customerId,
                date: earningsDate,       // backend derives weekStart from this
                totalBill: total,
                amountPaid: newEntryAmt,  // incremental, backend accumulates
                isPaid: payStatusForm.isPaid,
                isPartial: payStatusForm.isPartial,
                note: payStatusForm.note,
                paidDate,
            });
            toast.success(payStatusForm.isPaid ? '✅ Marked as fully paid' : `⚠️ Partial ₹${fmt(newEntryAmt)} recorded`);
            setPayStatusModal(null);
            await loadEarnings(earningsType, earningsDate, earningsMonth, customStartDate, customEndDate);
        } catch { toast.error('Error saving'); }
        finally { setSavingPay(false); }
    };

    // ── NEW: Delete payment status (hard delete) ──
    const handleDeletePayStatus = async (customerId) => {
        if (!window.confirm('Delete this payment record? This will clear the paid/partial status and reverse the recorded amount.')) return;
        try {
            await api.delete(`/billing/payment-status/${customerId}?date=${earningsDate}`);
            toast.success('Payment record deleted');
            await loadEarnings(earningsType, earningsDate, earningsMonth, customStartDate, customEndDate);
        } catch { toast.error('Error deleting payment'); }
    };

    // Delete a single payment entry (from earnings payments modal)
    const handleDeleteSinglePayment = async (paymentId) => {
        if (!window.confirm('Delete this payment entry?')) return;
        setDeletingPaymentId(paymentId);
        try {
            await api.delete(`/billing/payments/${paymentId}`);
            toast.success('Payment deleted');
            // Remove from modal list
            const updatedPayments = paymentsListModal
                ? paymentsListModal.payments.filter(p => p._id !== paymentId)
                : [];
            if (paymentsListModal) {
                setPaymentsListModal(prev => prev ? { ...prev, payments: updatedPayments } : null);
            }
            // Sync the BillingPaymentStatus total after deletion
            await api.post('/billing/payments/sync-status', {
                customerId: paymentsListModal?.payments.find(p=>p._id===paymentId)?.customer || paymentsListModal?.paymentStatus?.customer,
                date: earningsDate,
            }).catch(()=>{}); // best-effort sync
            await loadEarnings(earningsType, earningsDate, earningsMonth, customStartDate, customEndDate);
        } catch { toast.error('Error deleting payment'); }
        finally { setDeletingPaymentId(null); }
    };

    const openAdd = () => { setForm(emptyCustomer); setModal('add'); };
    const openEdit = (c) => {
        setSelected(c);
        setForm({ name: c.name, phone: c.phone, siteAddress: c.siteAddress, billingType: c.billingType, ratePerTrip: c.ratePerTrip, ratePerQuantity: c.ratePerQuantity, note: c.note });
        setModal('edit');
    };
    const openDelivery = (c) => {
        setSelected(c);
        const rate = c.billingType === 'Trip' ? c.ratePerTrip : c.ratePerQuantity;
        setDeliveryForm({ ...emptyDelivery, billingType: c.billingType, destination: c.siteAddress || '', vehicles: [{ ...emptyVehicleEntry, rateApplied: rate }] });
        setModal('delivery');
    };
    const openPayment = (c) => { setSelected(c); setPaymentForm(emptyPayment); setModal('payment'); };
    const openBill = async (c) => {
        setSelected(c); setBill(null); setModal('bill');
        await loadBill(c._id, billDate, billType);
    };

    const loadBill = async (id, date, type) => {
        try {
            const { data } = await api.get(`/billing/${type}/${id}?date=${date}`);
            setBill(data);
        } catch { toast.error('Failed to load bill'); }
    };

    const handleSave = async () => {
        if (!form.name) return toast.error('Name required');
        if (!form.siteAddress) return toast.error('Site address required');
        setSaving(true);
        try {
            if (modal === 'add') { await api.post('/billing/customers', form); toast.success('Customer added'); }
            else { await api.put(`/billing/customers/${selected._id}`, form); toast.success('Updated'); }
            setModal(null); load();
        } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this customer?')) return;
        try { await api.delete(`/billing/customers/${id}`); toast.success('Removed'); load(); }
        catch { toast.error('Error'); }
    };

    const addVehicleRow = () => {
        const rate = selected?.billingType === 'Trip' ? selected?.ratePerTrip : selected?.ratePerQuantity;
        setDeliveryForm(f => ({ ...f, vehicles: [...f.vehicles, { ...emptyVehicleEntry, rateApplied: rate || '' }] }));
    };
    const removeVehicleRow = (i) => {
        setDeliveryForm(f => ({ ...f, vehicles: f.vehicles.filter((_, idx) => idx !== i) }));
    };
    const updateVehicleRow = (i, field, value) => {
        setDeliveryForm(f => {
            const vehicles = [...f.vehicles];
            vehicles[i] = { ...vehicles[i], [field]: value };
            return { ...f, vehicles };
        });
    };

    const handleDelivery = async () => {
        const validVehicles = deliveryForm.vehicles.filter(v => v.vehicleId && v.rateApplied);
        if (validVehicles.length === 0) return toast.error('Add at least one vehicle with rate');
        for (const v of validVehicles) {
            if (deliveryForm.billingType === 'Trip' && !v.numberOfTrips) return toast.error('Enter trips for all vehicles');
            if (deliveryForm.billingType === 'Quantity' && !v.numberOfTrips) return toast.error('Enter trip count for all vehicles');
            if (deliveryForm.billingType === 'Quantity' && !v.quantity) return toast.error('Enter quantity for all vehicles');
        }
        setSaving(true);
        try {
            await api.post('/billing/deliveries', {
                ...deliveryForm,
                customerId: selected._id,
                vehicles: validVehicles.map(v => ({
                    vehicleId: v.vehicleId,
                    numberOfTrips: v.numberOfTrips,
                    quantity: v.quantity,
                    rateApplied: v.rateApplied,
                    driverId: v.driverId || null,
                    conductorId: v.conductorId || null,
                    dailyRent: v.dailyRent || 0,
                }))
            });
            toast.success('Order placed — vehicles, staff & bills updated automatically! ✅');
            setModal(null);
        } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
        finally { setSaving(false); }
    };

    const handlePayment = async () => {
        if (!paymentForm.amount || Number(paymentForm.amount) <= 0) return toast.error('Enter valid amount');
        setSaving(true);
        try {
            await api.post('/billing/payments', { ...paymentForm, customerId: selected._id });
            toast.success('Payment recorded');
            if (modal === 'payment' && bill) await loadBill(selected._id, billDate, billType);
            setModal(null);
        } catch (e) { toast.error(e.response?.data?.message || 'Error'); }
        finally { setSaving(false); }
    };

    const handleDeleteDelivery = async (id) => {
        try { await api.delete(`/billing/deliveries/${id}`); toast.success('Deleted'); await loadBill(selected._id, billDate, billType); }
        catch { toast.error('Error'); }
    };
    const handleDeletePayment = async (id) => {
        try { await api.delete(`/billing/payments/${id}`); toast.success('Deleted'); await loadBill(selected._id, billDate, billType); }
        catch { toast.error('Error'); }
    };

    const handlePrint = () => {
        if (!bill) return;
        const cust = bill.customer;
        const isWeekly = billType === 'weekly';
        const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});

        const period = isWeekly
            ? fmtDate(bill.weekStart) + ' to ' + fmtDate(bill.weekEnd)
            : 'Date: ' + fmtDate(bill.date);
        // ── Build delivery rows ──
        const buildDeliveryRows = (deliveries) => {
            let rn = 1;
            return deliveries.map(d =>
                d.vehicles.map((ve, vi) => {
                    const bg = rn%2===0 ? 'background:#f8fafc;' : '';
                    const isTrip = d.billingType === 'Trip';
                    const qty = isTrip ? `${ve.numberOfTrips} trip${ve.numberOfTrips!==1?'s':''}` : `${ve.quantity} ${d.quantityUnit||''}`;
                    const rate = ve.rateApplied ? '₹' + fmt(ve.rateApplied) + (isTrip ? '/trip' : '/' + (d.quantityUnit||'unit')) : '—';
                    const calcLine = ve.rateApplied
                        ? (isTrip
                            ? `${ve.numberOfTrips} trip${ve.numberOfTrips!==1?'s':''} × ₹${fmt(ve.rateApplied)}`
                            : `${ve.quantity} ${d.quantityUnit||'unit'} × ₹${fmt(ve.rateApplied)}`)
                        : qty;
                    const addressLabel = d.destination || '—';
                    const vBadge = `<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;">${ve.vehicle?.vehicleNumber||'—'}</span>`;
                    const row = vi===0 ? `<tr style="${bg}">
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rn}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(d.date)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#374151;">${addressLabel}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${d.material||'—'}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${qty}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;white-space:nowrap;">${calcLine}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadge}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(ve.totalAmount)}</td>
          </tr>` : `<tr style="${bg}">
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${qty}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;white-space:nowrap;">${calcLine}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadge}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(ve.totalAmount)}</td>
          </tr>`;
                    if (vi === 0) rn++;
                    return row;
                }).join('')
            ).join('');
        };

        // ── Weekly: group by day with day-group headers ──
        let tableBody = '';
        if (isWeekly) {
            tableBody = (bill.dailyGroups || []).map(group => {
                const dayTotal = group.deliveries.reduce((s,d)=>s+d.totalAmount,0);
                const dayTrips = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0);
                const dayQty   = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0);
                const unit     = group.deliveries.find(d=>d.quantityUnit)?.quantityUnit||'units';
                const qtyLabel = dayTrips>0&&dayQty===0?`${dayTrips} trips`:dayQty>0&&dayTrips===0?`${dayQty} ${unit}`:`${dayTrips} trips + ${dayQty} ${unit}`;
                return `
          <tr><td colspan="8" style="padding:9px 12px;background:#f1f5f9;font-weight:700;color:#334155;font-size:12px;border-bottom:1px solid #e2e8f0;border-top:2px solid #cbd5e1;">📅 ${fmtDay(group.date)}</td></tr>
          ${buildDeliveryRows(group.deliveries)}
          <tr style="background:#fefce8;">
            <td colspan="4" style="padding:8px 12px;font-weight:700;color:#92400e;font-size:12px;border-bottom:2px solid #fde68a;">Day Total</td>
            <td style="padding:8px 12px;text-align:center;font-weight:800;color:#92400e;border-bottom:2px solid #fde68a;">${qtyLabel}</td>
            <td style="border-bottom:2px solid #fde68a;"></td>
            <td style="border-bottom:2px solid #fde68a;"></td>
            <td style="padding:8px 12px;text-align:right;font-weight:800;color:#92400e;border-bottom:2px solid #fde68a;">₹${fmt(dayTotal)}</td>
          </tr>`;
            }).join('');
        } else {
            tableBody = buildDeliveryRows(bill.deliveries);
        }

        // ── Payments section (weekly only) — all payments, no date filter ──
        const allWeekPayments = bill.weekPayments || [];
        const cleanNote = (note) => {
            if (!note) return '—';
            return note.replace(/^__auto_crossweek__(?::|)\s*/, '').replace(/^__auto__(?::|)\s*/, '').trim() || '—';
        };
        const paymentsHTML = isWeekly && allWeekPayments.length > 0 ? `
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">💰 Payments Recorded</div>
        <table>
          <thead><tr>
            <th>#</th>
            <th>Payment Date</th>
            <th style="text-align:right;">Amount (₹)</th>
            <th>Note</th>
          </tr></thead>
          <tbody>${allWeekPayments.map((p,i)=>`<tr style="${i%2===0?'':'background:#f8fafc;'}">
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:11px;">${i+1}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">${fmtDate(p.date)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d;">₹${fmt(p.amount)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${cleanNote(p.note)}</td>
          </tr>`).join('')}
          <tr style="background:#f0fdf4;">
            <td colspan="2" style="padding:9px 12px;font-weight:700;color:#15803d;font-size:12px;">Total Paid</td>
            <td style="padding:9px 12px;text-align:right;font-weight:900;color:#15803d;font-size:14px;">₹${fmt(allWeekPayments.reduce((s,p)=>s+(p.amount||0),0))}</td>
            <td></td>
          </tr>
          </tbody>
        </table>
      </div>` : '';

        // ── Totals section ──
        const totalTrips = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0)||0;
        const totalQty   = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0)||0;
        const unit       = bill.deliveries?.find(d=>d.quantityUnit)?.quantityUnit||'units';
        const tripsLabel = totalTrips>0&&totalQty===0?`${totalTrips} trips`:totalQty>0&&totalTrips===0?`${totalQty} ${unit}`:`${totalTrips} trips + ${totalQty} ${unit}`;
        const grandTotal = isWeekly ? (bill.carriedBalance||0) + bill.weekTotal : bill.totalAmount;
        const paid       = isWeekly ? (bill.weekPayments||[]).reduce((s,p)=>s+(p.amount||0),0) : 0;
        const netDue     = isWeekly ? (bill.netDue ?? Math.max(0, grandTotal - paid)) : bill.totalAmount;

        isPrinting.current = true;

        const billTitle = (isWeekly ? 'Weekly' : 'Daily') + ' Bill — ' + cust.name;
        const phoneHTML = cust.phone ? '<strong>Phone:</strong> ' + cust.phone + '<br/>' : '';
        const siteHTML  = cust.siteAddress ? '<strong>Site:</strong> ' + cust.siteAddress : '';

        const printHTML = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>' + billTitle + '</title>' +
            '<style>' +
            "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');" +
            '*{box-sizing:border-box;margin:0;padding:0;}' +
            "body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;}" +
            'table{width:100%;border-collapse:collapse;margin-bottom:16px;}' +
            'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
            'th.r{text-align:right;} th.c{text-align:center;}' +
            'td{font-size:12px;color:#374151;}' +
            'tfoot{display:table-row-group!important;}' +
            'tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}' +
            '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:18px 24px;}}' +
            '</style></head><body>' +
            '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' + printTime + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;">' +
            '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
            '<div>' +
            '<div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
            '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>' +
            '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
            '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Outstanding Bill</div>' +
            '<div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">' + cust.name + '</div>' +
            '<div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ' + period + '</div>' +
            '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;">' + phoneHTML + siteHTML + '</div>' +
            '<div style="display:flex;gap:14px;margin-bottom:20px;">' +
            '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;">' +
            '<div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div>' +
            '<div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹' + fmt(isWeekly ? bill.weekTotal : bill.totalAmount) + '</div>' +
            '</div>' +
            '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;">' +
            '<div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Amount Paid</div>' +
            '<div style="font-size:22px;font-weight:900;color:#15803d;">₹' + fmt(paid) + '</div>' +
            '</div>' +
            '<div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;">' +
            '<div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Outstanding</div>' +
            '<div style="font-size:22px;font-weight:900;color:#c2410c;">₹' + fmt(netDue) + '</div>' +
            '</div>' +
            '</div>' +
            '<table>' +
            '<thead><tr>' +
            '<th style="width:32px;">#</th>' +
            '<th>Date</th>' +
            '<th>Address</th>' +
            '<th>Material</th>' +
            '<th class="c">Trips / Qty</th>' +
            '<th>Calculation</th>' +
            '<th>Vehicles</th>' +
            '<th class="r">Amount (₹)</th>' +
            '</tr></thead>' +
            '<tbody>' + (tableBody || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">No deliveries</td></tr>') + '</tbody>' +
            '<tfoot><tr>' +
            '<td colspan="4" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Grand Total Billed</td>' +
            '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:center;font-weight:800;">' + tripsLabel + '</td>' +
            '<td style="background:#0f172a;padding:11px 12px;"></td>' +
            '<td style="background:#0f172a;padding:11px 12px;"></td>' +
            '<td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:right;font-weight:900;font-size:14px;">₹' + fmt(isWeekly ? bill.weekTotal : bill.totalAmount) + '</td>' +
            '</tr></tfoot>' +
            '</table>' +
            paymentsHTML +
            '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">' +
            '<div style="width:360px;">' +
            (isWeekly && bill.carriedBalance > 0
                ? '<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;"><span>⚠️ Carried from Previous Week</span><span style="font-weight:700;">₹' + fmt(bill.carriedBalance) + '</span></div>'
                : '') +
            '<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;">' +
            '<span style="color:#475569;">' + (isWeekly ? 'This Week' : 'Daily') + ' Billed</span>' +
            '<span style="font-weight:700;">₹' + fmt(isWeekly ? bill.weekTotal : bill.totalAmount) + '</span>' +
            '</div>' +
            (isWeekly
                ? '<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:800;"><span>Grand Total Billed</span><span>₹' + fmt(grandTotal) + '</span></div>'
                : '') +
            '<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#15803d;">' +
            '<span>✓ Total Paid</span><span style="font-weight:700;">₹' + fmt(paid) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:10px 14px;background:#ffedd5;border:2px solid #fdba74;border-radius:8px;margin-top:6px;">' +
            '<span style="font-size:14px;font-weight:700;color:#c2410c;">⏳ Net Outstanding</span>' +
            '<span style="font-size:20px;font-weight:900;color:#c2410c;">₹' + fmt(netDue) + '</span>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:56px;">' +
            '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Customer Signature</div></div>' +
            '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
            '</div>' +
            '</body></html>';

        // Use hidden iframe instead of window.open to avoid opening a new tab
        let iframe = document.getElementById('__bill_print_iframe__');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = '__bill_print_iframe__';
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
            document.body.appendChild(iframe);
        }
        const iDoc = iframe.contentWindow.document;
        iDoc.open(); iDoc.write(printHTML); iDoc.close();
        iframe.contentWindow.onafterprint = () => { isPrinting.current = false; };
        setTimeout(() => {
            const prevTitle = document.title;
            document.title = cust.name;
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            isPrinting.current = false;
            setTimeout(() => { document.title = prevTitle; }, 1000);
        }, 500);
    };

    const handleWhatsAppShare = async () => {
        if (!bill) return;
        const cust = bill.customer;
        const fileName = `bill-${cust.name.replace(/\s+/g,'-')}-${billDate}.png`;

        // ── Re-use the exact same printHTML that handlePrint builds ──
        // We render it into a hidden off-screen div, capture with html2canvas, then share
        const isWeekly = billType === 'weekly';
        const printTime = new Date().toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
        const period = isWeekly ? fmtDate(bill.weekStart)+' to '+fmtDate(bill.weekEnd) : 'Date: '+fmtDate(bill.date);

        const buildDeliveryRows = (deliveries) => {
            let rn = 1;
            return deliveries.map(d =>
                d.vehicles.map((ve, vi) => {
                    const bg = rn%2===0 ? 'background:#f8fafc;' : '';
                    const isTrip = d.billingType === 'Trip';
                    const qty = isTrip ? `${ve.numberOfTrips} trip${ve.numberOfTrips!==1?'s':''}` : `${ve.quantity} ${d.quantityUnit||''}`;
                    const calcLine = ve.rateApplied ? (isTrip ? `${ve.numberOfTrips} trip${ve.numberOfTrips!==1?'s':''} × ₹${fmt(ve.rateApplied)}` : `${ve.quantity} ${d.quantityUnit||'unit'} × ₹${fmt(ve.rateApplied)}`) : qty;
                    const addressLabel = d.destination || '—';
                    const vBadge = `<span style="display:inline-block;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;color:#334155;">${ve.vehicle?.vehicleNumber||'—'}</span>`;
                    const row = vi===0 ? `<tr style="${bg}"><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${rn}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(d.date)}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#374151;">${addressLabel}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${d.material||'—'}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${qty}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;white-space:nowrap;">${calcLine}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadge}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(ve.totalAmount)}</td></tr>`
                        : `<tr style="${bg}"><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1d4ed8;">${qty}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;white-space:nowrap;">${calcLine}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${vBadge}</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">₹${fmt(ve.totalAmount)}</td></tr>`;
                    if (vi===0) rn++;
                    return row;
                }).join('')
            ).join('');
        };

        let tableBody = '';
        if (isWeekly) {
            tableBody = (bill.dailyGroups||[]).map(group => {
                const dayTotal = group.deliveries.reduce((s,d)=>s+d.totalAmount,0);
                const dayTrips = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0);
                const dayQty   = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0);
                const unit     = group.deliveries.find(d=>d.quantityUnit)?.quantityUnit||'units';
                const qtyLabel = dayTrips>0&&dayQty===0?`${dayTrips} trips`:dayQty>0&&dayTrips===0?`${dayQty} ${unit}`:`${dayTrips} trips + ${dayQty} ${unit}`;
                return `<tr><td colspan="8" style="padding:9px 12px;background:#f1f5f9;font-weight:700;color:#334155;font-size:12px;border-bottom:1px solid #e2e8f0;border-top:2px solid #cbd5e1;">📅 ${fmtDay(group.date)}</td></tr>${buildDeliveryRows(group.deliveries)}<tr style="background:#fefce8;"><td colspan="4" style="padding:8px 12px;font-weight:700;color:#92400e;font-size:12px;border-bottom:2px solid #fde68a;">Day Total</td><td style="padding:8px 12px;text-align:center;font-weight:800;color:#92400e;border-bottom:2px solid #fde68a;">${qtyLabel}</td><td style="border-bottom:2px solid #fde68a;"></td><td style="border-bottom:2px solid #fde68a;"></td><td style="padding:8px 12px;text-align:right;font-weight:800;color:#92400e;border-bottom:2px solid #fde68a;">₹${fmt(dayTotal)}</td></tr>`;
            }).join('');
        } else {
            tableBody = buildDeliveryRows(bill.deliveries);
        }

        const allWeekPayments = bill.weekPayments || [];
        const cleanNote = (note) => { if (!note) return '—'; return note.replace(/^__auto_crossweek__(?::|)\s*/,'').replace(/^__auto__(?::|)\s*/,'').trim()||'—'; };
        const paymentsHTML = isWeekly && allWeekPayments.length > 0 ? `<div style="margin-bottom:16px;"><div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px;">💰 Payments Recorded</div><table><thead><tr><th>#</th><th>Payment Date</th><th style="text-align:right;">Amount (₹)</th><th>Note</th></tr></thead><tbody>${allWeekPayments.map((p,i)=>`<tr style="${i%2===0?'':'background:#f8fafc;'}"><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:11px;">${i+1}</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">${fmtDate(p.date)}</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d;">₹${fmt(p.amount)}</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${cleanNote(p.note)}</td></tr>`).join('')}<tr style="background:#f0fdf4;"><td colspan="2" style="padding:9px 12px;font-weight:700;color:#15803d;font-size:12px;">Total Paid</td><td style="padding:9px 12px;text-align:right;font-weight:900;color:#15803d;font-size:14px;">₹${fmt(allWeekPayments.reduce((s,p)=>s+(p.amount||0),0))}</td><td></td></tr></tbody></table></div>` : '';

        const totalTrips = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0)||0;
        const totalQty   = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0)||0;
        const unit       = bill.deliveries?.find(d=>d.quantityUnit)?.quantityUnit||'units';
        const tripsLabel = totalTrips>0&&totalQty===0?`${totalTrips} trips`:totalQty>0&&totalTrips===0?`${totalQty} ${unit}`:`${totalTrips} trips + ${totalQty} ${unit}`;
        const grandTotal = isWeekly ? (bill.carriedBalance||0)+bill.weekTotal : bill.totalAmount;
        const paid       = isWeekly ? (bill.weekPayments||[]).reduce((s,p)=>s+(p.amount||0),0) : 0;
        const netDue     = isWeekly ? (bill.netDue ?? Math.max(0, grandTotal-paid)) : bill.totalAmount;
        const phoneHTML  = cust.phone ? '<strong>Phone:</strong> '+cust.phone+'<br/>' : '';
        const siteHTML   = cust.siteAddress ? '<strong>Site:</strong> '+cust.siteAddress : '';

        const printHTML = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Bill</title><style>'
            +"@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');"
            +'*{box-sizing:border-box;margin:0;padding:0;}'
            +"body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:32px 40px;color:#0f172a;background:#fff;font-size:13px;width:900px;}"
            +'table{width:100%;border-collapse:collapse;margin-bottom:16px;}'
            +'th{background:#0f172a;color:#f1f5f9;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}'
            +'th.r{text-align:right;} th.c{text-align:center;}'
            +'td{font-size:12px;color:#374151;}'
            +'tfoot{display:table-row-group!important;}'
            +'tfoot td{background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;font-size:13px;}'
            +'</style></head><body>'
            +'<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">'+printTime+'</div>'
            +'<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:20px;"><div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div><div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div></div></div>'
            +'<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Outstanding Bill</div><div style="font-size:20px;font-weight:900;color:#0f172a;margin-top:2px;">'+cust.name+'</div><div style="font-size:11px;color:#64748b;margin-top:3px;">Period: '+period+'</div></div></div>'
            +'<div style="font-size:12px;color:#475569;margin-bottom:18px;line-height:1.8;">'+phoneHTML+siteHTML+'</div>'
            +'<div style="display:flex;gap:14px;margin-bottom:20px;">'
            +'<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Total Billed</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;">₹'+fmt(isWeekly?bill.weekTotal:bill.totalAmount)+'</div></div>'
            +'<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Amount Paid</div><div style="font-size:22px;font-weight:900;color:#15803d;">₹'+fmt(paid)+'</div></div>'
            +'<div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:13px 16px;text-align:center;"><div style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">Net Outstanding</div><div style="font-size:22px;font-weight:900;color:#c2410c;">₹'+fmt(netDue)+'</div></div>'
            +'</div>'
            +'<table><thead><tr><th style="width:32px;">#</th><th>Date</th><th>Address</th><th>Material</th><th class="c">Trips / Qty</th><th>Calculation</th><th>Vehicles</th><th class="r">Amount (₹)</th></tr></thead>'
            +'<tbody>'+(tableBody||'<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">No deliveries</td></tr>')+'</tbody>'
            +'<tfoot><tr><td colspan="4" style="background:#0f172a;color:#f8fafc;padding:11px 12px;font-weight:800;">Grand Total Billed</td><td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:center;font-weight:800;">'+tripsLabel+'</td><td style="background:#0f172a;padding:11px 12px;"></td><td style="background:#0f172a;padding:11px 12px;"></td><td style="background:#0f172a;color:#f8fafc;padding:11px 12px;text-align:right;font-weight:900;font-size:14px;">₹'+fmt(isWeekly?bill.weekTotal:bill.totalAmount)+'</td></tr></tfoot>'
            +'</table>'
            +paymentsHTML
            +'<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><div style="width:360px;">'
            +(isWeekly&&bill.carriedBalance>0?'<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;"><span>⚠️ Carried from Previous Week</span><span style="font-weight:700;">₹'+fmt(bill.carriedBalance)+'</span></div>':'')
            +'<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;"><span style="color:#475569;">'+(isWeekly?'This Week':'Daily')+' Billed</span><span style="font-weight:700;">₹'+fmt(isWeekly?bill.weekTotal:bill.totalAmount)+'</span></div>'
            +(isWeekly?'<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:800;"><span>Grand Total Billed</span><span>₹'+fmt(grandTotal)+'</span></div>':'')
            +'<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#15803d;"><span>✓ Total Paid</span><span style="font-weight:700;">₹'+fmt(paid)+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;padding:10px 14px;background:#ffedd5;border:2px solid #fdba74;border-radius:8px;margin-top:6px;"><span style="font-size:14px;font-weight:700;color:#c2410c;">⏳ Net Outstanding</span><span style="font-size:20px;font-weight:900;color:#c2410c;">₹'+fmt(netDue)+'</span></div>'
            +'</div></div>'
            +'<div style="display:flex;justify-content:space-between;margin-top:56px;"><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Customer Signature</div></div><div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div></div>'
            +'</body></html>';

        try {
            const pdfName = fileName.replace('.png', '.pdf');

            // ── Render printHTML inside an iframe so the browser lays out
            //    the full document at real size (no viewport clipping) ──
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:0;left:-9999px;width:900px;height:1px;border:none;visibility:hidden;';
            document.body.appendChild(iframe);

            await new Promise((resolve) => {
                iframe.onload = resolve;
                iframe.srcdoc = printHTML;
            });

            // Let fonts & layout fully render
            await new Promise(r => setTimeout(r, 800));

            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const iframeBody = iframeDoc.body;

            // Measure the FULL rendered height inside the iframe
            const fullWidth  = 900;
            const fullHeight = iframeBody.scrollHeight;

            // Resize iframe to match full content so html2canvas sees everything
            iframe.style.height = fullHeight + 'px';
            await new Promise(r => setTimeout(r, 100));

            const canvas = await html2canvas(iframeBody, {
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

            document.body.removeChild(iframe);

            // ── Build PDF sized exactly to the content (no page breaks / cropping) ──
            const imgData  = canvas.toDataURL('image/jpeg', 0.95);
            // Convert px→mm at 96dpi: px * 25.4 / 96
            const mmWidth  = (fullWidth  * 25.4) / 96;
            const mmHeight = (fullHeight * 25.4) / 96;

            const pdf = new jsPDF({
                orientation: mmHeight >= mmWidth ? 'portrait' : 'landscape',
                unit: 'mm',
                format: [mmWidth, mmHeight],
            });
            pdf.addImage(imgData, 'JPEG', 0, 0, mmWidth, mmHeight);

            const pdfBlob = pdf.output('blob');
            const pdfFile = new File([pdfBlob], pdfName, { type: 'application/pdf' });

            // Mobile: native share sheet → pick WhatsApp → PDF attached directly
            if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
                try { await navigator.share({ files: [pdfFile], title: `Bill — ${cust.name}` }); return; }
                catch (e) { if (e.name === 'AbortError') return; }
            }

            // Desktop: download PDF then open WhatsApp so user can attach it
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url; a.download = pdfName;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success('PDF downloaded — attach it in WhatsApp');
            setTimeout(() => {
                const appLink = document.createElement('a');
                appLink.href = 'whatsapp://open'; appLink.click();
                setTimeout(() => window.open('https://web.whatsapp.com', '_blank'), 1500);
            }, 800);
        } catch (err) { toast.error('Failed to generate PDF'); console.error(err); }
    };

    const deliveryTotal = deliveryForm.vehicles.reduce((s, v) => {
        const amt = deliveryForm.billingType === 'Trip'
            ? (Number(v.numberOfTrips) || 0) * (Number(v.rateApplied) || 0)
            : (Number(v.quantity) || 0) * (Number(v.rateApplied) || 0);
        return s + amt;
    }, 0);

    const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search) ||
        c.siteAddress.toLowerCase().includes(search.toLowerCase())
    );

    if (loading) return <div className="loader-fullscreen"><div className="spinner"/></div>;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">🧾 Billing</h1>
                <button className="btn btn-primary" onClick={openAdd}>+ Add Customer</button>
            </div>

            {/* Stats */}
            <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card yellow">
                    <div className="stat-icon">👥</div>
                    <div className="stat-info"><div className="stat-value">{customers.length}</div><div className="stat-label">Total Customers</div></div>
                </div>
                <div className="stat-card blue">
                    <div className="stat-icon">🚛</div>
                    <div className="stat-info"><div className="stat-value">{customers.filter(c=>c.billingType==='Trip').length}</div><div className="stat-label">Per Trip</div></div>
                </div>
                <div className="stat-card green">
                    <div className="stat-icon">📦</div>
                    <div className="stat-info"><div className="stat-value">{customers.filter(c=>c.billingType==='Quantity').length}</div><div className="stat-label">Per Quantity</div></div>
                </div>
                <div className="stat-card red">
                    <div className="stat-icon">📅</div>
                    <div className="stat-info"><div className="stat-value">{new Date().toLocaleDateString('en-IN',{weekday:'short'})}</div><div className="stat-label">Today</div></div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex',gap:8,marginBottom:16}}>
                <button className={'btn ' + (activeTab==='customers'?'btn-primary':'btn-secondary')} onClick={()=>setActiveTab('customers')}>👥 Customers</button>
                <button className={'btn ' + (activeTab==='earnings'?'btn-primary':'btn-secondary')} onClick={()=>{setActiveTab('earnings');loadEarnings('weekly',earningsDate,earningsMonth,customStartDate,customEndDate);}}>💰 Earnings</button>
            </div>

            {/* Earnings Tab */}
            {activeTab==='earnings' && (
                <div>
                    <div style={{display:'flex',gap:12,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                        <button className={'btn ' + (earningsType==='daily'?'btn-primary':'btn-secondary')} onClick={()=>{setEarningsType('daily');loadEarnings('daily',earningsDate);}}>📆 Daily</button>
                        <button className={'btn ' + (earningsType==='weekly'?'btn-primary':'btn-secondary')} onClick={()=>{setEarningsType('weekly');loadEarnings('weekly',earningsDate);}}>📅 Weekly</button>
                        <button className={'btn ' + (earningsType==='monthly'?'btn-primary':'btn-secondary')} onClick={()=>{setEarningsType('monthly');loadEarnings('monthly',null,earningsMonth);}}>🗓️ Monthly</button>
                        <button className={'btn ' + (earningsType==='custom'?'btn-primary':'btn-secondary')} onClick={()=>{setEarningsType('custom');loadEarnings('custom',null,null,customStartDate,customEndDate);}}>📋 Custom Range</button>

                        {/* Daily / Weekly: single date picker */}
                        {(earningsType==='daily'||earningsType==='weekly') && (
                            <input type="date" value={earningsDate} onChange={e=>{setEarningsDate(e.target.value);loadEarnings(earningsType,e.target.value);}}
                                   style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                        )}

                        {/* Monthly: month picker */}
                        {earningsType==='monthly' && (
                            <input type="month" value={earningsMonth} onChange={e=>{setEarningsMonth(e.target.value);loadEarnings('monthly',null,e.target.value);}}
                                   style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                        )}

                        {/* Custom: start + end date pickers */}
                        {earningsType==='custom' && (
                            <>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <span style={{color:'#888',fontSize:12}}>From</span>
                                    <input type="date" value={customStartDate} onChange={e=>setCustomStartDate(e.target.value)}
                                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                                </div>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <span style={{color:'#888',fontSize:12}}>To</span>
                                    <input type="date" value={customEndDate} min={customStartDate} onChange={e=>setCustomEndDate(e.target.value)}
                                           style={{background:'#141414',border:'1px solid #2a2a2a',borderRadius:6,padding:'8px 12px',color:'#e0e0e0',fontSize:13}}/>
                                </div>
                                <button className="btn btn-primary" onClick={()=>loadEarnings('custom',null,null,customStartDate,customEndDate)}>Apply</button>
                            </>
                        )}

                        {earningsType!=='custom' && (
                            <button className="btn btn-primary" onClick={()=>loadEarnings(earningsType,earningsDate,earningsMonth,customStartDate,customEndDate)}>Refresh</button>
                        )}
                        {earnings && <button className="btn btn-secondary" onClick={()=>{
                            const printTime = new Date().toLocaleString('en-IN');
                            const periodLabel = earningsType === 'weekly'
                                ? (earnings.weekStart ? fmtDate(earnings.weekStart) + ' to ' + fmtDate(earnings.weekEnd) : earningsDate)
                                : earningsType === 'monthly'
                                    ? (earnings.monthLabel || earningsMonth)
                                    : earningsType === 'custom'
                                        ? fmtDate(customStartDate) + ' to ' + fmtDate(customEndDate)
                                        : fmtDate(earningsDate);
                            const rows = (earnings.customers || []).map((cs, i) => {
                                const ps = cs.paymentStatus;
                                const carried = cs.carriedBalance || 0;
                                const grandDue = cs.grandTotal ?? (carried + cs.total);
                                const netDue = ps?.isPaid ? 0 : (cs.netDue ?? Math.max(0, grandDue - cs.collected));
                                const tripsLabel = (() => {
                                    const parts = [];
                                    if (cs.totalTrips > 0) parts.push(cs.totalTrips + ' trips');
                                    if (cs.totalQty > 0) parts.push(cs.totalQty + ' ' + (cs.quantityUnit || 'units'));
                                    return parts.length > 0 ? parts.join(' + ') : '—';
                                })();
                                const statusBg = ps?.isPaid ? '#dcfce7' : ps?.isPartial ? '#fef3c7' : '#fee2e2';
                                const statusColor = ps?.isPaid ? '#15803d' : ps?.isPartial ? '#b45309' : '#dc2626';
                                const statusText = ps?.isPaid ? 'Paid' : ps?.isPartial ? 'Partial' : 'Unpaid';
                                return '<tr style="' + (i % 2 === 1 ? 'background:#f8fafc;' : '') + '">' +
                                    '<td style="font-weight:600;color:#0f172a;">' + (cs.customer?.name || '—') + '</td>' +
                                    '<td style="color:#64748b;">' + (cs.customer?.siteAddress || '—') + '</td>' +
                                    '<td style="color:#1d4ed8;font-weight:700;">' + tripsLabel + '</td>' +
                                    '<td style="color:#64748b;">&#8377;' + fmt(cs.rateApplied) + '/' + (cs.totalQty>0&&cs.totalTrips===0?(cs.quantityUnit||'unit'):'trip') + '</td>' +
                                    '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(cs.tripAmount) + '</td>' +
                                    '<td style="color:#15803d;">&#8377;' + fmt(cs.qtyAmount) + '</td>' +
                                    '<td style="font-weight:800;color:#0f172a;">&#8377;' + fmt(cs.total) + '</td>' +
                                    '<td style="color:' + (carried > 0 ? '#dc2626' : '#94a3b8') + ';font-weight:' + (carried > 0 ? '700' : '400') + ';">' + (carried > 0 ? '&#8377;' + fmt(carried) : '—') + '</td>' +
                                    '<td style="color:#ea580c;font-weight:700;">&#8377;' + fmt(grandDue) + '</td>' +
                                    '<td style="color:#15803d;font-weight:700;">&#8377;' + fmt(cs.collected) + '</td>' +
                                    '<td style="color:' + (netDue > 0 ? '#dc2626' : '#15803d') + ';font-weight:800;">&#8377;' + fmt(netDue) + '</td>' +
                                    '<td><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;background:' + statusBg + ';color:' + statusColor + ';">' + statusText + '</span></td>' +
                                    '</tr>';
                            }).join('');
                            const totalTrips = (earnings.customers || []).reduce((s,c)=>s+(c.totalTrips||0),0);
                            const totalQtyCount = (earnings.customers || []).reduce((s,c)=>s+(c.totalQty||0),0);
                            const totalQtyUnit = (earnings.customers || []).find(c=>(c.totalQty||0)>0)?.quantityUnit || 'units';
                            const totalLabel = (() => { const p=[]; if(totalTrips>0) p.push(totalTrips+' trips'); if(totalQtyCount>0) p.push(totalQtyCount+' '+totalQtyUnit); return p.length>0?p.join(' + '):'0 trips'; })();
                            const totalCarried = (earnings.customers || []).reduce((s,c)=>s+(c.carriedBalance||0),0);
                            const totalGrandDue = (earnings.customers || []).reduce((s,c)=>s+(c.grandTotal??((c.carriedBalance||0)+c.total)),0);
                            const totalCollected = (earnings.customers || []).reduce((s,c)=>s+c.collected,0);
                            const totalNetDue = (earnings.customers || []).reduce((s,c)=>s+(c.paymentStatus?.isPaid?0:(c.netDue??Math.max(0,(c.grandTotal??((c.carriedBalance||0)+c.total))-c.collected))),0);
                            const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Billing Earnings Summary</title>' +
                                '<style>' +
                                "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');" +
                                '*{box-sizing:border-box;margin:0;padding:0;}' +
                                "body{font-family:'Inter','Segoe UI',Arial,sans-serif;padding:28px 36px;color:#0f172a;background:#fff;font-size:12px;}" +
                                'table{width:100%;border-collapse:collapse;margin-bottom:20px;}' +
                                'th{background:#0f172a;color:#f1f5f9;padding:9px 11px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;}' +
                                'td{padding:8px 11px;font-size:11px;color:#374151;border-bottom:1px solid #e2e8f0;}' +
                                'tfoot td{background:#0f172a;color:#f8fafc;padding:10px 11px;font-weight:800;font-size:12px;border-bottom:none;}' +
                                '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:14px 18px;}}' +
                                '</style></head><body>' +
                                '<div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">' + printTime + '</div>' +
                                '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:3px solid #0f172a;margin-bottom:18px;">' +
                                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +
                                '<div><div style="font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">R.C. Enterprises</div>' +
                                '<div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">CHAND LALUWALE &amp; ROSHAN LALUWALE</div>' +
                                '</div></div>' +
                                '<div style="text-align:right;">' +
                                '<div style="font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.8px;">Billing Earnings Summary</div>' +
                                '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:4px;text-transform:capitalize;">' + earningsType + ' Report</div>' +
                                '<div style="font-size:11px;color:#64748b;margin-top:3px;">Period: ' + periodLabel + '</div>' +
                                '</div>' +
                                '</div>' +
                                '<div style="display:flex;gap:12px;margin-bottom:20px;">' +
                                '<div style="flex:1;background:#dbeafe;border:2px solid #93c5fd;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Trip Billing</div><div style="font-size:20px;font-weight:900;color:#1d4ed8;">&#8377;' + fmt(earnings.tripTotal) + '</div></div>' +
                                '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Qty Billing</div><div style="font-size:20px;font-weight:900;color:#15803d;">&#8377;' + fmt(earnings.qtyTotal) + '</div></div>' +
                                '<div style="flex:1;background:#fef3c7;border:2px solid #fcd34d;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">This Week Total</div><div style="font-size:20px;font-weight:900;color:#b45309;">&#8377;' + fmt(earnings.grandTotal) + '</div></div>' +
                                '<div style="flex:1;background:#fee2e2;border:2px solid #fca5a5;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Prev. Outstanding</div><div style="font-size:20px;font-weight:900;color:#dc2626;">&#8377;' + fmt(earnings.totalCarried||0) + '</div></div>' +
                                '<div style="flex:1;background:#dcfce7;border:2px solid #86efac;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Collected</div><div style="font-size:20px;font-weight:900;color:#15803d;">&#8377;' + fmt(earnings.totalCollected) + '</div></div>' +
                                '<div style="flex:1;background:#ffedd5;border:2px solid #fdba74;border-radius:10px;padding:12px 14px;text-align:center;"><div style="font-size:9px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;">Net Due</div><div style="font-size:20px;font-weight:900;color:#c2410c;">&#8377;' + fmt(earnings.totalNetDue||earnings.totalRemaining) + '</div></div>' +
                                '</div>' +
                                '<table>' +
                                '<thead><tr>' +
                                '<th>Customer</th><th>Site</th><th>Total Trips/Qty</th><th>Rate (&#8377;)</th>' +
                                '<th>Trip (&#8377;)</th><th>Qty (&#8377;)</th><th>Total (&#8377;)</th>' +
                                '<th style="color:#fca5a5;">Prev. Outstanding</th>' +
                                '<th style="color:#fdba74;">Total Due (&#8377;)</th>' +
                                '<th style="color:#86efac;">Collected</th>' +
                                '<th style="color:#fca5a5;">Net Due</th>' +
                                '<th>Status</th>' +
                                '</tr></thead>' +
                                '<tbody>' + (rows || '<tr><td colspan="12" style="text-align:center;padding:20px;color:#94a3b8;">No orders in this period</td></tr>') + '</tbody>' +
                                '<tfoot><tr>' +
                                '<td colspan="4">Total — ' + totalLabel + '</td>' +
                                '<td>&#8377;' + fmt(earnings.tripTotal) + '</td>' +
                                '<td>&#8377;' + fmt(earnings.qtyTotal) + '</td>' +
                                '<td>&#8377;' + fmt(earnings.grandTotal) + '</td>' +
                                '<td>&#8377;' + fmt(totalCarried) + '</td>' +
                                '<td>&#8377;' + fmt(totalGrandDue) + '</td>' +
                                '<td>&#8377;' + fmt(totalCollected) + '</td>' +
                                '<td>&#8377;' + fmt(totalNetDue) + '</td>' +
                                '<td></td>' +
                                '</tr></tfoot>' +
                                '</table>' +
                                '<div style="display:flex;justify-content:space-between;margin-top:48px;">' +
                                '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Prepared By</div></div>' +
                                '<div style="text-align:center;width:200px;"><div style="border-top:1.5px solid #94a3b8;padding-top:9px;font-size:11px;color:#64748b;">Authorised Signature</div></div>' +
                                '</div>' +
                                '</body></html>';
                            let iframe = document.getElementById('__earnings_print_iframe__');
                            if (!iframe) {
                                iframe = document.createElement('iframe');
                                iframe.id = '__earnings_print_iframe__';
                                iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
                                document.body.appendChild(iframe);
                            }
                            const iDoc = iframe.contentWindow.document;
                            iDoc.open(); iDoc.write(html); iDoc.close();
                            setTimeout(() => {
                                const prevTitle = document.title;
                                document.title = 'Billing Earnings — ' + periodLabel;
                                iframe.contentWindow.focus();
                                iframe.contentWindow.print();
                                setTimeout(() => { document.title = prevTitle; }, 1000);
                            }, 500);
                        }}>🖨️ Print</button>}
                    </div>
                    {!earnings ? <div className="card" style={{color:'#444',textAlign:'center',padding:32}}>Select date and refresh</div> : (
                        <div ref={earningsRef}>
                            <input
                                placeholder="🔍 Search customer by name or site..."
                                value={earningsSearch}
                                onChange={e => setEarningsSearch(e.target.value)}
                                style={{ background:'#141414', border:'1px solid #2a2a2a', borderRadius:8, padding:'10px 14px', color:'#e0e0e0', fontSize:14, width:'100%', outline:'none', marginBottom:16 }}
                            />
                            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:20}}>
                                <div className="stat-card blue"><div className="stat-icon">🚛</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.tripTotal)}</div><div className="stat-label">Trip Billing</div></div></div>
                                <div className="stat-card green"><div className="stat-icon">📦</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.qtyTotal)}</div><div className="stat-label">Qty Billing</div></div></div>
                                <div className="stat-card yellow"><div className="stat-icon">💰</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.grandTotal)}</div><div className="stat-label">{earningsType==='daily'?'Today Total':earningsType==='monthly'?'Month Total':earningsType==='custom'?'Period Total':'This Week Total'}</div></div></div>
                                <div className="stat-card red"><div className="stat-icon">⏪</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.totalCarried||0)}</div><div className="stat-label">Prev. Outstanding</div></div></div>
                                <div className="stat-card green"><div className="stat-icon">✅</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.totalCollected)}</div><div className="stat-label">Collected</div></div></div>
                                <div className="stat-card red"><div className="stat-icon">⏳</div><div className="stat-info"><div className="stat-value">₹{fmt(earnings.totalNetDue||earnings.totalRemaining)}</div><div className="stat-label">Net Due</div></div></div>
                            </div>
                            <div className="card">
                                <div className="table-wrap">
                                    <table>
                                        <thead><tr>
                                            <th>Customer</th><th>Site</th><th>Total Trips/Qty</th><th>Rate (₹)</th>
                                            <th>Trip (₹)</th><th>Qty (₹)</th><th>Total (₹)</th>
                                            <th style={{color:'#f87171'}}>Prev. Outstanding</th>
                                            <th style={{color:'#fb923c'}}>Total Due (₹)</th>
                                            <th style={{color:'#4ade80'}}>Collected</th>
                                            <th style={{color:'#f87171'}}>Net Due</th>
                                            <th>Status</th><th></th>
                                        </tr></thead>
                                        <tbody>
                                        {(earnings.customers || []).length===0 && <tr><td colSpan={13} style={{textAlign:'center',color:'#444',padding:20}}>No orders in this period</td></tr>}
                                        {(earnings.customers || []).filter(cs => {
                                            if (!earningsSearch.trim()) return true;
                                            const q = earningsSearch.toLowerCase();
                                            return (cs.customer?.name||'').toLowerCase().includes(q) ||
                                                (cs.customer?.siteAddress||'').toLowerCase().includes(q);
                                        }).map((cs,i)=>{
                                            const ps = cs.paymentStatus;
                                            const tripsLabel = (() => {
                                                const parts = [];
                                                if (cs.totalTrips > 0) parts.push(cs.totalTrips + ' trips');
                                                if (cs.totalQty > 0) parts.push(cs.totalQty + ' ' + (cs.quantityUnit || 'units'));
                                                return parts.length > 0 ? parts.join(' + ') : '—';
                                            })();
                                            const carried   = cs.carriedBalance || 0;
                                            const grandDue  = cs.grandTotal ?? (carried + cs.total);
                                            const netDue    = ps?.isPaid ? 0 : (cs.netDue ?? Math.max(0, grandDue - cs.collected));
                                            return (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600,color:'#f0f0f0'}}>{cs.customer?.name}</td>
                                                    <td style={{color:'#888'}}>{cs.customer?.siteAddress||'—'}</td>
                                                    <td style={{color:'#fff',fontWeight:700}}>{tripsLabel}</td>
                                                    <td style={{color:'#888'}}>₹{fmt(cs.rateApplied)}/{cs.totalQty>0&&cs.totalTrips===0?(cs.quantityUnit||'unit'):'trip'}</td>
                                                    <td style={{color:'#eab308'}}>₹{fmt(cs.tripAmount)}</td>
                                                    <td style={{color:'#4ade80'}}>₹{fmt(cs.qtyAmount)}</td>
                                                    <td style={{fontWeight:700,color:'#f0f0f0'}}>₹{fmt(cs.total)}</td>
                                                    <td style={{color:carried>0?'#f87171':'#555',fontWeight:carried>0?700:400}}>
                                                        {carried>0 ? '₹'+fmt(carried) : '—'}
                                                    </td>
                                                    <td style={{color:'#fb923c',fontWeight:700}}>₹{fmt(grandDue)}</td>
                                                    <td style={{color:'#4ade80'}}>₹{fmt(cs.collected)}</td>
                                                    <td style={{color:netDue>0?'#f87171':'#4ade80',fontWeight:700}}>₹{fmt(netDue)}</td>
                                                    <td>
                                                        {ps?.isPaid?<span className="badge badge-green">Paid</span>
                                                            :ps?.isPartial?<span className="badge badge-yellow">Partial</span>
                                                                :<span className="badge badge-red">Unpaid</span>}
                                                    </td>
                                                    {/* ── ACTION BUTTONS: update + delete pay status ── */}
                                                    <td style={{display:'flex',gap:4,alignItems:'center'}}>
                                                        <button className="btn btn-secondary" style={{padding:'4px 8px',fontSize:11}}
                                                                onClick={()=>{
                                                                    setPayStatusModal({customerId:cs.customer._id,total:grandDue,alreadyPaid:cs.collected||0});
                                                                    setPayStatusForm({isPaid:ps?.isPaid||false,isPartial:ps?.isPartial||false,amountPaid:ps?.amountPaid||'',note:ps?.note||'',date:new Date().toISOString().slice(0,10)});
                                                                }}>
                                                            💳
                                                        </button>
                                                        {(cs.payments?.length > 0 || cs.collected > 0) && (
                                                            <button
                                                                className="btn btn-secondary"
                                                                style={{padding:'4px 8px',fontSize:11}}
                                                                title="View & delete individual payments"
                                                                onClick={async () => {
                                                                    // Always fetch fresh from weekly endpoint so ALL payments
                                                                    // (including cross-week payments) are shown — not just
                                                                    // the date-filtered cs.payments from earnings summary.
                                                                    try {
                                                                        const { data } = await api.get(`/billing/weekly/${cs.customer._id}?date=${earningsDate}`);
                                                                        const pays = data.weekPayments || [];
                                                                        setPaymentsListModal({customerName: cs.customer?.name, payments: pays, paymentStatus: data.paymentStatus});
                                                                    } catch { toast.error('Could not load payments'); }
                                                                }}
                                                            >
                                                                🧾
                                                            </button>
                                                        )}
                                                        {ps && (
                                                            <button
                                                                className="btn btn-danger"
                                                                style={{padding:'4px 8px',fontSize:11}}
                                                                title="Delete entire payment record"
                                                                onClick={() => handleDeletePayStatus(cs.customer._id)}
                                                            >
                                                                🗑
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        </tbody>
                                        <tfoot>
                                        <tr style={{borderTop:'1px solid #2a2a2a'}}>
                                            <td colSpan={4} style={{color:'#666',padding:'12px 16px',fontWeight:600}}>
                                                {(() => {
                                                    const totalTripCount = (earnings.customers || []).reduce((s,c)=>s+(c.totalTrips||0),0);
                                                    const totalQtyCount  = (earnings.customers || []).reduce((s,c)=>s+(c.totalQty||0),0);
                                                    const qtyUnit = (earnings.customers || []).find(c=>(c.totalQty||0)>0)?.quantityUnit || 'units';
                                                    const parts = [];
                                                    if (totalTripCount > 0) parts.push(`${totalTripCount} trips`);
                                                    if (totalQtyCount  > 0) parts.push(`${totalQtyCount} ${qtyUnit}`);
                                                    return `Total — ${parts.length > 0 ? parts.join(' + ') : '0 trips'}`;
                                                })()}
                                            </td>
                                            <td style={{color:'#f0f0f0',fontWeight:700,padding:'12px 16px'}}>₹{fmt(earnings.tripTotal)}</td>
                                            <td style={{color:'#4ade80',fontWeight:700,padding:'12px 16px'}}>₹{fmt(earnings.qtyTotal)}</td>
                                            <td style={{color:'#f0f0f0',fontWeight:700,padding:'12px 16px'}}>₹{fmt(earnings.grandTotal)}</td>
                                            <td style={{color:'#f87171',fontWeight:700,padding:'12px 16px'}}>₹{fmt((earnings.customers || []).reduce((s,c)=>s+(c.carriedBalance||0),0))}</td>
                                            <td style={{color:'#fb923c',fontWeight:700,padding:'12px 16px'}}>₹{fmt((earnings.customers || []).reduce((s,c)=>s+(c.grandTotal??(( c.carriedBalance||0)+c.total)),0))}</td>
                                            <td style={{color:'#4ade80',fontWeight:700,padding:'12px 16px'}}>₹{fmt((earnings.customers || []).reduce((s,c)=>s+c.collected,0))}</td>
                                            <td style={{color:'#f87171',fontWeight:700,padding:'12px 16px'}}>₹{fmt((earnings.customers || []).reduce((s,c)=>s+(c.paymentStatus?.isPaid?0:(c.netDue??Math.max(0,(c.grandTotal??((c.carriedBalance||0)+c.total))-c.collected))),0))}</td>
                                            <td colSpan={2}></td>
                                        </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Payment Status Modal */}
                    {payStatusModal && (
                        <div className="modal-overlay" onClick={()=>setPayStatusModal(null)}>
                            <div className="modal" onClick={e=>e.stopPropagation()}>
                                <div className="modal-header"><h3>Update Payment Status</h3><button className="modal-close" onClick={()=>setPayStatusModal(null)}>✕</button></div>
                                <div className="modal-stock-info" style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                                    <span>Total Bill: <strong style={{color:'#eab308'}}>₹{fmt(payStatusModal?.total)}</strong></span>
                                    {(payStatusModal?.alreadyPaid||0)>0 && !payStatusForm.isPaid && (
                                        <span>Already Paid: <strong style={{color:'#4ade80'}}>₹{fmt(payStatusModal.alreadyPaid)}</strong></span>
                                    )}
                                    {(payStatusModal?.alreadyPaid||0)>0 && !payStatusForm.isPaid && (
                                        <span>Balance Due: <strong style={{color:'#f87171'}}>₹{fmt((payStatusModal?.total||0)-(payStatusModal?.alreadyPaid||0))}</strong></span>
                                    )}
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,margin:'12px 0'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                                        <input type="checkbox" checked={payStatusForm.isPaid} onChange={e=>setPayStatusForm({...payStatusForm,isPaid:e.target.checked,isPartial:false})} style={{width:16,height:16}}/>
                                        <label style={{fontSize:13,color:'#ccc'}}>
                                            Fully Paid
                                            {(payStatusModal?.alreadyPaid||0)>0 && (
                                                <span style={{color:'#f87171',fontSize:11,marginLeft:6}}>
                                (Pay remaining ₹{fmt(Math.max(0,(payStatusModal?.total||0)-(payStatusModal?.alreadyPaid||0)))})
                              </span>
                                            )}
                                        </label>
                                    </div>
                                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                                        <input type="checkbox" checked={payStatusForm.isPartial} onChange={e=>setPayStatusForm({...payStatusForm,isPartial:e.target.checked,isPaid:false})} style={{width:16,height:16}}/>
                                        <label style={{fontSize:13,color:'#ccc'}}>Partial Payment</label>
                                    </div>
                                </div>
                                {payStatusForm.isPartial && (
                                    <div className="form-grid">
                                        <div className="form-group">
                                            {(() => {
                                                const maxPay = (payStatusModal?.total||0) - (payStatusModal?.alreadyPaid||0);
                                                const remaining = maxPay - (Number(payStatusForm.amountPaid)||0);
                                                return (<>
                                                    <label>Amount Paid Now (₹) <span style={{color:'#555',fontWeight:400}}>max ₹{fmt(maxPay)}</span></label>
                                                    <input type="number" placeholder="0" value={payStatusForm.amountPaid}
                                                           onChange={e=>setPayStatusForm({...payStatusForm, amountPaid: Math.min(Number(e.target.value)||0, maxPay)})}/>
                                                    {payStatusForm.amountPaid > 0 && (
                                                        <div style={{fontSize:12,color:'#eab308',marginTop:4}}>
                                                            Still Remaining after this: ₹{fmt(remaining)}
                                                        </div>
                                                    )}
                                                </>);
                                            })()}
                                        </div>
                                    </div>
                                )}
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Payment Date</label>
                                        <input type="date" value={payStatusForm.date||new Date().toISOString().slice(0,10)} onChange={e=>setPayStatusForm({...payStatusForm,date:e.target.value})}/>
                                    </div>
                                    <div className="form-group">
                                        <label>Note</label>
                                        <input placeholder="e.g. Cash, UPI, cheque..." value={payStatusForm.note} onChange={e=>setPayStatusForm({...payStatusForm,note:e.target.value})}/>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn btn-secondary" onClick={()=>setPayStatusModal(null)}>Cancel</button>
                                    <button className="btn btn-primary" onClick={handlePayStatus} disabled={savingPay}>{savingPay?'Saving...':'Save'}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {paymentsListModal && (
                <div className="modal-overlay" onClick={()=>setPaymentsListModal(null)}>
                    <div className="modal" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>💰 Payments — {paymentsListModal.customerName}</h3>
                            <button className="modal-close" onClick={()=>setPaymentsListModal(null)}>✕</button>
                        </div>
                        {paymentsListModal.payments.length === 0 && !paymentsListModal.paymentStatus ? (
                            <div style={{padding:24,color:'#666',textAlign:'center',fontStyle:'italic'}}>No payments recorded</div>
                        ) : (
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                <thead>
                                <tr>
                                    <th style={{padding:'9px 12px',textAlign:'left',color:'#888',borderBottom:'1px solid #2a2a2a',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Date</th>
                                    <th style={{padding:'9px 12px',textAlign:'right',color:'#888',borderBottom:'1px solid #2a2a2a',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Amount (₹)</th>
                                    <th style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #2a2a2a',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Note</th>
                                    <th style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #2a2a2a',fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Type</th>
                                    <th style={{padding:'9px 12px',borderBottom:'1px solid #2a2a2a'}}></th>
                                </tr>
                                </thead>
                                <tbody>
                                {/* All payment entries sorted by date — each partial/full entry on its own row */}
                                {paymentsListModal.payments.map((p,i) => {
                                    // Determine display type from note
                                    const isAuto = p.note && p.note.startsWith('__auto__');
                                    const displayNote = isAuto ? (p.note.replace(/^__auto__:?\s*/,'') || 'Online') : (p.note || '—');
                                    const typeLabel = isAuto
                                        ? (paymentsListModal.paymentStatus?.isPaid && i === paymentsListModal.payments.length - 1 ? 'Full' : 'Partial')
                                        : 'Entry';
                                    const typeBg = typeLabel === 'Full' ? {color:'#4ade80',background:'#0a2a0a'} : typeLabel === 'Partial' ? {color:'#eab308',background:'#1a1600'} : {color:'#555',background:'#1e1e1e'};
                                    return (
                                        <tr key={p._id} style={{background:i%2===0?'transparent':'#141414'}}>
                                            <td style={{padding:'10px 12px',color:'#ccc',borderBottom:'1px solid #1e1e1e'}}>{fmtDate(p.date)}</td>
                                            <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:'#4ade80',borderBottom:'1px solid #1e1e1e'}}>₹{fmt(p.amount)}</td>
                                            <td style={{padding:'10px 12px',color:'#888',borderBottom:'1px solid #1e1e1e'}}>{displayNote}</td>
                                            <td style={{padding:'10px 12px',borderBottom:'1px solid #1e1e1e'}}>
                                                <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,...typeBg}}>{typeLabel}</span>
                                            </td>
                                            <td style={{padding:'10px 12px',borderBottom:'1px solid #1e1e1e'}}>
                                                <button
                                                    className="btn btn-danger"
                                                    style={{padding:'3px 8px',fontSize:11}}
                                                    disabled={deletingPaymentId === p._id}
                                                    onClick={() => handleDeleteSinglePayment(p._id)}
                                                    title="Delete this payment"
                                                >
                                                    {deletingPaymentId === p._id ? '...' : '🗑'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                                <tfoot>
                                <tr>
                                    <td style={{padding:'10px 12px',fontWeight:700,color:'#eab308',fontSize:13}}>Total</td>
                                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:'#eab308',fontSize:13}}>
                                        ₹{fmt(paymentsListModal.payments.reduce((s,p)=>s+(p.amount||0),0))}
                                    </td>
                                    <td colSpan={3}></td>
                                </tr>
                                </tfoot>
                            </table>
                        )}
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setPaymentsListModal(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Customers Tab */}
            {activeTab==='customers' && <>
                <input
                    placeholder="Search by name, phone or site..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ background:'#141414', border:'1px solid #2a2a2a', borderRadius:8, padding:'10px 14px', color:'#e0e0e0', fontSize:14, width:'100%', outline:'none', marginBottom:16 }}
                />
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {filtered.length === 0 && (
                        <div className="card" style={{ textAlign:'center', color:'#444', padding:40 }}>No customers found. Add one to get started.</div>
                    )}
                    {filtered.map(c => (
                        <div key={c._id} className="card" style={{ padding:0, overflow:'hidden' }}>
                            <div
                                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', cursor:'pointer', background: expandedCustomer===c._id ? '#1a1800' : '#141414' }}
                                onClick={() => setExpandedCustomer(expandedCustomer===c._id ? null : c._id)}
                            >
                                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                                    <div style={{ fontSize:22 }}>{expandedCustomer===c._id ? '📂' : '📁'}</div>
                                    <div>
                                        <div style={{ fontWeight:700, color:'#f0f0f0', fontSize:15 }}>{c.name}</div>
                                        <div style={{ fontSize:12, color:'#666', marginTop:2 }}>
                                            {c.phone && <span style={{ marginRight:12 }}>📞 {c.phone}</span>}
                                            <span>📍 {c.siteAddress}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                    <span className={'badge ' + (c.billingType==='Trip'?'badge-blue':'badge-yellow')}>{c.billingType}</span>
                                    <span style={{ color:'#eab308', fontSize:13, fontWeight:600 }}>
                  ₹{fmt(c.billingType==='Trip'?c.ratePerTrip:c.ratePerQuantity)}
                </span>
                                    <div style={{ display:'flex', gap:6 }} onClick={e=>e.stopPropagation()}>
                                        <button className="btn btn-primary" style={{ padding:'5px 10px', fontSize:12 }} onClick={()=>openDelivery(c)}>+ Delivery</button>
                                        <button className="btn btn-secondary" style={{ padding:'5px 10px', fontSize:12 }} onClick={()=>openPayment(c)}>💰</button>
                                        <button className="btn btn-primary" style={{ padding:'5px 10px', fontSize:12 }} onClick={()=>openBill(c)}>🧾</button>
                                        <button className="btn btn-secondary" style={{ padding:'5px 10px', fontSize:12 }} onClick={()=>openEdit(c)}>✏️</button>
                                        <button className="btn btn-danger" style={{ padding:'5px 10px', fontSize:12 }} onClick={()=>handleDelete(c._id)}>🗑</button>
                                    </div>
                                    <span style={{ color:'#444', fontSize:18 }}>{expandedCustomer===c._id ? '▲' : '▼'}</span>
                                </div>
                            </div>
                            {expandedCustomer===c._id && (
                                <CustomerHistory customerId={c._id} vehicles={vehicles} onDeleteDelivery={async (id)=>{ await api.delete(`/billing/deliveries/${id}`); toast.success('Deleted'); }} />
                            )}
                        </div>
                    ))}
                </div>
            </>}

            {/* Add/Edit Customer Modal */}
            {(modal==='add'||modal==='edit') && (
                <div className="modal-overlay" onClick={()=>setModal(null)}>
                    <div className="modal" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{modal==='add'?'Add Customer':'Edit Customer'}</h3>
                            <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                        </div>
                        <div className="form-grid">
                            <div className="form-group"><label>Customer Name *</label><input placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
                            <div className="form-group"><label>Phone</label><input placeholder="Phone number" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Site Address *</label><input placeholder="Delivery site address" value={form.siteAddress} onChange={e=>setForm({...form,siteAddress:e.target.value})}/></div>
                            <div className="form-group"><label>Billing Type</label>
                                <select value={form.billingType} onChange={e=>setForm({...form,billingType:e.target.value})}>
                                    <option value="Trip">Per Trip</option><option value="Quantity">Per Quantity</option>
                                </select>
                            </div>
                            {form.billingType==='Trip'
                                ? <div className="form-group"><label>Rate per Trip (₹)</label><input type="number" placeholder="0" value={form.ratePerTrip} onChange={e=>setForm({...form,ratePerTrip:e.target.value})}/></div>
                                : <div className="form-group"><label>Rate per Quantity (₹)</label><input type="number" placeholder="0" value={form.ratePerQuantity} onChange={e=>setForm({...form,ratePerQuantity:e.target.value})}/></div>
                            }
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving...':'Save'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Delivery Modal */}
            {modal==='delivery' && (
                <div className="modal-overlay" onClick={()=>setModal(null)}>
                    <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Delivery — {selected?.name}</h3>
                            <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                        </div>
                        <div className="modal-stock-info">
                            Site: <strong style={{color:'#eab308'}}>{selected?.siteAddress}</strong>
                            &nbsp;·&nbsp; Billing: <strong style={{color:'#fff'}}>{deliveryForm.billingType}</strong>
                        </div>
                        <div className="form-grid">
                            <div className="form-group"><label>Date</label><input type="date" value={deliveryForm.date} onChange={e=>setDeliveryForm({...deliveryForm,date:e.target.value})}/></div>
                            <div className="form-group"><label>Billing Type</label>
                                <select value={deliveryForm.billingType} onChange={e=>setDeliveryForm({...deliveryForm,billingType:e.target.value})}>
                                    <option value="Trip">Per Trip</option><option value="Quantity">Per Quantity</option>
                                </select>
                            </div>
                            {deliveryForm.billingType==='Quantity' && (
                                <div className="form-group"><label>Unit</label>
                                    <select value={deliveryForm.quantityUnit} onChange={e=>setDeliveryForm({...deliveryForm,quantityUnit:e.target.value})}>
                                        {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="form-group"><label>Material</label><input placeholder="e.g. Sand, Murum" value={deliveryForm.material} onChange={e=>setDeliveryForm({...deliveryForm,material:e.target.value})}/></div>
                            <div className="form-group"><label>Destination</label><input placeholder="Delivery destination" value={deliveryForm.destination} onChange={e=>setDeliveryForm({...deliveryForm,destination:e.target.value})}/></div>
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="Optional" value={deliveryForm.note} onChange={e=>setDeliveryForm({...deliveryForm,note:e.target.value})}/></div>
                        </div>
                        <div style={{marginTop:8}}>
                            <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span>🚛 Vehicles</span>
                                <button className="btn btn-secondary" style={{padding:'5px 10px',fontSize:12}} onClick={addVehicleRow}>+ Add Vehicle</button>
                            </div>
                            {deliveryForm.vehicles.map((v, i) => {
                                const selectedVehicle = vehicles.find(vh => vh._id === v.vehicleId);
                                const isRental = selectedVehicle?.ownershipType === 'Rental';
                                const rowAmt = deliveryForm.billingType==='Trip'
                                    ? (Number(v.numberOfTrips)||0)*(Number(v.rateApplied)||0)
                                    : (Number(v.quantity)||0)*(Number(v.rateApplied)||0);
                                return (
                                    <div key={i} style={{background:'#0e0e0e',border:'1px solid ' + (isRental?'#2a2200':'#1e1e1e'),borderRadius:8,padding:12,marginBottom:10}}>
                                        {isRental && <div style={{fontSize:11,color:'#eab308',marginBottom:8}}>📋 Rental Vehicle</div>}
                                        <div style={{display:'grid',gridTemplateColumns:deliveryForm.billingType==='Quantity'?'2fr 1fr 1fr 1fr 1fr auto':'2fr 1fr 1fr 1fr auto',gap:8,marginBottom:8,alignItems:'end'}}>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Vehicle</label>
                                                <select value={v.vehicleId} onChange={e=>{
                                                    const selV = vehicles.find(vh=>vh._id===e.target.value);
                                                    updateVehicleRow(i,'vehicleId',e.target.value);
                                                    if(selV?.ownershipType==='Rental') updateVehicleRow(i,'dailyRent',selV.rentalAmount||'');
                                                }}>
                                                    <option value="">Customer's own vehicle</option>
                                                    <optgroup label="Own Vehicles">
                                                        {vehicles.filter(vh=>vh.ownershipType==='Own').map(vh=><option key={vh._id} value={vh._id}>{vh.vehicleNumber} — {vh.vehicleType}</option>)}
                                                    </optgroup>
                                                    <optgroup label="Rental Vehicles">
                                                        {vehicles.filter(vh=>vh.ownershipType==='Rental').map(vh=><option key={vh._id} value={vh._id}>{vh.vehicleNumber} — {vh.rentalOwnerName}</option>)}
                                                    </optgroup>
                                                </select>
                                            </div>
                                            {/* Always show Trips field */}
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Trips</label>
                                                <input type="number" placeholder="0" value={v.numberOfTrips} onChange={e=>updateVehicleRow(i,'numberOfTrips',e.target.value)}/>
                                            </div>
                                            {/* Show Qty field only for Quantity billing */}
                                            {deliveryForm.billingType==='Quantity' && (
                                                <div className="form-group" style={{marginBottom:0}}>
                                                    <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Qty</label>
                                                    <input type="number" placeholder="0" value={v.quantity} onChange={e=>updateVehicleRow(i,'quantity',e.target.value)}/>
                                                </div>
                                            )}
                                            <div className="form-group" style={{marginBottom:0}}><label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Rate (₹)</label><input type="number" placeholder="0" value={v.rateApplied} onChange={e=>updateVehicleRow(i,'rateApplied',e.target.value)}/></div>
                                            <div style={{textAlign:'center'}}>
                                                <div style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>Amount</div>
                                                <div style={{color:'#eab308',fontWeight:600,fontSize:14,padding:'11px 0'}}>₹{fmt(rowAmt)}</div>
                                            </div>
                                            <button className="btn btn-danger" style={{padding:'8px 10px',marginTop:18}} onClick={()=>removeVehicleRow(i)} disabled={deliveryForm.vehicles.length===1}>✕</button>
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'+(isRental?' 1fr':''),gap:8}}>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Driver (optional)</label>
                                                <select value={v.driverId} onChange={e=>updateVehicleRow(i,'driverId',e.target.value)}>
                                                    <option value="">No driver</option>
                                                    {staff.filter(s=>s.role==='Driver').map(s=><option key={s._id} value={s._id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="form-group" style={{marginBottom:0}}>
                                                <label style={{fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.6px'}}>Conductor (optional)</label>
                                                <select value={v.conductorId} onChange={e=>updateVehicleRow(i,'conductorId',e.target.value)}>
                                                    <option value="">No conductor</option>
                                                    {staff.filter(s=>s.role==='Conductor').map(s=><option key={s._id} value={s._id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            {isRental && (
                                                <div className="form-group" style={{marginBottom:0}}>
                                                    <label style={{fontSize:11,color:'#eab308',textTransform:'uppercase',letterSpacing:'0.6px'}}>Daily Rent (₹)</label>
                                                    <input type="number" placeholder="e.g. 1500" value={v.dailyRent} onChange={e=>updateVehicleRow(i,'dailyRent',e.target.value)}/>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {deliveryTotal > 0 && (
                            <div className="modal-total" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{color:'#60a5fa',fontWeight:700,fontSize:14}}>
                      {(()=>{
                          const trips = deliveryForm.vehicles.reduce((s,v)=>s+(Number(v.numberOfTrips)||0),0);
                          const qty   = deliveryForm.vehicles.reduce((s,v)=>s+(Number(v.quantity)||0),0);
                          if (deliveryForm.billingType==='Trip') return trips+' trips';
                          return qty+' '+(deliveryForm.quantityUnit||'units');
                      })()}
                    </span>
                                <span>Total ({deliveryForm.vehicles.length} vehicle{deliveryForm.vehicles.length>1?'s':''}): ₹{fmt(deliveryTotal)}</span>
                            </div>
                        )}
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleDelivery} disabled={saving}>{saving?'Saving...':'Save Delivery'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Payment Modal */}
            {modal==='payment' && (
                <div className="modal-overlay" onClick={()=>setModal(null)}>
                    <div className="modal" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Record Payment — {selected?.name}</h3>
                            <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                        </div>
                        <div className="modal-stock-info">Payment will be deducted from the weekly bill automatically</div>
                        <div className="form-grid">
                            <div className="form-group"><label>Amount (₹) *</label><input type="number" placeholder="0" value={paymentForm.amount} onChange={e=>setPaymentForm({...paymentForm,amount:e.target.value})}/></div>
                            <div className="form-group"><label>Date</label><input type="date" value={paymentForm.date} onChange={e=>setPaymentForm({...paymentForm,date:e.target.value})}/></div>
                            <div className="form-group" style={{gridColumn:'1 / -1'}}><label>Note</label><input placeholder="e.g. Partial payment, advance" value={paymentForm.note} onChange={e=>setPaymentForm({...paymentForm,note:e.target.value})}/></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={()=>setModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handlePayment} disabled={saving}>{saving?'Saving...':'Record Payment'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bill Modal */}
            {modal==='bill' && (
                <div className="modal-overlay" onClick={()=>{ if(!isPrinting.current) setModal(null); }}>
                    <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Bill — {selected?.name}</h3>
                            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                                <select value={billType} onChange={e=>{setBillType(e.target.value);loadBill(selected._id,billDate,e.target.value);}}
                                        style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'6px 10px',color:'#e0e0e0',fontSize:13}}>
                                    <option value="weekly">Weekly</option>
                                    <option value="daily">Daily</option>
                                </select>
                                <input type="date" value={billDate} onChange={e=>{setBillDate(e.target.value);loadBill(selected._id,e.target.value,billType);}}
                                       style={{background:'#0e0e0e',border:'1px solid #2a2a2a',borderRadius:6,padding:'6px 10px',color:'#e0e0e0',fontSize:13}}/>
                                <button className="btn btn-secondary" style={{padding:'6px 10px',fontSize:12}} onClick={e=>{e.stopPropagation();handlePrint();}}>🖨️ Print</button>
                                <button onClick={e=>{e.stopPropagation();handleWhatsAppShare();}} title="Share on WhatsApp"
                                        style={{background:'#25D366',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:500}}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.564 4.14 1.547 5.874L0 24l6.304-1.524A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.374l-.36-.214-3.732.902.938-3.64-.235-.374A9.818 9.818 0 1112 21.818z"/>
                                    </svg>
                                    WhatsApp
                                </button>
                                <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
                            </div>
                        </div>

                        {!bill ? (
                            <div style={{textAlign:'center',padding:32,color:'#444'}}>Loading...</div>
                        ) : (
                            <div ref={printRef}>
                                <div style={{borderBottom:'1px solid #2a2a2a',paddingBottom:12,marginBottom:16}}>
                                    <div style={{fontSize:20,fontWeight:700,color:'#f0f0f0'}}>{billType==='weekly'?'Weekly':'Daily'} Bill</div>
                                    <div style={{fontSize:13,color:'#888',marginTop:4}}>
                                        <strong style={{color:'#eab308'}}>{bill.customer.name}</strong>
                                        {bill.customer.phone && <> &nbsp;·&nbsp; 📞 {bill.customer.phone}</>}
                                        &nbsp;·&nbsp; 📍 {bill.customer.siteAddress}
                                    </div>
                                    <div style={{fontSize:13,color:'#666',marginTop:2}}>
                                        {billType==='weekly'
                                            ? 'Week: ' + fmtDate(bill.weekStart) + ' to ' + fmtDate(bill.weekEnd)
                                            : 'Date: ' + fmtDate(bill.date)}
                                    </div>
                                </div>

                                {billType==='weekly' && bill.carriedBalance > 0 && (
                                    <div style={{background:'#1a0a00',border:'1px solid #3a1a00',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13}}>
                                        ⚠️ Carried from previous week: <strong style={{color:'#f87171'}}>₹{fmt(bill.carriedBalance)}</strong>
                                    </div>
                                )}

                                {/* ── WEEKLY BILL ── */}
                                {billType==='weekly' && (bill.dailyGroups || []).map((group, gi) => (
                                    <div key={gi} style={{marginBottom:16,border:'1px solid #1e1e1e',borderRadius:8,overflow:'hidden'}}>
                                        <div style={{background:'#1a1a1a',padding:'8px 14px',fontSize:13,fontWeight:600,color:'#ccc'}}>📅 {fmtDay(group.date)}</div>
                                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                            <thead>
                                            <tr>{['Vehicle','Destination','Type','Trips/Qty','Rate (₹)','Amount (₹)',''].map(h=>(
                                                <th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>
                                            ))}</tr>
                                            </thead>
                                            <tbody>
                                            {group.deliveries.map(d =>
                                                d.vehicles.map((ve, vi) => (
                                                    <tr key={d._id + "-" + vi}>
                                                        <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{ve.vehicle?.vehicleNumber||'—'}</td>
                                                        <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{d.destination||'—'}</td>
                                                        <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}><span className={'badge ' + (d.billingType==='Trip'?'badge-blue':'badge-yellow')}>{d.billingType}</span></td>
                                                        <td style={{padding:'9px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{d.billingType==='Trip' ? ve.numberOfTrips+' trips' : ve.quantity+' '+d.quantityUnit}</td>
                                                        <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(ve.rateApplied)}</td>
                                                        <td style={{padding:'9px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(ve.totalAmount)}</td>
                                                        <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}} data-no-print="true">
                                                            {vi===0 && <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeleteDelivery(d._id)}>🗑</button>}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                            </tbody>
                                            <tfoot>
                                            <tr style={{borderTop:'1px solid #2a2a2a',background:'#1a1a1a'}}>
                                                <td colSpan={3} style={{padding:'8px 12px',color:'#666',fontWeight:600}}>Day Total</td>
                                                <td style={{padding:'8px 12px',color:'#fff',fontWeight:800,fontSize:13}}>
                                                    {(() => {
                                                        const t = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0);
                                                        const q = group.deliveries.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0);
                                                        const u = group.deliveries.find(d=>d.quantityUnit)?.quantityUnit||'units';
                                                        if(t>0&&q===0) return t+' trips';
                                                        if(q>0&&t===0) return q+' '+u;
                                                        return t+' trips + '+q+' '+u;
                                                    })()}
                                                </td>
                                                <td style={{padding:'8px 12px',color:'#888',fontWeight:600}}>
                                                    {group.deliveries[0]?.vehicles[0]?.rateApplied ? '₹'+fmt(group.deliveries[0].vehicles[0].rateApplied)+'/trip' : '—'}
                                                </td>
                                                <td style={{padding:'8px 12px',color:'#eab308',fontWeight:700}}>₹{fmt(group.deliveries.reduce((s,d)=>s+d.totalAmount,0))}</td>
                                                <td></td>
                                            </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ))}

                                {/* ── DAILY BILL ── */}
                                {billType==='daily' && (
                                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:16}}>
                                        <thead>
                                        <tr>{['Vehicle','Destination','Type','Trips/Qty','Rate','Amount',''].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                        {(bill.deliveries || []).length===0 && <tr><td colSpan={7} style={{textAlign:'center',color:'#444',padding:24}}>No deliveries on this date</td></tr>}
                                        {(bill.deliveries || []).map(d =>
                                            d.vehicles.map((ve, vi) => (
                                                <tr key={d._id + "-" + vi}>
                                                    <td style={{padding:'9px 12px',color:'#ccc',borderBottom:'1px solid #161616'}}>{ve.vehicle?.vehicleNumber||'—'}</td>
                                                    <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{d.destination||'—'}</td>
                                                    <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}}><span className={'badge ' + (d.billingType==='Trip'?'badge-blue':'badge-yellow')}>{d.billingType}</span></td>
                                                    <td style={{padding:'9px 12px',color:'#fff',fontWeight:600,borderBottom:'1px solid #161616'}}>{d.billingType==='Trip' ? ve.numberOfTrips+' trips' : ve.quantity+' '+d.quantityUnit}</td>
                                                    <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>₹{fmt(ve.rateApplied)}</td>
                                                    <td style={{padding:'9px 12px',color:'#eab308',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(ve.totalAmount)}</td>
                                                    <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}} data-no-print="true">
                                                        {vi===0 && <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeleteDelivery(d._id)}>🗑</button>}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                        </tbody>
                                    </table>
                                )}

                                {billType==='weekly' && (() => {
                                    const allPayments = bill.weekPayments || [];
                                    if (allPayments.length === 0) return null;
                                    const totalPaid = allPayments.reduce((s,p)=>s+(p.amount||0),0);
                                    return (
                                        <div style={{marginBottom:16}}>
                                            <div style={{fontSize:13,fontWeight:600,color:'#ccc',marginBottom:8}}>💰 Payments Recorded</div>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                                <thead>
                                                <tr>{['Payment Date','Amount (₹)','Note',''].map(h=><th key={h} style={{padding:'7px 12px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr>
                                                </thead>
                                                <tbody>
                                                {allPayments.map(p=>(
                                                    <tr key={p._id}>
                                                        <td style={{padding:'9px 12px',color:'#4ade80',fontWeight:700,borderBottom:'1px solid #161616'}}>{fmtDate(p.date)}</td>
                                                        <td style={{padding:'9px 12px',color:'#4ade80',fontWeight:600,borderBottom:'1px solid #161616'}}>₹{fmt(p.amount)}</td>
                                                        <td style={{padding:'9px 12px',color:'#888',borderBottom:'1px solid #161616'}}>{(p.note||'').replace(/^__auto__(?::|)\s*/,'').replace(/^__auto_crossweek__(?::|)\s*/,'') || '—'}</td>
                                                        <td style={{padding:'9px 12px',borderBottom:'1px solid #161616'}} data-no-print="true">
                                                            <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}} onClick={()=>handleDeletePayment(p._id)}>🗑</button>
                                                        </td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                                <tfoot>
                                                <tr style={{background:'#0d1f0d',borderTop:'2px solid #166534'}}>
                                                    <td style={{padding:'10px 12px',color:'#4ade80',fontWeight:700,fontSize:13}}>Total Paid</td>
                                                    <td style={{padding:'10px 12px',color:'#4ade80',fontWeight:800,fontSize:15}}>₹{fmt(totalPaid)}</td>
                                                    <td colSpan={2}></td>
                                                </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    );
                                })()}

                                <div style={{background:'#1a1600',border:'1px solid #2a2400',borderRadius:10,padding:20}}>
                                    {billType==='weekly' ? (
                                        <>
                                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12,paddingBottom:12,borderBottom:'1px solid #2a2400'}}>
                                                {(() => {
                                                    const totalTrips = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0)||0;
                                                    const totalQty   = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0)||0;
                                                    const rate       = bill.deliveries?.find(d=>d.vehicles[0]?.rateApplied)?.vehicles[0]?.rateApplied||0;
                                                    const unit       = bill.deliveries?.find(d=>d.quantityUnit)?.quantityUnit||'units';
                                                    const tripsLabel = totalTrips>0&&totalQty===0 ? totalTrips+' trips'
                                                        : totalQty>0&&totalTrips===0 ? totalQty+' '+unit
                                                            : totalTrips+' trips + '+totalQty+' '+unit;
                                                    return [
                                                        {label:'TOTAL TRIPS/QTY', val: tripsLabel, isText:true, color:'#fff'},
                                                        {label:'RATE APPLIED',    val: rate>0?'₹'+fmt(rate)+'/trip':'—', isText:true, color:'#888'},
                                                        {label:'WEEK TOTAL',      val: '₹'+fmt(bill.weekTotal), isText:true, color:'#eab308'},
                                                    ].map(item=>(
                                                        <div key={item.label} style={{textAlign:'center'}}>
                                                            <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>{item.label}</div>
                                                            <div style={{fontSize:16,fontWeight:700,color:item.color}}>{item.val}</div>
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:16}}>
                                                {(()=>{
                                                    // Use backend-computed values — no client-side filtering
                                                    const totalPaid = (bill.weekPayments||[]).reduce((s,p)=>s+(p.amount||0),0);
                                                    const netDue = bill.netDue ?? Math.max(0, (bill.carriedBalance||0) + bill.weekTotal - totalPaid);
                                                    return [
                                                        {label:'CARRIED',   val:bill.carriedBalance, color:'#f87171'},
                                                        {label:'THIS WEEK', val:bill.weekTotal,      color:'#eab308'},
                                                        {label:'PAID',      val:totalPaid,           color:'#4ade80'},
                                                        {label:'NET DUE',   val:netDue,              color:netDue>0?'#f87171':'#4ade80'},
                                                    ].map(item=>(
                                                        <div key={item.label} style={{textAlign:'center'}}>
                                                            <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:6}}>{item.label}</div>
                                                            <div style={{fontSize:22,fontWeight:700,color:item.color}}>₹{fmt(item.val)}</div>
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
                                            {(() => {
                                                const totalTrips = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.numberOfTrips||0),0),0)||0;
                                                const totalQty   = bill.deliveries?.reduce((s,d)=>s+d.vehicles.reduce((vs,v)=>vs+(v.quantity||0),0),0)||0;
                                                const unit       = bill.deliveries?.find(d=>d.quantityUnit)?.quantityUnit||'units';
                                                const tripsLabel = totalTrips>0&&totalQty===0 ? totalTrips+' trips'
                                                    : totalQty>0&&totalTrips===0 ? totalQty+' '+unit
                                                        : totalTrips+' trips + '+totalQty+' '+unit;
                                                return (
                                                    <div style={{display:'flex',gap:32,alignItems:'center',flexWrap:'wrap'}}>
                                                        <div style={{textAlign:'center'}}>
                                                            <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Total Trips</div>
                                                            <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{tripsLabel}</div>
                                                        </div>
                                                        <div style={{textAlign:'center'}}>
                                                            <div style={{fontSize:11,color:'#666',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:4}}>Daily Total</div>
                                                            <div style={{fontSize:28,fontWeight:700,color:'#eab308'}}>₹{fmt(bill.totalAmount)}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>

                                <div style={{display:'flex',justifyContent:'space-between',marginTop:32,paddingTop:16}}>
                                    <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Customer Signature</div></div>
                                    <div style={{textAlign:'center',width:180}}><div style={{borderTop:'1px solid #444',paddingTop:8,fontSize:12,color:'#666'}}>Authorised Signature</div></div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function CustomerHistory({ customerId, vehicles, onDeleteDelivery }) {
    const [deliveries, setDeliveries] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`/billing/history/${customerId}`)
            .then(r => setDeliveries(r.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [customerId]);

    if (loading) return <div style={{padding:16,color:'#444',fontSize:13}}>Loading history...</div>;
    if (deliveries.length === 0) return <div style={{padding:16,color:'#444',fontSize:13,fontStyle:'italic'}}>No deliveries yet</div>;

    // ── Group deliveries by Mon–Sun week ──
    const getWeekStart = (dateStr) => {
        // Slice to YYYY-MM-DD and construct as local date to avoid UTC→IST timezone shift
        const [y, m, day2] = (dateStr || '').slice(0, 10).split('-').map(Number);
        const d = new Date(y, m - 1, day2);
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    const fmtD = (d) => { const [y,m,dd] = (d||'').slice(0,10).split('-'); return new Date(Number(y),Number(m)-1,Number(dd)).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}); };

    // Build ordered list of weeks (newest first) with their deliveries
    const weekMap = {};
    const weekOrder = [];
    [...deliveries].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(d => {
        const ws = getWeekStart(d.date);
        if (!weekMap[ws]) { weekMap[ws] = []; weekOrder.push(ws); }
        weekMap[ws].push(d);
    });

    return (
        <div style={{padding:'0 0 8px 0'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                <tr>{['Date','Material','Destination','Vehicles','Total Trips/Qty','Amount (₹)',''].map(h=>(
                    <th key={h} style={{padding:'8px 16px',color:'#555',borderBottom:'1px solid #1e1e1e',textAlign:'left',fontSize:11,textTransform:'uppercase'}}>{h}</th>
                ))}</tr>
                </thead>
                <tbody>
                {weekOrder.map(ws => {
                    const weekDeliveries = weekMap[ws];
                    const [wy,wm,wd] = ws.split('-').map(Number);
                    const weekEnd = new Date(wy, wm - 1, wd + 6);
                    const weekTotal = weekDeliveries.reduce((s, d) => s + (d.totalAmount || 0), 0);
                    const weekTrips = weekDeliveries.reduce((s, d) => s + d.vehicles.reduce((vs, v) => vs + (v.numberOfTrips || 0), 0), 0);
                    return (
                        <React.Fragment key={ws}>
                            {/* ── Week divider row ── */}
                            <tr>
                                <td colSpan={7} style={{padding:'8px 16px',background:'#1a1a2e',borderTop:'2px solid #2a2a4a',borderBottom:'1px solid #2a2a4a'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontSize:11,fontWeight:700,color:'#818cf8',textTransform:'uppercase',letterSpacing:'0.6px'}}>
                          📅 Week: {fmtD(ws)} — {fmtD(`${weekEnd.getFullYear()}-${String(weekEnd.getMonth()+1).padStart(2,'0')}-${String(weekEnd.getDate()).padStart(2,'0')}`)}
                        </span>
                                        <span style={{fontSize:12,color:'#888'}}>
                          {weekTrips > 0 && <span style={{color:'#a5b4fc',marginRight:12}}>{weekTrips} trips</span>}
                                            <span style={{color:'#eab308',fontWeight:600}}>₹{Number(weekTotal).toLocaleString('en-IN')}</span>
                        </span>
                                    </div>
                                </td>
                            </tr>
                            {/* ── Deliveries for this week ── */}
                            {weekDeliveries.map(d => (
                                <tr key={d._id} style={{borderBottom:'1px solid #161616'}}>
                                    <td style={{padding:'10px 16px',color:'#ccc'}}>{(() => { const [y,m,dd] = (d.date||'').slice(0,10).split('-'); return new Date(Number(y),Number(m)-1,Number(dd)).toLocaleDateString('en-IN'); })()}</td>
                                    <td style={{padding:'10px 16px',color:'#888'}}>{d.material||'—'}</td>
                                    <td style={{padding:'10px 16px',color:'#888'}}>{d.destination||'—'}</td>
                                    <td style={{padding:'10px 16px'}}><div style={{display:'flex',flexWrap:'wrap',gap:4}}>{d.vehicles.map((v,i)=><span key={i} className="badge badge-blue">{v.vehicle?.vehicleNumber||'—'}</span>)}</div></td>
                                    <td style={{padding:'10px 16px',color:'#fff',fontWeight:600}}>
                                        {d.billingType==='Trip' ? d.vehicles.reduce((s,v)=>s+(v.numberOfTrips||0),0)+' trips' : d.vehicles.reduce((s,v)=>s+(v.quantity||0),0)+' '+d.quantityUnit}
                                    </td>
                                    <td style={{padding:'10px 16px',color:'#eab308',fontWeight:600}}>₹{Number(d.totalAmount||0).toLocaleString('en-IN')}</td>
                                    <td style={{padding:'10px 16px'}}>
                                        <button className="btn btn-danger" style={{padding:'3px 7px',fontSize:11}}
                                                onClick={async()=>{ await onDeleteDelivery(d._id); setDeliveries(prev=>prev.filter(x=>x._id!==d._id)); }}>🗑</button>
                                    </td>
                                </tr>
                            ))}
                        </React.Fragment>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}