const logo = require('../assets/logo.jpg');
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
//import { printSection } from '../utils/printHelper';
import toast from 'react-hot-toast';
import { generateBillHTML } from '../utils/generateBillHTML';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit' });

export default function RentalBills() {
    const [tab, setTab] = useState('weekly');
    const [owners, setOwners] = useState([]);
    const [selectedOwner, setSelectedOwner] = useState('');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
    const [weeklyBill, setWeeklyBill] = useState(null);
    const [allWeekly, setAllWeekly] = useState(null);
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicle, setSelectedVehicle] = useState('');
    const [dailyBill, setDailyBill] = useState(null);
    const [loading, setLoading] = useState(false);
    const [combinedBill, setCombinedBill] = useState(null);
    const [rentalPayment, setRentalPayment] = useState(null);
    const [carryForward, setCarryForward] = useState({ weeks: [], total: 0 });
    const [dailyCarryForward, setDailyCarryForward] = useState({ weeks: [], total: 0 });
    const [combinedCarryForward, setCombinedCarryForward] = useState({ weeks: [], total: 0 });
    const [summaryCarryForwards, setSummaryCarryForwards] = useState({});
    const [rentalPayForm, setRentalPayForm] = useState({ isPaid:false, isPartial:false, amountPaid:'', note:'', paymentDate: new Date().toISOString().slice(0,10) });
    const [savingPay, setSavingPay] = useState(false);
    const [paymentHistory, setPaymentHistory] = useState([]);
    const [deletingPayId, setDeletingPayId] = useState(null);
    const printRef = useRef();

    const loadOwners = useCallback(async () => {
        try {
            const { data } = await api.get('/rentalbills/owners');
            setOwners(data);
            if (data.length > 0) setSelectedOwner(data[0]);
        } catch { toast.error('Failed to load owners'); }
    }, []);

    const loadVehicles = useCallback(async () => {
        try {
            const { data } = await api.get('/vehicles');
            const rental = data.filter(v => v.ownershipType === 'Rental');
            setVehicles(rental);
            if (rental.length > 0) setSelectedVehicle(rental[0]._id);
        } catch {}
    }, []);

    useEffect(() => { loadOwners(); loadVehicles(); }, [loadOwners, loadVehicles]);

    const loadRentalPayment = async (ownerName, weekStart) => {
        if (!ownerName || !weekStart) return;
        try {
            const { data } = await api.get(`/rentalbills/payment?ownerName=${encodeURIComponent(ownerName)}&weekStart=${encodeURIComponent(new Date(weekStart).toISOString())}`);
            setRentalPayment(data);
            if (data) {
                setRentalPayForm({
                    isPaid: data.isPaid,
                    isPartial: data.isPartial,
                    amountPaid: data.amountPaid || '',
                    note: data.note || '',
                    paymentDate: data.paidDate
                        ? new Date(data.paidDate).toISOString().slice(0, 10)
                        : new Date().toISOString().slice(0, 10),
                });
            } else {
                setRentalPayForm({ isPaid:false, isPartial:false, amountPaid:'', note:'', paymentDate: new Date().toISOString().slice(0,10) });
            }
        } catch {}
    };

    const loadCarryForward = async (ownerName, weekStart) => {
        if (!ownerName) return;
        try {
            // FIX: same timezone fix — use local date string to avoid IST→UTC shift
            const localDate = new Date(weekStart).toLocaleDateString('en-CA');
            const wStartIso = new Date(localDate + 'T00:00:00').toISOString();
            const { data } = await api.get(`/rentalbills/unpaid-carry-forward?ownerName=${encodeURIComponent(ownerName)}&beforeWeekStart=${wStartIso}`);
            // data: { weeks: [{ weekStart, weekEnd, totalBill, amountPaid, remaining }], total }
            setCarryForward(data || { weeks: [], total: 0 });
        } catch {
            setCarryForward({ weeks: [], total: 0 });
        }
    };

    const loadPaymentHistory = async (ownerName) => {
        if (!ownerName) return;
        try {
            const { data } = await api.get(`/rentalbills/payments/all?ownerName=${encodeURIComponent(ownerName.trim())}`);
            setPaymentHistory(data || []);
        } catch { setPaymentHistory([]); }
    };

    const handleDeletePayment = async (id) => {
        if (!window.confirm('Delete this payment record?')) return;
        setDeletingPayId(id);
        try {
            await api.delete(`/rentalbills/payment/${id}`);
            toast.success('Payment deleted');
            await loadPaymentHistory(weeklyBill?.ownerName);
            await loadCarryForward(weeklyBill?.ownerName, weeklyBill?.weekStart);
            await loadRentalPayment(weeklyBill?.ownerName, weeklyBill?.weekStart);
        } catch { toast.error('Failed to delete'); }
        finally { setDeletingPayId(null); }
    };

    const handleRentalPayment = async () => {
        if (!weeklyBill) return;
        const total = weeklyBill.grandNet + (carryForward.total || 0);
        const alreadyPaid = rentalPayment?.amountPaid || 0;
        if (rentalPayForm.isPartial) {
            const amt = Number(rentalPayForm.amountPaid)||0;
            if (amt <= 0) return toast.error('Enter a valid amount');
            if (amt > (total - alreadyPaid)) return toast.error(`Amount cannot exceed ₹${fmt(total - alreadyPaid)}`);
        }
        setSavingPay(true);
        try {
            const newPaid = rentalPayForm.isPaid
                ? total
                : Math.min(alreadyPaid + (Number(rentalPayForm.amountPaid)||0), total);
            // Use carry-forward week's weekStart if this week has no trips.
            // Send as ISO string — backend uses getWeekStart() to normalise to Monday UTC midnight.
            let targetWeekStart = new Date(weeklyBill.weekStart).toISOString();
            let targetTotalBill = total;
            if (weeklyBill.grandNet === 0 && carryForward.weeks && carryForward.weeks.length > 0) {
                const sorted = [...carryForward.weeks].sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart));
                targetWeekStart = new Date(sorted[0].weekStart).toISOString();
                targetTotalBill = sorted[0].remaining;
            }
            await api.post('/rentalbills/payment', {
                ownerName: weeklyBill.ownerName.trim(),
                weekStart: targetWeekStart,
                totalBill: targetTotalBill,
                amountPaid: newPaid,
                isPaid: rentalPayForm.isPaid,
                isPartial: rentalPayForm.isPartial,
                note: rentalPayForm.note,
                paidDate: rentalPayForm.paymentDate ? new Date(rentalPayForm.paymentDate).toISOString() : new Date().toISOString(),
            });
            toast.success(rentalPayForm.isPaid ? '✅ Fully paid' : `⚠️ Partial ₹${fmt(newPaid)} recorded`);
            await loadCarryForward(weeklyBill.ownerName, weeklyBill.weekStart);
            await loadRentalPayment(weeklyBill.ownerName, weeklyBill.weekStart);
            await loadPaymentHistory(weeklyBill.ownerName);
            setRentalPayForm({ isPaid:false, isPartial:false, amountPaid:'', note:'', paymentDate: new Date().toISOString().slice(0,10) });
        } catch { toast.error('Error saving'); }
        finally { setSavingPay(false); }
    };

    const loadWeekly = async () => {
        if (!selectedOwner) return toast.error('Select an owner');
        setLoading(true);
        try {
            const { data } = await api.get(`/rentalbills/weekly?ownerName=${encodeURIComponent(selectedOwner)}&date=${selectedDate}`);
            setWeeklyBill(data);
            await loadRentalPayment(data.ownerName, data.weekStart);
            await loadCarryForward(data.ownerName, data.weekStart);
            await loadPaymentHistory(data.ownerName);
        } catch { toast.error('Failed to load weekly bill'); }
        finally { setLoading(false); }
    };

    const loadAllWeekly = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/rentalbills/weekly/all?date=${selectedDate}`);
            setAllWeekly(data);
            // Fetch carry forward for each owner
            const wStartIso = new Date(data.weekStart).toISOString();
            const cfMap = {};
            await Promise.all(data.summary.map(async (s) => {
                try {
                    const cf = await api.get(`/rentalbills/unpaid-carry-forward?ownerName=${encodeURIComponent(s.ownerName)}&beforeWeekStart=${wStartIso}`);
                    cfMap[s.ownerName] = cf.data?.total || 0;
                } catch { cfMap[s.ownerName] = 0; }
            }));
            setSummaryCarryForwards(cfMap);
        } catch { toast.error('Failed to load summary'); }
        finally { setLoading(false); }
    };

    const loadCombined = async () => {
        if (!selectedOwner) return toast.error('Select an owner');
        setLoading(true);
        try {
            const { data } = await api.get(`/rentalbills/combined-weekly?ownerName=${encodeURIComponent(selectedOwner)}&date=${selectedDate}`);
            setCombinedBill(data);
            // Load rental carry forward for the combined bill
            try {
                const wStartIso = new Date(data.weekStart).toISOString();
                const cf = await api.get(`/rentalbills/unpaid-carry-forward?ownerName=${encodeURIComponent(selectedOwner)}&beforeWeekStart=${wStartIso}`);
                setCombinedCarryForward(cf.data || { weeks: [], total: 0 });
            } catch { setCombinedCarryForward({ weeks: [], total: 0 }); }
        } catch { toast.error('Failed to load combined bill'); }
        finally { setLoading(false); }
    };

    const loadDaily = async () => {
        if (!selectedVehicle) return toast.error('Select a vehicle');
        setLoading(true);
        try {
            const { data } = await api.get(`/rentalbills/daily/${selectedVehicle}?date=${selectedDate}`);
            setDailyBill(data);
            // Load carry forward for the owner of this vehicle
            if (data?.vehicle?.rentalOwnerName) {
                try {
                    // Use the selected date's week start as cutoff
                    const d = new Date(selectedDate);
                    // get Monday of that week
                    const day = d.getDay();
                    const diff = (day === 0 ? -6 : 1 - day);
                    d.setDate(d.getDate() + diff);
                    d.setHours(0,0,0,0);
                    const wStartIso = d.toISOString();
                    const cf = await api.get(`/rentalbills/unpaid-carry-forward?ownerName=${encodeURIComponent(data.vehicle.rentalOwnerName)}&beforeWeekStart=${wStartIso}`);
                    setDailyCarryForward(cf.data || { weeks: [], total: 0 });
                } catch { setDailyCarryForward({ weeks: [], total: 0 }); }
            } else {
                setDailyCarryForward({ weeks: [], total: 0 });
            }
        } catch { toast.error('Failed to load daily bill'); }
        finally { setLoading(false); }
    };

    const handleCleanupOrphanTrips = async () => {
        if (!window.confirm('This will permanently delete all orphaned trip records with no matching delivery. Proceed?')) return;
        try {
            const { data } = await api.post('/billing/cleanup-orphan-trips');
            toast.success(data.message);
            // Refresh the bill if currently shown
            if (weeklyBill) await loadWeekly();
        } catch (e) { toast.error('Cleanup failed: ' + (e?.response?.data?.message || e.message)); }
    };

    const sharePdfFromHtml = async (htmlString, filename) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;visibility:hidden;';
        document.body.appendChild(iframe);
        iframe.srcdoc = htmlString;
        await new Promise(resolve => { iframe.onload = resolve; });
        await new Promise(r => setTimeout(r, 300));
        try {
            const canvas = await html2canvas(iframe.contentDocument.body, {
                scale: 2, useCORS: true, backgroundColor: '#ffffff',
                width: 794, windowWidth: 794,
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.92);
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = (canvas.height * pdfW) / canvas.width;
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
            const pdfBlob = pdf.output('blob');
            const file = new File([pdfBlob], filename, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: filename });
            } else {
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                toast('PDF downloaded — share manually via WhatsApp');
            }
        } finally {
            document.body.removeChild(iframe);
        }
    };

    const handleWhatsApp = async () => {
        if (!weeklyBill && !dailyBill && !allWeekly && !combinedBill) return;
        const toastId = toast.loading('Generating PDF...');
        try {
            // Build the same HTML as handlePrint — reuse by calling it in a way that returns the string
            // We reconstruct rentalHtml here using the same logic already in handlePrint
            const billName =
                tab === 'weekly' && weeklyBill ? `Rental_Bill_${weeklyBill.ownerName}` :
                    tab === 'daily' && dailyBill ? `Daily_Bill_${dailyBill.vehicle.vehicleNumber}` :
                        tab === 'summary' ? 'Rental_Summary' :
                            tab === 'combined' && combinedBill ? `Combined_Bill_${combinedBill.ownerName}` : 'Rental_Bill';
            await sharePdfFromHtml(buildHtml(), `${billName}.pdf`);
            toast.dismiss(toastId);
        } catch (e) {
            toast.dismiss(toastId);
            toast.error('Could not share PDF');
            console.error(e);
        }
    };

    const buildHtml = () => {
        const CSS = `
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Segoe UI',Arial,sans-serif;padding:28px 32px;color:#111;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#f3f4f6;color:#111;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;border-bottom:2px solid #d1d5db;}
      td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#222;}
      tr:nth-child(even) td{background:#fafafa;}
      .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #111;}
      .summary-row{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
      .summary-item{flex:1;min-width:100px;border:1px solid #d1d5db;border-radius:6px;padding:10px 12px;text-align:center;background:#f9fafb;}
      .summary-label{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
      .summary-value{font-size:18px;font-weight:700;color:#111;}
      .summary-item.due .summary-value{font-size:20px;}
      .veh-header{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:0;}
      .total-box{border:2px solid #111;border-radius:6px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-top:18px;}
      .sig-row{display:flex;justify-content:space-between;margin-top:48px;}
      .sig-line{border-top:1px solid #9ca3af;padding-top:8px;font-size:11px;color:#6b7280;text-align:center;width:180px;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:16px 20px;}}
    `;
        // Reuse the exact same bodyHtml construction from handlePrint
        // We call handlePrint's inner logic by extracting it — simplest: just call handlePrint but capture bodyHtml
        // Instead, we share the same CSS+bodyHtml builder: delegate to handlePrint's variable
        // The cleanest approach: extract a getBillBodyHtml() helper
        const bodyHtml = getBillBodyHtml();
        return '<html><head><title>Rental Bill</title><style>' + CSS + '</style></head><body>' + bodyHtml + '</body></html>';
    };

    const getBillBodyHtml = () => {
        // ── WEEKLY BILL ──────────────────────────────────────────────
        if (tab === 'weekly' && weeklyBill) {
            const vehBlocks = weeklyBill.vehicles.map(vd => {
                const dailyRows = vd.dailyEntries.map(de =>
                    '<tr><td style="color:#475569;font-weight:500;">' + fmtDay(de.date) + '</td>' +
                    '<td style="color:#374151;">' + (de.tripCount > 0 ? de.tripCount : '&mdash;') + '</td>' +
                    '<td style="color:#7c3aed;">' + (de.quantity > 0 ? de.quantity + ' ' + (de.quantityUnit || 'brass') : '&mdash;') + '</td>' +
                    '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(de.rent) + '</td>' +
                    '<td style="color:#dc2626;">' + (de.diesel ? '&#8377;' + fmt(de.diesel) : '&mdash;') + '</td>' +
                    '<td style="color:#15803d;font-weight:700;">&#8377;' + fmt(de.rent - de.diesel) + '</td></tr>'
                ).join('');
                const qtyUnit = vd.dailyEntries.find(d => d.quantity > 0)?.quantityUnit || 'brass';
                return '<div style="margin-bottom:20px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                    '<div class="veh-header">' +
                    '<div><span style="font-weight:700;font-size:14px;">' + vd.vehicle.vehicleNumber + '</span>' +
                    '<span style="color:#6b7280;font-size:12px;margin-left:8px;">' + vd.vehicle.vehicleType + '</span></div>' +
                    '<div style="display:flex;gap:14px;font-size:12px;color:#374151;">' +
                    (vd.totalTrips > 0 ? '<span>Trips: <strong>' + vd.totalTrips + '</strong></span>' : '') +
                    (vd.totalQuantity > 0 ? '<span>Qty: <strong>' + vd.totalQuantity + ' ' + qtyUnit + '</strong></span>' : '') +
                    '<span>Rent: <strong>&#8377;' + fmt(vd.totalRent) + '</strong></span>' +
                    '<span>Diesel: <strong>&#8377;' + fmt(vd.totalDiesel) + '</strong></span>' +
                    '<span>Net: <strong>&#8377;' + fmt(vd.netAmount) + '</strong></span>' +
                    '</div></div>' +
                    '<table><thead><tr><th>Date</th><th>Trips</th><th>Quantity</th><th>Rent (&#8377;)</th><th>Diesel (&#8377;)</th><th>Net (&#8377;)</th></tr></thead>' +
                    '<tbody>' + (dailyRows || '<tr><td colspan="6" style="color:#9ca3af;font-style:italic;text-align:center;">No entries this week</td></tr>') + '</tbody>' +
                    '<tfoot><tr style="background:#f3f4f6;"><td colspan="3" style="padding:8px 10px;font-weight:600;">Weekly Total</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.totalRent) + '</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.totalDiesel) + '</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.netAmount) + '</td></tr></tfoot></table>' +
                    '</div>';
            }).join('');
            const netToPay = rentalPayment?.isPaid ? 0 : rentalPayment?.isPartial ? (weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment.amountPaid||0) : weeklyBill.grandNet + (carryForward.total||0);
            const cfBlock = carryForward.weeks.length > 0
                ? '<div style="margin-bottom:16px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                '<div style="background:#f3f4f6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d1d5db;">' +
                '<span style="font-weight:600;font-size:12px;">Carry Forward — Previous Unpaid Bills</span>' +
                '<span style="font-weight:700;font-size:13px;">&#8377;' + fmt(carryForward.total) + '</span>' +
                '</div>' +
                '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                carryForward.weeks.map(w =>
                    '<tr><td>' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                    '<td>&#8377;' + fmt(w.totalBill) + '</td>' +
                    '<td>&#8377;' + fmt(w.amountPaid) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                ).join('') +
                '</tbody><tfoot><tr style="background:#f3f4f6;">' +
                '<td colspan="3" style="padding:8px 10px;font-weight:600;">Total Carry Forward</td>' +
                '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(carryForward.total) + '</td></tr></tfoot></table></div>'
                : '';
            return '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/>' +
                '<div><div style="font-size:22px;font-weight:700;color:#111;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Weekly Rental Bill</div>' +
                '<div style="font-size:18px;font-weight:700;color:#111;">' + weeklyBill.ownerName + '</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:2px;">Week: ' + fmtDate(weeklyBill.weekStart) + ' to ' + fmtDate(weeklyBill.weekEnd) + '</div></div>' +
                '</div>' +
                '<div class="summary-row">' +
                '<div class="summary-item"><div class="summary-label">Total Rent</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandTotal) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Diesel</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandDiesel) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">This Week\'s Bill</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandNet) + '</div></div>' +
                (carryForward.total > 0 ? '<div class="summary-item"><div class="summary-label">Carry Forward</div><div class="summary-value">&#8377;' + fmt(carryForward.total) + '</div></div>' : '') +
                '<div class="summary-item due"><div class="summary-label">Total Due</div><div class="summary-value">&#8377;' + fmt(netToPay) + '</div></div>' +
                '</div>' +
                vehBlocks +
                cfBlock +
                '<div class="sig-row"><div><div class="sig-line">Owner Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        // ── DAILY BILL (WhatsApp/buildHtml) ──────────────────────────
        if (tab === 'daily' && dailyBill) {
            const tripRows = dailyBill.trips.map(t => {
                const isQty = t.billingType === 'Quantity';
                const rentTotal = isQty ? (t.rentalAmount||0)*(t.quantity||0) : (t.rentalAmount||0)*(t.numberOfTrips||1);
                return '<tr><td>' + (t.source||'&mdash;') + '</td>' +
                    '<td>' + (t.destination||'&mdash;') + '</td>' +
                    '<td>' + (isQty ? 'Qty (' + (t.quantityUnit||'brass') + ')' : 'Trip') + '</td>' +
                    '<td>' + (isQty ? (t.quantity||0) + ' ' + (t.quantityUnit||'brass') : (t.numberOfTrips||1)) + '</td>' +
                    '<td>&#8377;' + fmt(t.rentalAmount) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(rentTotal) + '</td>' +
                    '<td>' + (t.dieselAmount ? '&#8377;' + fmt(t.dieselAmount) : '&mdash;') + '</td></tr>';
            }).join('');
            return '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/>' +
                '<div><div style="font-size:22px;font-weight:700;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Daily Rental Bill</div>' +
                '<div style="font-size:18px;font-weight:700;">' + dailyBill.vehicle.vehicleNumber + '</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:2px;">Owner: ' + (dailyBill.vehicle.rentalOwnerName||'&mdash;') + ' &nbsp;&middot;&nbsp; ' + fmtDate(dailyBill.date) + '</div></div>' +
                '</div>' +
                '<div class="summary-row">' +
                '<div class="summary-item"><div class="summary-label">Rent Amount</div><div class="summary-value">&#8377;' + fmt(dailyBill.totalRent) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Diesel Deducted</div><div class="summary-value">&#8377;' + fmt(dailyBill.totalDiesel) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Net Payable</div><div class="summary-value">&#8377;' + fmt(dailyBill.netAmount) + '</div></div>' +
                (dailyCarryForward.total > 0 ? '<div class="summary-item"><div class="summary-label">Carry Forward</div><div class="summary-value">&#8377;' + fmt(dailyCarryForward.total) + '</div></div>' : '') +
                (dailyCarryForward.total > 0 ? '<div class="summary-item due"><div class="summary-label">Total Due</div><div class="summary-value">&#8377;' + fmt(dailyBill.netAmount + dailyCarryForward.total) + '</div></div>' : '') +
                '</div>' +
                '<table style="margin-bottom:14px;"><thead><tr><th>Source</th><th>Destination</th><th>Billing</th><th>Trips/Qty</th><th>Rate (&#8377;)</th><th>Rent (&#8377;)</th><th>Diesel (&#8377;)</th></tr></thead>' +
                '<tbody>' + (tripRows || '<tr><td colspan="7" style="color:#9ca3af;text-align:center;">No trips on this date</td></tr>') + '</tbody></table>' +
                (dailyCarryForward.weeks.length > 0
                    ? '<div style="margin-bottom:14px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                    '<div style="background:#f3f4f6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d1d5db;">' +
                    '<span style="font-weight:600;font-size:12px;">Carry Forward — Previous Unpaid Bills (' + (dailyBill.vehicle.rentalOwnerName||'') + ')</span>' +
                    '<span style="font-weight:700;font-size:13px;">&#8377;' + fmt(dailyCarryForward.total) + '</span>' +
                    '</div>' +
                    '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                    dailyCarryForward.weeks.map(w =>
                        '<tr><td>' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                        '<td>&#8377;' + fmt(w.totalBill) + '</td>' +
                        '<td>&#8377;' + fmt(w.amountPaid) + '</td>' +
                        '<td style="font-weight:600;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                    ).join('') +
                    '</tbody><tfoot><tr style="background:#f3f4f6;"><td colspan="3" style="padding:8px 10px;font-weight:600;">Total Carry Forward</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(dailyCarryForward.total) + '</td></tr></tfoot></table></div>'
                    : '') +
                '<div class="sig-row"><div><div class="sig-line">Driver Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        // ── SUMMARY (WhatsApp/buildHtml) ─────────────────────────────
        if (tab === 'summary' && allWeekly) {
            const summRows = allWeekly.summary.map(s => {
                const cf = summaryCarryForwards[s.ownerName] || 0;
                return '<tr><td style="font-weight:600;">' + s.ownerName + '</td>' +
                    '<td>' + s.vehicleCount + '</td>' +
                    '<td>' + s.totalTrips + '</td>' +
                    '<td>&#8377;' + fmt(s.totalRent) + '</td>' +
                    '<td>&#8377;' + fmt(s.totalDiesel) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(s.netAmount) + '</td>' +
                    '<td>' + (cf > 0 ? '&#8377;' + fmt(cf) : '&mdash;') + '</td>' +
                    '<td style="font-weight:700;">&#8377;' + fmt(s.netAmount + cf) + '</td></tr>';
            }).join('');
            const grandCF = allWeekly.summary.reduce((s, o) => s + (summaryCarryForwards[o.ownerName] || 0), 0);
            return '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/>' +
                '<div><div style="font-size:22px;font-weight:700;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Weekly Rental Summary</div>' +
                '<div style="font-size:13px;color:#374151;margin-top:3px;">Week: ' + fmtDate(allWeekly.weekStart) + ' to ' + fmtDate(allWeekly.weekEnd) + '</div></div>' +
                '</div>' +
                '<table><thead><tr><th>Owner Name</th><th>Vehicles</th><th>Total Trips</th><th>Total Rent</th><th>Diesel</th><th>Net Payable</th><th>Carry Fwd</th><th>Total Due</th></tr></thead>' +
                '<tbody>' + summRows + '</tbody>' +
                '<tfoot><tr style="background:#f3f4f6;"><td colspan="2" style="padding:8px 10px;font-weight:700;">Grand Total</td>' +
                '<td style="padding:8px 10px;font-weight:600;">' + allWeekly.summary.reduce((s,o)=>s+o.totalTrips,0) + '</td>' +
                '<td style="padding:8px 10px;font-weight:600;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.totalRent,0)) + '</td>' +
                '<td style="padding:8px 10px;font-weight:600;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.totalDiesel,0)) + '</td>' +
                '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.netAmount,0)) + '</td>' +
                '<td style="padding:8px 10px;font-weight:600;">&#8377;' + fmt(grandCF) + '</td>' +
                '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.netAmount+(summaryCarryForwards[o.ownerName]||0),0)) + '</td></tr></tfoot></table>';
        }

        // ── COMBINED (WhatsApp/buildHtml) — delegate to handlePrint logic ─
        if (tab === 'combined' && combinedBill) {
            const cb = combinedBill;
            const finalAbs = Math.abs(cb.finalSettlement);
            const wePayOwner = cb.finalSettlement > 0;
            const ownerPaysUs = cb.finalSettlement < 0;
            const rentalVehBlocks = cb.rental.vehicles.map(vd => {
                const rows = vd.dailyEntries.map(de =>
                    '<tr><td>' + fmtDay(de.date) + '</td>' +
                    '<td>' + (de.tripCount > 0 ? de.tripCount : '&mdash;') + '</td>' +
                    '<td>' + (de.quantity > 0 ? de.quantity + ' ' + de.quantityUnit : '&mdash;') + '</td>' +
                    '<td>&#8377;' + fmt(de.rent) + '</td>' +
                    '<td>' + (de.diesel ? '&#8377;' + fmt(de.diesel) : '&mdash;') + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(de.rent - de.diesel) + '</td></tr>'
                ).join('');
                return '<div style="margin-bottom:10px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                    '<div style="background:#f3f4f6;padding:7px 10px;display:flex;justify-content:space-between;">' +
                    '<strong>' + vd.vehicle.vehicleNumber + '</strong>' +
                    '<span style="font-size:12px;">Rent: &#8377;' + fmt(vd.totalRent) + ' | Diesel: &#8377;' + fmt(vd.totalDiesel) + ' | Net: <strong>&#8377;' + fmt(vd.netAmount) + '</strong></span>' +
                    '</div>' +
                    '<table><thead><tr><th>Date</th><th>Trips</th><th>Quantity</th><th>Rent</th><th>Diesel</th><th>Net</th></tr></thead>' +
                    '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">No entries</td></tr>') + '</tbody></table></div>';
            }).join('');
            const billingRows = cb.billing ? cb.billing.dailyGroups.map(dg =>
                '<tr><td>' + fmtDay(dg.date) + '</td><td>' + dg.deliveries.length + '</td><td style="font-weight:600;">&#8377;' + fmt(dg.total) + '</td></tr>'
            ).join('') : '';
            const khetRows = cb.khet ? cb.khet.orders.map(o =>
                '<tr><td>' + fmtDay(o.date) + '</td><td>' + (o.material || '&mdash;') + '</td><td>' + o.billingType + '</td>' +
                '<td>' + (o.billingType === 'Quantity' ? o.vehicles.reduce((s, v) => s + (v.quantity || 0), 0) + ' ' + o.quantityUnit : o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0)) + '</td>' +
                '<td>&#8377;' + fmt(o.totalAmount) + '</td>' +
                '<td style="font-weight:600;">&#8377;' + fmt(o.grandTotal || o.totalAmount) + '</td></tr>'
            ).join('') : '';
            const cfCombinedBlock = combinedCarryForward.weeks.length > 0
                ? '<div style="margin-bottom:14px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                '<div style="background:#f3f4f6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d1d5db;">' +
                '<span style="font-weight:600;font-size:12px;">Carry Forward — Previous Unpaid Rental Bills</span>' +
                '<span style="font-weight:700;font-size:13px;">&#8377;' + fmt(combinedCarryForward.total) + '</span>' +
                '</div>' +
                '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                combinedCarryForward.weeks.map(w =>
                    '<tr><td>' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                    '<td>&#8377;' + fmt(w.totalBill) + '</td>' +
                    '<td>&#8377;' + fmt(w.amountPaid) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                ).join('') +
                '</tbody><tfoot><tr style="background:#f3f4f6;"><td colspan="3" style="padding:8px 10px;font-weight:600;">Total Carry Forward</td>' +
                '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(combinedCarryForward.total) + '</td></tr></tfoot></table>' +
                '<div style="padding:8px 12px;text-align:right;font-size:12px;border-top:1px solid #e5e7eb;">' +
                'This Week: <strong>&#8377;' + fmt(cb.weOweOwner) + '</strong> + Carry Fwd: <strong>&#8377;' + fmt(combinedCarryForward.total) + '</strong> = <strong>Total Rental Due: &#8377;' + fmt(cb.weOweOwner + combinedCarryForward.total) + '</strong>' +
                '</div></div>'
                : '';
            return '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:22px;font-weight:700;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div></div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Combined Weekly Bill</div>' +
                '<div style="font-size:18px;font-weight:700;">' + cb.ownerName + '</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:2px;">Week: ' + fmtDate(cb.weekStart) + ' to ' + fmtDate(cb.weekEnd) + '</div></div>' +
                '</div>' +
                '<div class="summary-row">' +
                '<div class="summary-item"><div class="summary-label">Rental — We Owe Owner</div><div class="summary-value">&#8377;' + fmt(cb.weOweOwner) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Billing Due</div><div class="summary-value">&#8377;' + fmt(cb.billing?.netDue || 0) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Khet Due</div><div class="summary-value">&#8377;' + fmt(cb.khet?.netDue || 0) + '</div></div>' +
                '<div class="summary-item due"><div class="summary-label">' + (wePayOwner ? 'We Pay Owner' : ownerPaysUs ? 'Owner Pays Us' : 'Settled') + '</div><div class="summary-value">&#8377;' + fmt(finalAbs) + '</div></div>' +
                '</div>' +
                '<h3 style="font-size:13px;font-weight:700;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #d1d5db;">Section 1 — Rental Bill (We Owe Owner)</h3>' +
                rentalVehBlocks +
                '<div style="text-align:right;font-size:12px;margin-bottom:8px;">Gross Rent: <strong>&#8377;' + fmt(cb.rental.grossRent) + '</strong> &nbsp; Diesel: <strong>&#8377;' + fmt(cb.rental.grossDiesel) + '</strong> &nbsp; <strong>This Week Net: &#8377;' + fmt(cb.weOweOwner) + '</strong></div>' +
                cfCombinedBlock +
                '<h3 style="font-size:13px;font-weight:700;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #d1d5db;">Section 2 — Billing Purchases (Owner Owes Us)</h3>' +
                (cb.billing
                    ? (cb.billing.carriedBalance > 0 ? '<div style="background:#f9fafb;border:1px solid #d1d5db;border-radius:4px;padding:7px 10px;margin-bottom:8px;font-size:12px;">Carried Forward: <strong>&#8377;' + fmt(cb.billing.carriedBalance) + '</strong></div>' : '') +
                    '<table><thead><tr><th>Date</th><th>Deliveries</th><th>Amount (&#8377;)</th></tr></thead><tbody>' + (billingRows || '<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No deliveries this week</td></tr>') + '</tbody></table>' +
                    '<div style="text-align:right;font-size:12px;margin:7px 0 16px;">Carry Fwd: <strong>&#8377;' + fmt(cb.billing.carriedBalance) + '</strong> &nbsp; This Week: <strong>&#8377;' + fmt(cb.billing.weekTotal) + '</strong> &nbsp; Paid: <strong>&#8377;' + fmt(cb.billing.weekPaid) + '</strong> &nbsp; <strong>Net Due: &#8377;' + fmt(cb.billing.netDue) + '</strong></div>'
                    : '<p style="color:#6b7280;font-style:italic;font-size:12px;">No billing customer found for this owner.</p>') +
                '<h3 style="font-size:13px;font-weight:700;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #d1d5db;">Section 3 — Khet Purchases (Owner Owes Us)</h3>' +
                (cb.khet
                    ? (cb.khet.carriedBalance > 0 ? '<div style="background:#f9fafb;border:1px solid #d1d5db;border-radius:4px;padding:7px 10px;margin-bottom:8px;font-size:12px;">Carried Forward: <strong>&#8377;' + fmt(cb.khet.carriedBalance) + '</strong></div>' : '') +
                    '<table><thead><tr><th>Date</th><th>Material</th><th>Billing</th><th>Trips/Qty</th><th>Amount</th><th>Total (&#8377;)</th></tr></thead><tbody>' + khetRows + '</tbody></table>' +
                    '<div style="text-align:right;font-size:12px;margin:7px 0 16px;">Carry Fwd: <strong>&#8377;' + fmt(cb.khet.carriedBalance) + '</strong> &nbsp; This Week: <strong>&#8377;' + fmt(cb.khet.grandTotal) + '</strong> &nbsp; Paid: <strong>&#8377;' + fmt(cb.khet.weekPaid) + '</strong> &nbsp; <strong>Net Due: &#8377;' + fmt(cb.khet.netDue) + '</strong></div>'
                    : '<p style="color:#6b7280;font-style:italic;font-size:12px;">No khet orders found for this owner.</p>') +
                '<div class="total-box">' +
                '<div style="font-size:13px;font-weight:700;">FINAL SETTLEMENT</div>' +
                '<div style="color:#6b7280;font-size:12px;">Rental &#8377;' + fmt(cb.weOweOwner) + ' &minus; Billing &#8377;' + fmt(cb.billing?.netDue || 0) + ' &minus; Khet &#8377;' + fmt(cb.khet?.netDue || 0) + '</div>' +
                '<div><div style="font-size:11px;color:#374151;margin-bottom:3px;">' + (wePayOwner ? 'WE PAY OWNER' : ownerPaysUs ? 'OWNER PAYS US' : 'SETTLED') + '</div>' +
                '<div style="font-size:24px;font-weight:700;">&#8377;' + fmt(finalAbs) + '</div></div>' +
                '</div>' +
                '<div class="sig-row"><div><div class="sig-line">Owner Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        return '';
    };

    const handlePrint = () => {
        if (!weeklyBill && !dailyBill && !allWeekly && !combinedBill) return;
        const CSS = `
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Segoe UI',Arial,sans-serif;padding:28px 32px;color:#111;background:#fff;font-size:13px;}
      table{width:100%;border-collapse:collapse;}
      th{background:#f3f4f6;color:#111;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;border-bottom:2px solid #d1d5db;}
      td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#222;}
      tr:nth-child(even) td{background:#fafafa;}
      .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #111;}
      .summary-row{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
      .summary-item{flex:1;min-width:100px;border:1px solid #d1d5db;border-radius:6px;padding:10px 12px;text-align:center;background:#f9fafb;}
      .summary-label{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
      .summary-value{font-size:18px;font-weight:700;color:#111;}
      .summary-item.due .summary-value{font-size:20px;}
      .veh-header{background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:0;}
      .total-box{border:2px solid #111;border-radius:6px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-top:18px;}
      .sig-row{display:flex;justify-content:space-between;margin-top:48px;}
      .sig-line{border-top:1px solid #9ca3af;padding-top:8px;font-size:11px;color:#6b7280;text-align:center;width:180px;}
      tfoot{display:table-row-group!important;}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}body{padding:16px 20px;}}
    `;
        let bodyHtml = '';

        // ── WEEKLY BILL ──────────────────────────────────────────────
        if (tab === 'weekly' && weeklyBill) {
            const vehBlocks = weeklyBill.vehicles.map(vd => {
                const dailyRows = vd.dailyEntries.map(de =>
                    '<tr><td>' + fmtDay(de.date) + '</td>' +
                    '<td>' + (de.tripCount > 0 ? de.tripCount : '&mdash;') + '</td>' +
                    '<td>' + (de.quantity > 0 ? de.quantity + ' ' + (de.quantityUnit || 'brass') : '&mdash;') + '</td>' +
                    '<td>&#8377;' + fmt(de.rent) + '</td>' +
                    '<td>' + (de.diesel ? '&#8377;' + fmt(de.diesel) : '&mdash;') + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(de.rent - de.diesel) + '</td></tr>'
                ).join('');
                const qtyUnit = vd.dailyEntries.find(d => d.quantity > 0)?.quantityUnit || 'brass';
                return '<div style="margin-bottom:20px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                    '<div class="veh-header">' +
                    '<div><span style="font-weight:700;font-size:14px;">' + vd.vehicle.vehicleNumber + '</span>' +
                    '<span style="color:#6b7280;font-size:12px;margin-left:8px;">' + vd.vehicle.vehicleType + '</span></div>' +
                    '<div style="display:flex;gap:14px;font-size:12px;">' +
                    (vd.totalTrips > 0 ? '<span>Trips: <strong>' + vd.totalTrips + '</strong></span>' : '') +
                    (vd.totalQuantity > 0 ? '<span>Qty: <strong>' + vd.totalQuantity + ' ' + qtyUnit + '</strong></span>' : '') +
                    '<span>Rent: <strong>&#8377;' + fmt(vd.totalRent) + '</strong></span>' +
                    '<span>Diesel: <strong>&#8377;' + fmt(vd.totalDiesel) + '</strong></span>' +
                    '<span>Net: <strong>&#8377;' + fmt(vd.netAmount) + '</strong></span>' +
                    '</div></div>' +
                    '<table><thead><tr><th>Date</th><th>Trips</th><th>Quantity</th><th>Rent (&#8377;)</th><th>Diesel (&#8377;)</th><th>Net (&#8377;)</th></tr></thead>' +
                    '<tbody>' + (dailyRows || '<tr><td colspan="6" style="color:#9ca3af;font-style:italic;text-align:center;">No entries this week</td></tr>') + '</tbody>' +
                    '<tfoot><tr style="background:#f3f4f6;"><td colspan="3" style="padding:8px 10px;font-weight:600;">Weekly Total</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.totalRent) + '</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.totalDiesel) + '</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(vd.netAmount) + '</td></tr></tfoot></table>' +
                    '</div>';
            }).join('');
            const netToPay = rentalPayment?.isPaid ? 0 : rentalPayment?.isPartial ? (weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment.amountPaid||0) : weeklyBill.grandNet + (carryForward.total||0);
            const cfBlock = carryForward.weeks.length > 0
                ? '<div style="margin-bottom:16px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                '<div style="background:#f3f4f6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d1d5db;">' +
                '<span style="font-weight:600;font-size:12px;">Carry Forward — Previous Unpaid Bills</span>' +
                '<span style="font-weight:700;font-size:13px;">&#8377;' + fmt(carryForward.total) + '</span>' +
                '</div>' +
                '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                carryForward.weeks.map(w =>
                    '<tr><td>' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                    '<td>&#8377;' + fmt(w.totalBill) + '</td>' +
                    '<td>&#8377;' + fmt(w.amountPaid) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                ).join('') +
                '</tbody><tfoot><tr style="background:#f3f4f6;">' +
                '<td colspan="3" style="padding:8px 10px;font-weight:600;">Total Carry Forward</td>' +
                '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(carryForward.total) + '</td></tr></tfoot></table></div>'
                : '';
            bodyHtml =
                '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/>' +
                '<div><div style="font-size:22px;font-weight:700;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Weekly Rental Bill</div>' +
                '<div style="font-size:18px;font-weight:700;">' + weeklyBill.ownerName + '</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:2px;">Week: ' + fmtDate(weeklyBill.weekStart) + ' to ' + fmtDate(weeklyBill.weekEnd) + '</div></div>' +
                '</div>' +
                '<div class="summary-row">' +
                '<div class="summary-item"><div class="summary-label">Total Rent</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandTotal) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Diesel</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandDiesel) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">This Week\'s Bill</div><div class="summary-value">&#8377;' + fmt(weeklyBill.grandNet) + '</div></div>' +
                (carryForward.total > 0 ? '<div class="summary-item"><div class="summary-label">Carry Forward</div><div class="summary-value">&#8377;' + fmt(carryForward.total) + '</div></div>' : '') +
                '<div class="summary-item due"><div class="summary-label">Total Due</div><div class="summary-value">&#8377;' + fmt(netToPay) + '</div></div>' +
                '</div>' +
                vehBlocks +
                cfBlock +
                '<div class="sig-row"><div><div class="sig-line">Owner Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        // ── DAILY BILL ──────────────────────────────────────────────
        else if (tab === 'daily' && dailyBill) {
            const tripRows = dailyBill.trips.map(t => {
                const isQty = t.billingType === 'Quantity';
                const rentTotal = isQty ? (t.rentalAmount||0)*(t.quantity||0) : (t.rentalAmount||0)*(t.numberOfTrips||1);
                return '<tr><td>' + (t.source||'&mdash;') + '</td>' +
                    '<td>' + (t.destination||'&mdash;') + '</td>' +
                    '<td>' + (isQty ? 'Qty (' + (t.quantityUnit||'brass') + ')' : 'Trip') + '</td>' +
                    '<td>' + (isQty ? (t.quantity||0) + ' ' + (t.quantityUnit||'brass') : (t.numberOfTrips||1)) + '</td>' +
                    '<td>&#8377;' + fmt(t.rentalAmount) + '</td>' +
                    '<td style="font-weight:600;">&#8377;' + fmt(rentTotal) + '</td>' +
                    '<td>' + (t.dieselAmount ? '&#8377;' + fmt(t.dieselAmount) : '&mdash;') + '</td></tr>';
            }).join('');
            bodyHtml =
                '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:70px;width:auto;object-fit:contain;" alt="logo"/>' +
                '<div><div style="font-size:22px;font-weight:700;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Daily Rental Bill</div>' +
                '<div style="font-size:18px;font-weight:700;">' + dailyBill.vehicle.vehicleNumber + '</div>' +
                '<div style="font-size:11px;color:#6b7280;margin-top:2px;">Owner: ' + (dailyBill.vehicle.rentalOwnerName||'&mdash;') + ' &nbsp;&middot;&nbsp; ' + fmtDate(dailyBill.date) + '</div></div>' +
                '</div>' +
                '<div class="summary-row">' +
                '<div class="summary-item"><div class="summary-label">Rent Amount</div><div class="summary-value">&#8377;' + fmt(dailyBill.totalRent) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Diesel Deducted</div><div class="summary-value">&#8377;' + fmt(dailyBill.totalDiesel) + '</div></div>' +
                '<div class="summary-item"><div class="summary-label">Net Payable</div><div class="summary-value">&#8377;' + fmt(dailyBill.netAmount) + '</div></div>' +
                (dailyCarryForward.total > 0 ? '<div class="summary-item"><div class="summary-label">Carry Forward</div><div class="summary-value">&#8377;' + fmt(dailyCarryForward.total) + '</div></div>' : '') +
                (dailyCarryForward.total > 0 ? '<div class="summary-item due"><div class="summary-label">Total Due</div><div class="summary-value">&#8377;' + fmt(dailyBill.netAmount + dailyCarryForward.total) + '</div></div>' : '') +
                '</div>' +
                '<table style="margin-bottom:14px;"><thead><tr><th>Source</th><th>Destination</th><th>Billing</th><th>Trips/Qty</th><th>Rate (&#8377;)</th><th>Rent (&#8377;)</th><th>Diesel (&#8377;)</th></tr></thead>' +
                '<tbody>' + (tripRows || '<tr><td colspan="7" style="color:#9ca3af;text-align:center;">No trips on this date</td></tr>') + '</tbody></table>' +
                (dailyCarryForward.weeks.length > 0
                    ? '<div style="margin-bottom:14px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">' +
                    '<div style="background:#f3f4f6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d1d5db;">' +
                    '<span style="font-weight:600;font-size:12px;">Carry Forward — Previous Unpaid Bills (' + (dailyBill.vehicle.rentalOwnerName||'') + ')</span>' +
                    '<span style="font-weight:700;font-size:13px;">&#8377;' + fmt(dailyCarryForward.total) + '</span>' +
                    '</div>' +
                    '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                    dailyCarryForward.weeks.map(w =>
                        '<tr><td>' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                        '<td>&#8377;' + fmt(w.totalBill) + '</td>' +
                        '<td>&#8377;' + fmt(w.amountPaid) + '</td>' +
                        '<td style="font-weight:600;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                    ).join('') +
                    '</tbody><tfoot><tr style="background:#f3f4f6;">' +
                    '<td colspan="3" style="padding:8px 10px;font-weight:600;">Total Carry Forward</td>' +
                    '<td style="padding:8px 10px;font-weight:700;">&#8377;' + fmt(dailyCarryForward.total) + '</td></tr></tfoot></table>' +
                    '<div style="padding:8px 12px;text-align:right;font-size:12px;border-top:1px solid #e5e7eb;">' +
                    'Today: <strong>&#8377;' + fmt(dailyBill.netAmount) + '</strong> + Carry Fwd: <strong>&#8377;' + fmt(dailyCarryForward.total) + '</strong> = <strong>Total Due: &#8377;' + fmt(dailyBill.netAmount + dailyCarryForward.total) + '</strong>' +
                    '</div></div>'
                    : '') +
                '<div class="sig-row"><div><div class="sig-line">Driver Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        // ── SUMMARY ──────────────────────────────────────────────────
        else if (tab === 'summary' && allWeekly) {
            const summRows = allWeekly.summary.map(s => {
                const cf = summaryCarryForwards[s.ownerName] || 0;
                return '<tr><td style="font-weight:700;color:#0f172a;">' + s.ownerName + '</td>' +
                    '<td style="color:#64748b;">' + s.vehicleCount + '</td>' +
                    '<td style="color:#1d4ed8;font-weight:700;">' + s.totalTrips + '</td>' +
                    '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(s.totalRent) + '</td>' +
                    '<td style="color:#dc2626;font-weight:700;">&#8377;' + fmt(s.totalDiesel) + '</td>' +
                    '<td style="color:#15803d;font-weight:800;">&#8377;' + fmt(s.netAmount) + '</td>' +
                    '<td style="color:' + (cf > 0 ? '#c2410c' : '#94a3b8') + ';font-weight:' + (cf > 0 ? '700' : '400') + ';">' + (cf > 0 ? '&#8377;' + fmt(cf) : '&mdash;') + '</td>' +
                    '<td style="color:#dc2626;font-weight:900;">&#8377;' + fmt(s.netAmount + cf) + '</td></tr>';
            }).join('');
            const grandCF = allWeekly.summary.reduce((s, o) => s + (summaryCarryForwards[o.ownerName] || 0), 0);
            bodyHtml =
                '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/>' +

                '<div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:5px;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">Chand Laluwale &amp; Roshan Laluwale</div></div>' +
                '</div>' +
                '<div style="text-align:right;"><div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.9px;margin-bottom:4px;">Weekly Rental Summary</div>' +
                '<div style="font-size:14px;color:#64748b;margin-top:4px;">Week: ' + fmtDate(allWeekly.weekStart) + ' to ' + fmtDate(allWeekly.weekEnd) + '</div></div>' +
                '</div>' +
                '<table><thead><tr><th>Owner Name</th><th>Vehicles</th><th>Total Trips</th><th>Total Rent</th><th>Diesel</th><th>Net Payable</th><th>&#x23EA; Carry Fwd</th><th>Total Due</th></tr></thead>' +
                '<tbody>' + summRows + '</tbody>' +
                '<tfoot><tr style="background:#0f172a;"><td colspan="2" style="padding:11px 12px;color:#f8fafc;font-weight:800;">Grand Total</td>' +
                '<td style="padding:11px 12px;color:#93c5fd;font-weight:800;">' + allWeekly.summary.reduce((s,o)=>s+o.totalTrips,0) + '</td>' +
                '<td style="padding:11px 12px;color:#fcd34d;font-weight:800;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.totalRent,0)) + '</td>' +
                '<td style="padding:11px 12px;color:#fca5a5;font-weight:800;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.totalDiesel,0)) + '</td>' +
                '<td style="padding:11px 12px;color:#4ade80;font-weight:900;font-size:14px;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.netAmount,0)) + '</td>' +
                '<td style="padding:11px 12px;color:#fb923c;font-weight:900;">&#8377;' + fmt(grandCF) + '</td>' +
                '<td style="padding:11px 12px;color:#fca5a5;font-weight:900;font-size:14px;">&#8377;' + fmt(allWeekly.summary.reduce((s,o)=>s+o.netAmount+(summaryCarryForwards[o.ownerName]||0),0)) + '</td></tr></tfoot></table>';
        }

        // ── COMBINED BILL ─────────────────────────────────────────────
        else if (tab === 'combined' && combinedBill) {
            const cb = combinedBill;
            const cf = combinedCarryForward.total || 0;
            const totalRentalDue = cb.weOweOwner + cf;
            const adjustedSettlement = totalRentalDue - cb.ownerOwesUs;
            const finalAbs = Math.abs(adjustedSettlement);
            const wePayOwner = adjustedSettlement > 0;
            const ownerPaysUs = adjustedSettlement < 0;

            // Rental rows
            const rentalVehBlocks = cb.rental.vehicles.map(vd => {
                const rows = vd.dailyEntries.map(de =>
                    '<tr><td>' + fmtDay(de.date) + '</td>' +
                    '<td>' + (de.tripCount > 0 ? de.tripCount : '&mdash;') + '</td>' +
                    '<td style="color:#7c3aed;">' + (de.quantity > 0 ? de.quantity + ' ' + de.quantityUnit : '&mdash;') + '</td>' +
                    '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(de.rent) + '</td>' +
                    '<td style="color:#dc2626;">' + (de.diesel ? '&#8377;' + fmt(de.diesel) : '&mdash;') + '</td>' +
                    '<td style="color:#15803d;font-weight:700;">&#8377;' + fmt(de.rent - de.diesel) + '</td></tr>'
                ).join('');
                return '<div style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">' +
                    '<div style="background:#f1f5f9;padding:8px 12px;display:flex;justify-content:space-between;">' +
                    '<strong>' + vd.vehicle.vehicleNumber + '</strong>' +
                    '<span>Rent: &#8377;' + fmt(vd.totalRent) + ' | Diesel: &#8377;' + fmt(vd.totalDiesel) + ' | Net: <strong style="color:#15803d;">&#8377;' + fmt(vd.netAmount) + '</strong></span>' +
                    '</div>' +
                    '<table><thead><tr><th>Date</th><th>Trips</th><th>Quantity</th><th>Rent</th><th>Diesel</th><th>Net</th></tr></thead>' +
                    '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No entries</td></tr>') + '</tbody></table></div>';
            }).join('');

            // Billing rows
            const billingRows = cb.billing ? cb.billing.dailyGroups.map(dg =>
                '<tr><td>' + fmtDay(dg.date) + '</td><td>' + dg.deliveries.length + '</td><td style="color:#b45309;font-weight:700;">&#8377;' + fmt(dg.total) + '</td></tr>'
            ).join('') : '';

            // Khet rows
            const khetRows = cb.khet ? cb.khet.orders.map(o =>
                '<tr><td>' + fmtDay(o.date) + '</td>' +
                '<td>' + (o.material || '&mdash;') + '</td>' +
                '<td>' + o.billingType + '</td>' +
                '<td>' + (o.billingType === 'Quantity' ? o.vehicles.reduce((s, v) => s + (v.quantity || 0), 0) + ' ' + o.quantityUnit : o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0)) + '</td>' +
                '<td style="color:#b45309;font-weight:700;">&#8377;' + fmt(o.totalAmount) + '</td>' +
                '<td style="color:#c2410c;font-weight:700;">&#8377;' + fmt(o.grandTotal || o.totalAmount) + '</td></tr>'
            ).join('') : '';

            bodyHtml =
                '<div class="header">' +
                '<div style="display:flex;align-items:center;gap:12px;"><img src="' + logo + '" style="height:100px;width:auto;object-fit:contain;" alt="logo"/><div><div style="font-size:26px;font-weight:900;color:#0f172a;">R.C. Enterprises</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:5px;text-transform:uppercase;letter-spacing:0.8px;">Chand Laluwale &amp; Roshan Laluwale</div></div></div>' +
                '<div style="text-align:right;"><div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.9px;margin-bottom:4px;">Combined Weekly Bill</div>' +
                '<div style="font-size:20px;font-weight:900;color:#0f172a;">' + cb.ownerName + '</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:3px;">Week: ' + fmtDate(cb.weekStart) + ' to ' + fmtDate(cb.weekEnd) + '</div></div>' +
                '</div>' +

                // Settlement chips — include carry forward chip if present
                '<div class="chip-row">' +
                '<div class="chip" style="background:#dcfce7;border:2px solid #86efac;"><div class="chip-label" style="color:#15803d;">Rental This Week</div><div class="chip-value" style="color:#15803d;">&#8377;' + fmt(cb.weOweOwner) + '</div></div>' +
                (cf > 0 ? '<div class="chip" style="background:#ffedd5;border:2px solid #fb923c;"><div class="chip-label" style="color:#c2410c;">&#x23EA; Carry Forward</div><div class="chip-value" style="color:#c2410c;">&#8377;' + fmt(cf) + '</div></div>' : '') +
                '<div class="chip" style="background:#fee2e2;border:2px solid #fca5a5;"><div class="chip-label" style="color:#dc2626;">Billing Due</div><div class="chip-value" style="color:#dc2626;">&#8377;' + fmt(cb.billing?.netDue || 0) + '</div></div>' +
                '<div class="chip" style="background:#ffedd5;border:2px solid #fdba74;"><div class="chip-label" style="color:#c2410c;">Khet Due</div><div class="chip-value" style="color:#c2410c;">&#8377;' + fmt(cb.khet?.netDue || 0) + '</div></div>' +
                '<div class="chip" style="background:' + (wePayOwner ? '#dcfce7' : '#fee2e2') + ';border:2px solid ' + (wePayOwner ? '#86efac' : '#fca5a5') + ';"><div class="chip-label" style="color:' + (wePayOwner ? '#15803d' : '#dc2626') + ';">' + (wePayOwner ? 'We Pay Owner' : ownerPaysUs ? 'Owner Pays Us' : 'Settled') + '</div><div class="chip-value" style="color:' + (wePayOwner ? '#15803d' : '#dc2626') + ';">&#8377;' + fmt(finalAbs) + '</div></div>' +
                '</div>' +

                // Section 1: Rental
                '<h3 style="color:#0f172a;font-size:14px;font-weight:800;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;">Section 1 — Rental Bill (We Owe Owner)</h3>' +
                rentalVehBlocks +
                '<div style="text-align:right;font-size:12px;margin-bottom:8px;">Gross Rent: <strong>&#8377;' + fmt(cb.rental.grossRent) + '</strong> &nbsp; Diesel: <strong>&#8377;' + fmt(cb.rental.grossDiesel) + '</strong> &nbsp; <strong style="color:#15803d;">This Week Net: &#8377;' + fmt(cb.weOweOwner) + '</strong></div>' +
                (combinedCarryForward.weeks.length > 0
                    ? '<div style="margin-bottom:16px;border:1.5px solid #c2410c;border-radius:10px;overflow:hidden;">' +
                    '<div style="background:#c2410c;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">' +
                    '<span style="font-weight:800;color:#fff;font-size:13px;">&#x23EA; Carry Forward — Previous Unpaid Rental Bills</span>' +
                    '<span style="font-weight:800;color:#fff;font-size:14px;">&#8377;' + fmt(cf) + '</span>' +
                    '</div>' +
                    '<table><thead><tr><th>Week</th><th>Total Bill (&#8377;)</th><th>Paid (&#8377;)</th><th>Remaining (&#8377;)</th></tr></thead><tbody>' +
                    combinedCarryForward.weeks.map(w =>
                        '<tr><td style="color:#374151;">' + fmtDate(w.weekStart) + ' – ' + fmtDate(w.weekEnd) + '</td>' +
                        '<td style="color:#b45309;font-weight:600;">&#8377;' + fmt(w.totalBill) + '</td>' +
                        '<td style="color:#15803d;font-weight:600;">&#8377;' + fmt(w.amountPaid) + '</td>' +
                        '<td style="color:#c2410c;font-weight:800;">&#8377;' + fmt(w.remaining) + '</td></tr>'
                    ).join('') +
                    '</tbody><tfoot><tr style="background:#0f172a;">' +
                    '<td colspan="3" style="padding:10px 12px;color:#f8fafc;font-weight:700;">Total Carry Forward</td>' +
                    '<td style="padding:10px 12px;color:#fb923c;font-weight:900;font-size:14px;">&#8377;' + fmt(cf) + '</td></tr></tfoot></table>' +
                    '<div style="padding:8px 14px;background:#fff8f0;text-align:right;font-size:12px;">' +
                    'This Week: <strong style="color:#15803d;">&#8377;' + fmt(cb.weOweOwner) + '</strong> &nbsp;+&nbsp; Carry Fwd: <strong style="color:#c2410c;">&#8377;' + fmt(cf) + '</strong> &nbsp;=&nbsp; <strong style="color:#dc2626;">Total Rental Due: &#8377;' + fmt(totalRentalDue) + '</strong>' +
                    '</div></div>'
                    : '') +

                // Section 2: Billing
                '<h3 style="color:#0f172a;font-size:14px;font-weight:800;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;">Section 2 — Billing Purchases (Owner Owes Us)</h3>' +
                (cb.billing
                    ? (cb.billing.carriedBalance > 0 ? '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;">&#x23EA; Carried Forward: <strong>&#8377;' + fmt(cb.billing.carriedBalance) + '</strong></div>' : '') +
                    '<table><thead><tr><th>Date</th><th>Deliveries</th><th>Amount (&#8377;)</th></tr></thead><tbody>' + (billingRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">No deliveries this week</td></tr>') + '</tbody></table>' +
                    '<div style="text-align:right;font-size:12px;margin:8px 0 20px;">Carry Fwd: <strong>&#8377;' + fmt(cb.billing.carriedBalance) + '</strong> &nbsp; This Week: <strong>&#8377;' + fmt(cb.billing.weekTotal) + '</strong> &nbsp; Paid: <strong style="color:#15803d;">&#8377;' + fmt(cb.billing.weekPaid) + '</strong> &nbsp; <strong style="color:#dc2626;">Net Due: &#8377;' + fmt(cb.billing.netDue) + '</strong></div>'
                    : '<p style="color:#64748b;font-style:italic;">No billing customer found for this owner.</p>') +

                // Section 3: Khet
                '<h3 style="color:#0f172a;font-size:14px;font-weight:800;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #0f172a;">Section 3 — Khet Purchases (Owner Owes Us)</h3>' +
                (cb.khet
                    ? (cb.khet.carriedBalance > 0 ? '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;">&#x23EA; Carried Forward: <strong>&#8377;' + fmt(cb.khet.carriedBalance) + '</strong></div>' : '') +
                    '<table><thead><tr><th>Date</th><th>Material</th><th>Billing</th><th>Trips/Qty</th><th>Amount</th><th>Total (&#8377;)</th></tr></thead><tbody>' + khetRows + '</tbody></table>' +
                    '<div style="text-align:right;font-size:12px;margin:8px 0 20px;">Carry Fwd: <strong>&#8377;' + fmt(cb.khet.carriedBalance) + '</strong> &nbsp; This Week: <strong>&#8377;' + fmt(cb.khet.grandTotal) + '</strong> &nbsp; Paid: <strong style="color:#15803d;">&#8377;' + fmt(cb.khet.weekPaid) + '</strong> &nbsp; <strong style="color:#c2410c;">Net Due: &#8377;' + fmt(cb.khet.netDue) + '</strong></div>'
                    : '<p style="color:#64748b;font-style:italic;">No khet orders found for this owner.</p>') +

                // Final settlement — now includes carry forward
                '<div class="total-box">' +
                '<div style="color:#f1f5f9;font-size:14px;font-weight:800;">FINAL SETTLEMENT</div>' +
                '<div style="color:#94a3b8;font-size:12px;">' +
                (cf > 0
                    ? '(Rental &#8377;' + fmt(cb.weOweOwner) + ' + CF &#8377;' + fmt(cf) + ') &minus; Billing &#8377;' + fmt(cb.billing?.netDue || 0) + ' &minus; Khet &#8377;' + fmt(cb.khet?.netDue || 0)
                    : 'Rental &#8377;' + fmt(cb.weOweOwner) + ' &minus; Billing &#8377;' + fmt(cb.billing?.netDue || 0) + ' &minus; Khet &#8377;' + fmt(cb.khet?.netDue || 0)) +
                '</div>' +
                '<div><div style="font-size:11px;color:' + (wePayOwner ? '#4ade80' : '#fb923c') + ';margin-bottom:4px;">' + (wePayOwner ? 'WE PAY OWNER' : ownerPaysUs ? 'OWNER PAYS US' : 'SETTLED') + '</div>' +
                '<div style="font-size:28px;font-weight:900;color:' + (wePayOwner ? '#4ade80' : '#fb923c') + ';">&#8377;' + fmt(finalAbs) + '</div></div>' +
                '</div>' +
                '<div class="sig-row"><div><div class="sig-line">Owner Signature</div></div><div><div class="sig-line">Authorised Signature</div></div></div>';
        }

        const rentalHtml = '<html><head><title>Rental Bill</title><style>' + CSS + '</style></head><body>' + bodyHtml + '</body></html>';

        let iframe = document.getElementById('__print_iframe__');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = '__print_iframe__';
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
            document.body.appendChild(iframe);
        }
        const iDoc = iframe.contentWindow.document;
        iDoc.open(); iDoc.write(rentalHtml); iDoc.close();
        setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">🧾 Rental Bills</h1>
                <div style={{display:'flex',gap:8}}>
                    {(weeklyBill || dailyBill || allWeekly || combinedBill) && (<>
                        <button className="btn btn-primary" onClick={handlePrint}>🖨️ Print Bill</button>
                        <button
                            className="btn"
                            onClick={handleWhatsApp}
                            style={{ background: '#25D366', borderColor: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, padding: '8px 16px', borderRadius: 8 }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                            </svg>
                            WhatsApp
                        </button>
                    </>)}
                    <button className="btn btn-danger" style={{fontSize:12,padding:'6px 12px'}}
                            onClick={handleCleanupOrphanTrips} title="Remove stale trip records with no matching delivery">
                        🧹 Cleanup Orphan Trips
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {['weekly', 'daily', 'summary', 'combined'].map(t => (
                    <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => { setTab(t); setWeeklyBill(null); setDailyBill(null); setAllWeekly(null); setCombinedBill(null); setDailyCarryForward({ weeks: [], total: 0 }); setCombinedCarryForward({ weeks: [], total: 0 }); setSummaryCarryForwards({}); }}>
                        {t === 'weekly' ? '📅 Weekly Bill' : t === 'daily' ? '📆 Daily Bill' : t === 'summary' ? '📊 All Owners Summary' : '🧾 Combined Bill'}
                    </button>
                ))}
            </div>

            {/* Controls */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="form-grid">
                    {(tab === 'weekly' || tab === 'combined') && (
                        <div className="form-group">
                            <label>Rental Owner</label>
                            <select value={selectedOwner} onChange={e => setSelectedOwner(e.target.value)}>
                                <option value="">Select owner...</option>
                                {owners.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </div>
                    )}
                    {tab === 'daily' && (
                        <div className="form-group">
                            <label>Vehicle</label>
                            <select value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}>
                                <option value="">Select vehicle...</option>
                                {vehicles.map(v => <option key={v._id} value={v._id}>{v.vehicleNumber} — {v.rentalOwnerName}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="form-group">
                        <label>{tab === 'daily' ? 'Date' : 'Any date in that week'}</label>
                        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ justifyContent: 'flex-end', paddingTop: 20 }}>
                        <button className="btn btn-primary"
                                onClick={tab === 'weekly' ? loadWeekly : tab === 'daily' ? loadDaily : tab === 'summary' ? loadAllWeekly : loadCombined}
                                disabled={loading}>
                            {loading ? 'Loading...' : 'Generate Bill'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Printable area */}
            <div ref={printRef}>

                {/* Weekly Bill */}
                {tab === 'weekly' && weeklyBill && (
                    <div className="card">
                        <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                                Weekly Rental Bill
                            </div>
                            <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                                Owner: <strong style={{ color: '#eab308' }}>{weeklyBill.ownerName}</strong>
                                &nbsp;·&nbsp; Week: {fmtDate(weeklyBill.weekStart)} to {fmtDate(weeklyBill.weekEnd)}
                            </div>
                        </div>

                        {weeklyBill.vehicles.map((vd, i) => (
                            <div key={i} style={{ marginBottom: 28, border: '1px solid #1e1e1e', borderRadius: 10, overflow: 'hidden' }}>
                                <div style={{ background: '#1a1a1a', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <span style={{ fontWeight: 700, color: '#f0f0f0', fontSize: 15 }}>{vd.vehicle.vehicleNumber}</span>
                                        <span style={{ color: '#666', fontSize: 13, marginLeft: 10 }}>{vd.vehicle.vehicleType}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                                        {/* FIX: vd.totalTrips now uses numberOfTrips sum — consistent with vehicles summary */}
                                        {vd.totalTrips > 0 && <span style={{ color: '#888' }}>Trips: <strong style={{ color: '#fff' }}>{vd.totalTrips}</strong></span>}
                                        {vd.totalQuantity > 0 && <span style={{ color: '#888' }}>Qty: <strong style={{ color: '#a78bfa' }}>{vd.totalQuantity}</strong></span>}
                                        <span style={{ color: '#888' }}>Rent: <strong style={{ color: '#eab308' }}>₹{fmt(vd.totalRent)}</strong></span>
                                        <span style={{ color: '#888' }}>Diesel: <strong style={{ color: '#f87171' }}>₹{fmt(vd.totalDiesel)}</strong></span>
                                        <span style={{ color: '#888' }}>Net: <strong style={{ color: '#4ade80' }}>₹{fmt(vd.netAmount)}</strong></span>
                                    </div>
                                </div>
                                {vd.dailyEntries.length > 0 ? (
                                    <div className="table-wrap">
                                        <table>
                                            <thead>
                                            <tr>
                                                <th>Date</th><th>Trips</th><th>Quantity</th><th>Rent (₹)</th><th>Diesel (₹)</th><th>Net (₹)</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {vd.dailyEntries.map((de, di) => (
                                                <tr key={di}>
                                                    <td style={{ color: '#ccc' }}>{fmtDay(de.date)}</td>
                                                    <td style={{ color: '#888' }}>{de.tripCount > 0 ? de.tripCount : '—'}</td>
                                                    <td style={{ color: '#a78bfa' }}>
                                                        {de.quantity > 0 ? `${de.quantity} ${de.quantityUnit || 'brass'}` : '—'}
                                                    </td>
                                                    <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(de.rent)}</td>
                                                    <td style={{ color: '#f87171' }}>{de.diesel ? `₹${fmt(de.diesel)}` : '—'}</td>
                                                    <td style={{ color: '#4ade80', fontWeight: 600 }}>₹{fmt(de.rent - de.diesel)}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                            <tfoot>
                                            <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                                                <td colSpan={3} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>
                                                    Weekly Total
                                                    {vd.totalTrips > 0 && <span style={{ color: '#fff', marginLeft: 8 }}>({vd.totalTrips} trips)</span>}
                                                    {vd.totalQuantity > 0 && <span style={{ color: '#a78bfa', marginLeft: 8 }}>({vd.totalQuantity} {vd.dailyEntries.find(d => d.quantity > 0)?.quantityUnit || 'brass'})</span>}
                                                </td>
                                                <td style={{ color: '#eab308', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(vd.totalRent)}</td>
                                                <td style={{ color: '#f87171', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(vd.totalDiesel)}</td>
                                                <td style={{ color: '#4ade80', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(vd.netAmount)}</td>
                                            </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ) : (
                                    <div style={{ padding: '16px', color: '#444', fontStyle: 'italic' }}>No rent entries this week</div>
                                )}
                            </div>
                        ))}

                        {/* Carry Forward — Unpaid Previous Weeks */}
                        {carryForward.weeks.length > 0 && (
                            <div style={{ marginBottom: 20, border: '1px solid #7c2d12', borderRadius: 10, overflow: 'hidden', background: '#1a0800' }}>
                                <div style={{ background: '#7c2d12', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 700, color: '#fed7aa', fontSize: 14 }}>
                                        ⏪ Carry Forward — Previous Unpaid Bills
                                    </span>
                                    <span style={{ fontWeight: 700, color: '#fb923c', fontSize: 16 }}>
                                        ₹{fmt(carryForward.total)}
                                    </span>
                                </div>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Week</th>
                                            <th>Total Bill (₹)</th>
                                            <th>Paid (₹)</th>
                                            <th>Remaining (₹)</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {carryForward.weeks.map((w, i) => (
                                            <tr key={i}>
                                                <td style={{ color: '#ccc' }}>{fmtDate(w.weekStart)} – {fmtDate(w.weekEnd)}</td>
                                                <td style={{ color: '#eab308' }}>₹{fmt(w.totalBill)}</td>
                                                <td style={{ color: '#4ade80' }}>₹{fmt(w.amountPaid)}</td>
                                                <td style={{ color: '#fb923c', fontWeight: 700 }}>₹{fmt(w.remaining)}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                        <tfoot>
                                        <tr>
                                            <td colSpan={3} style={{ color: '#888', padding: '10px 16px', fontWeight: 600 }}>Total Carry Forward</td>
                                            <td style={{ color: '#fb923c', fontWeight: 700, padding: '10px 16px', fontSize: 15 }}>₹{fmt(carryForward.total)}</td>
                                        </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Grand Total */}
                        <div style={{ background: '#1a1600', border: '1px solid #2a2400', borderRadius: 10, padding: 20 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: carryForward.total > 0 ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 16 }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 6 }}>Total Rent</div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: '#eab308' }}>₹{fmt(weeklyBill.grandTotal)}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 6 }}>Diesel</div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: '#f87171' }}>₹{fmt(weeklyBill.grandDiesel)}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 6 }}>This Week's Bill</div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>₹{fmt(weeklyBill.grandNet)}</div>
                                </div>
                                {carryForward.total > 0 && (
                                    <div style={{ textAlign: 'center', background: 'rgba(124,45,18,0.3)', borderRadius: 8, padding: '8px 4px', border: '1px solid #7c2d12' }}>
                                        <div style={{ fontSize: 11, color: '#fb923c', textTransform: 'uppercase', marginBottom: 6 }}>⏪ Carry Forward</div>
                                        <div style={{ fontSize: 22, fontWeight: 700, color: '#fb923c' }}>₹{fmt(carryForward.total)}</div>
                                        <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{carryForward.weeks.length} unpaid week{carryForward.weeks.length !== 1 ? 's' : ''}</div>
                                    </div>
                                )}
                                <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 4px' }}>
                                    <div style={{ fontSize: 11, color: rentalPayment?.isPaid ? '#4ade80' : '#eab308', textTransform: 'uppercase', marginBottom: 6 }}>
                                        {rentalPayment?.isPaid ? '✅ Net to Pay' : rentalPayment?.isPartial ? '⚠️ Net to Pay' : 'Total Due'}
                                    </div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: rentalPayment?.isPaid ? '#4ade80' : '#f87171' }}>
                                        ₹{fmt(rentalPayment?.isPaid ? 0 : rentalPayment?.isPartial
                                        ? (weeklyBill.grandNet + (carryForward.total || 0)) - (rentalPayment.amountPaid || 0)
                                        : weeklyBill.grandNet + (carryForward.total || 0))}
                                    </div>
                                    {rentalPayment?.isPartial && (
                                        <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>Paid: ₹{fmt(rentalPayment.amountPaid)}</div>
                                    )}
                                    {carryForward.total > 0 && !rentalPayment?.isPaid && (
                                        <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                                            Week ₹{fmt(weeklyBill.grandNet)} + CF ₹{fmt(carryForward.total)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Signature */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, paddingTop: 16 }}>
                            <div style={{ textAlign: 'center', width: 180 }}>
                                <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Owner Signature</div>
                            </div>
                            <div style={{ textAlign: 'center', width: 180 }}>
                                <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Authorised Signature</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Daily Bill */}
                {tab === 'daily' && dailyBill && (
                    <div className="card">
                        <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                                Daily Rental Bill
                            </div>
                            <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                                Vehicle: <strong style={{ color: '#eab308' }}>{dailyBill.vehicle.vehicleNumber}</strong>
                                &nbsp;·&nbsp; Owner: <strong style={{ color: '#fff' }}>{dailyBill.vehicle.rentalOwnerName || '—'}</strong>
                                &nbsp;·&nbsp; Date: <strong style={{ color: '#fff' }}>{fmtDate(dailyBill.date)}</strong>
                            </div>
                        </div>

                        {dailyBill.trips.length === 0 ? (
                            <div style={{ color: '#555', textAlign: 'center', padding: 32 }}>No trips on this date</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Source</th><th>Destination</th><th>Billing Type</th>
                                            <th>Trips / Qty</th><th>Rate (₹)</th><th>Rent (₹)</th><th>Diesel (₹)</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {dailyBill.trips.map((t, i) => (
                                            <tr key={i}>
                                                <td style={{ color: '#ccc' }}>{t.source || '—'}</td>
                                                <td style={{ color: '#ccc' }}>{t.destination || '—'}</td>
                                                <td style={{ color: t.billingType === 'Quantity' ? '#a78bfa' : '#60a5fa', fontWeight: 600 }}>
                                                    {t.billingType === 'Quantity' ? `Qty (${t.quantityUnit || 'brass'})` : 'Trip'}
                                                </td>
                                                <td style={{ color: '#fff', fontWeight: 600 }}>
                                                    {t.billingType === 'Quantity' ? `${t.quantity || 0} ${t.quantityUnit || 'brass'}` : (t.numberOfTrips || 1)}
                                                </td>
                                                <td style={{ color: '#888' }}>₹{fmt(t.rentalAmount)}</td>
                                                <td style={{ color: '#eab308', fontWeight: 600 }}>
                                                    ₹{fmt(t.billingType === 'Quantity' ? (t.rentalAmount || 0) * (t.quantity || 0) : (t.rentalAmount || 0) * (t.numberOfTrips || 1))}
                                                </td>
                                                <td style={{ color: '#f87171' }}>{t.dieselAmount ? `₹${fmt(t.dieselAmount)}` : '—'}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                                    <div style={{ background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 10, padding: 24, textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>Rent Amount</div>
                                        <div style={{ fontSize: 32, fontWeight: 700, color: '#eab308', fontFamily: 'Syne, sans-serif' }}>₹{fmt(dailyBill.totalRent)}</div>
                                    </div>
                                    <div style={{ background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 10, padding: 24, textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>Diesel Deducted</div>
                                        <div style={{ fontSize: 32, fontWeight: 700, color: '#f87171', fontFamily: 'Syne, sans-serif' }}>₹{fmt(dailyBill.totalDiesel)}</div>
                                    </div>
                                    <div style={{ background: '#1a1600', border: '1px solid #2a2400', borderRadius: 10, padding: 24, textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>Net Payable</div>
                                        <div style={{ fontSize: 32, fontWeight: 700, color: '#4ade80', fontFamily: 'Syne, sans-serif' }}>₹{fmt(dailyBill.netAmount)}</div>
                                    </div>
                                </div>

                                <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                    {dailyBill.totalTrips > 0 && (
                                        <span style={{ fontSize: 13, color: '#ccc' }}>
                            🚛 Total Trips: <strong style={{ color: '#fff' }}>{dailyBill.totalTrips}</strong>
                          </span>
                                    )}
                                    {dailyBill.totalQuantity > 0 && (
                                        <span style={{ fontSize: 13, color: '#ccc' }}>
                            📦 Total Quantity: <strong style={{ color: '#a78bfa' }}>{dailyBill.totalQuantity} {dailyBill.quantityUnit}</strong>
                          </span>
                                    )}
                                </div>

                                {/* Carry Forward — Daily */}
                                {dailyCarryForward.weeks.length > 0 && (
                                    <div style={{ border: '1px solid #7c2d12', borderRadius: 10, overflow: 'hidden', background: '#1a0800' }}>
                                        <div style={{ background: '#7c2d12', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700, color: '#fed7aa', fontSize: 14 }}>⏪ Carry Forward — Previous Unpaid Bills ({dailyBill.vehicle.rentalOwnerName})</span>
                                            <span style={{ fontWeight: 700, color: '#fb923c', fontSize: 16 }}>₹{fmt(dailyCarryForward.total)}</span>
                                        </div>
                                        <div className="table-wrap">
                                            <table>
                                                <thead><tr><th>Week</th><th>Total Bill (₹)</th><th>Paid (₹)</th><th>Remaining (₹)</th></tr></thead>
                                                <tbody>
                                                {dailyCarryForward.weeks.map((w, i) => (
                                                    <tr key={i}>
                                                        <td style={{ color: '#ccc' }}>{fmtDate(w.weekStart)} – {fmtDate(w.weekEnd)}</td>
                                                        <td style={{ color: '#eab308' }}>₹{fmt(w.totalBill)}</td>
                                                        <td style={{ color: '#4ade80' }}>₹{fmt(w.amountPaid)}</td>
                                                        <td style={{ color: '#fb923c', fontWeight: 700 }}>₹{fmt(w.remaining)}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                                <tfoot>
                                                <tr>
                                                    <td colSpan={3} style={{ color: '#888', padding: '10px 16px', fontWeight: 600 }}>Total Carry Forward</td>
                                                    <td style={{ color: '#fb923c', fontWeight: 700, padding: '10px 16px', fontSize: 15 }}>₹{fmt(dailyCarryForward.total)}</td>
                                                </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                {dailyCarryForward.total > 0 && (
                                    <div style={{ background: '#1a1600', border: '1px solid #2a2400', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: '#888' }}>Today's Bill: <strong style={{ color: '#4ade80' }}>₹{fmt(dailyBill.netAmount)}</strong></span>
                                        <span style={{ fontSize: 13, color: '#888' }}>⏪ Carry Forward: <strong style={{ color: '#fb923c' }}>₹{fmt(dailyCarryForward.total)}</strong></span>
                                        <span style={{ fontSize: 15, fontWeight: 700, color: '#f87171' }}>Total Due: ₹{fmt(dailyBill.netAmount + dailyCarryForward.total)}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, paddingTop: 16 }}>
                            <div style={{ textAlign: 'center', width: 180 }}>
                                <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Driver Signature</div>
                            </div>
                            <div style={{ textAlign: 'center', width: 180 }}>
                                <div style={{ borderTop: '1px solid #444', paddingTop: 8, fontSize: 12, color: '#666' }}>Authorised Signature</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Combined Bill */}
                {tab === 'combined' && combinedBill && (() => {
                    const cb = combinedBill;
                    const cf = combinedCarryForward.total || 0;
                    // Adjusted rental total = this week + carry forward unpaid
                    const totalRentalDue = cb.weOweOwner + cf;
                    // Recompute final settlement including carry forward
                    const adjustedSettlement = totalRentalDue - cb.ownerOwesUs;
                    const finalAbs = Math.abs(adjustedSettlement);
                    const wePayOwner = adjustedSettlement > 0;
                    const ownerPaysUs = adjustedSettlement < 0;
                    const settled = adjustedSettlement === 0;
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                            {/* Header */}
                            <div className="card">
                                <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                                        🧾 Combined Weekly Bill
                                    </div>
                                    <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                                        Owner: <strong style={{ color: '#eab308' }}>{cb.ownerName}</strong>
                                        &nbsp;·&nbsp; Week: {fmtDate(cb.weekStart)} to {fmtDate(cb.weekEnd)}
                                    </div>
                                </div>

                                {/* Settlement Summary chips */}
                                <div style={{ display: 'grid', gridTemplateColumns: cf > 0 ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                                    <div style={{ background: '#0a1a0a', border: '1px solid #14532d', borderRadius: 10, padding: 20, textAlign: 'center' }}>
                                        <div style={{ fontSize: 11, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                                            🚛 Rental — This Week
                                        </div>
                                        <div style={{ fontSize: 26, fontWeight: 700, color: '#4ade80' }}>₹{fmt(cb.weOweOwner)}</div>
                                        <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>We owe owner</div>
                                    </div>
                                    {cf > 0 && (
                                        <div style={{ background: '#1a0800', border: '1px solid #7c2d12', borderRadius: 10, padding: 20, textAlign: 'center' }}>
                                            <div style={{ fontSize: 11, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                                                ⏪ Carry Forward
                                            </div>
                                            <div style={{ fontSize: 26, fontWeight: 700, color: '#fb923c' }}>₹{fmt(cf)}</div>
                                            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{combinedCarryForward.weeks.length} unpaid week{combinedCarryForward.weeks.length !== 1 ? 's' : ''}</div>
                                        </div>
                                    )}
                                    <div style={{ background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 10, padding: 20, textAlign: 'center' }}>
                                        <div style={{ fontSize: 11, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                                            🛒 Owner Owes Us
                                        </div>
                                        <div style={{ fontSize: 26, fontWeight: 700, color: '#f87171' }}>₹{fmt(cb.ownerOwesUs)}</div>
                                        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                                            Billing: ₹{fmt(cb.billing?.netDue || 0)} &nbsp;+&nbsp; Khet: ₹{fmt(cb.khet?.netDue || 0)}
                                        </div>
                                    </div>
                                    <div style={{
                                        background: settled ? '#0f0f0f' : wePayOwner ? '#0a1a0a' : '#1a0500',
                                        border: `1px solid ${settled ? '#333' : wePayOwner ? '#14532d' : '#7c2d12'}`,
                                        borderRadius: 10, padding: 20, textAlign: 'center'
                                    }}>
                                        <div style={{ fontSize: 11, color: settled ? '#888' : wePayOwner ? '#4ade80' : '#fb923c', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                                            {settled ? '✅ Settled' : wePayOwner ? '💸 Net — We Pay Owner' : '💰 Net — Owner Pays Us'}
                                        </div>
                                        <div style={{ fontSize: 26, fontWeight: 700, color: settled ? '#fff' : wePayOwner ? '#4ade80' : '#fb923c' }}>
                                            ₹{fmt(finalAbs)}
                                        </div>
                                        {!settled && (
                                            <div style={{ fontSize: 11, marginTop: 4, color: wePayOwner ? '#4ade80' : '#fb923c' }}>
                                                {wePayOwner ? `Pay ₹${fmt(finalAbs)} to ${cb.ownerName}` : `${cb.ownerName} pays ₹${fmt(finalAbs)}`}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── SECTION 1: RENTAL BILL ── */}
                            <div className="card">
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🚛 Section 1 — Rental Bill (We Owe Owner)</span>
                                    <span style={{ fontSize: 20, fontWeight: 700 }}>₹{fmt(cb.weOweOwner)}</span>
                                </div>
                                {cb.rental.vehicles.length === 0 ? (
                                    <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>No rental vehicles this week</div>
                                ) : cb.rental.vehicles.map((vd, i) => (
                                    <div key={i} style={{ marginBottom: 16, border: '1px solid #1e1e1e', borderRadius: 8, overflow: 'hidden' }}>
                                        <div style={{ background: '#1a1a1a', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700, color: '#f0f0f0' }}>{vd.vehicle.vehicleNumber}</span>
                                            <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                                                {vd.totalTrips > 0 && <span style={{ color: '#888' }}>Trips: <strong style={{ color: '#fff' }}>{vd.totalTrips}</strong></span>}
                                                {vd.totalQuantity > 0 && <span style={{ color: '#888' }}>Qty: <strong style={{ color: '#a78bfa' }}>{vd.totalQuantity}</strong></span>}
                                                <span style={{ color: '#888' }}>Rent: <strong style={{ color: '#eab308' }}>₹{fmt(vd.totalRent)}</strong></span>
                                                <span style={{ color: '#888' }}>Diesel: <strong style={{ color: '#f87171' }}>₹{fmt(vd.totalDiesel)}</strong></span>
                                                <span style={{ color: '#888' }}>Net: <strong style={{ color: '#4ade80' }}>₹{fmt(vd.netAmount)}</strong></span>
                                            </div>
                                        </div>
                                        {vd.dailyEntries.length > 0 && (
                                            <div className="table-wrap">
                                                <table>
                                                    <thead><tr><th>Date</th><th>Trips</th><th>Quantity</th><th>Rent (₹)</th><th>Diesel (₹)</th><th>Net (₹)</th></tr></thead>
                                                    <tbody>
                                                    {vd.dailyEntries.map((de, di) => (
                                                        <tr key={di}>
                                                            <td style={{ color: '#ccc' }}>{fmtDay(de.date)}</td>
                                                            <td style={{ color: '#888' }}>{de.tripCount > 0 ? de.tripCount : '—'}</td>
                                                            <td style={{ color: '#a78bfa' }}>{de.quantity > 0 ? `${de.quantity} ${de.quantityUnit}` : '—'}</td>
                                                            <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(de.rent)}</td>
                                                            <td style={{ color: '#f87171' }}>{de.diesel ? `₹${fmt(de.diesel)}` : '—'}</td>
                                                            <td style={{ color: '#4ade80', fontWeight: 600 }}>₹{fmt(de.rent - de.diesel)}</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 4px', borderTop: '1px solid #2a2a2a', marginTop: 8, fontSize: 13 }}>
                                    <span style={{ color: '#888' }}>Gross Rent: <strong style={{ color: '#eab308' }}>₹{fmt(cb.rental.grossRent)}</strong></span>
                                    <span style={{ color: '#888' }}>Diesel: <strong style={{ color: '#f87171' }}>₹{fmt(cb.rental.grossDiesel)}</strong></span>
                                    <span style={{ color: '#888' }}>Net Payable: <strong style={{ color: '#4ade80', fontSize: 16 }}>₹{fmt(cb.weOweOwner)}</strong></span>
                                </div>

                                {/* Combined Carry Forward */}
                                {combinedCarryForward.weeks.length > 0 && (
                                    <div style={{ marginTop: 16, border: '1px solid #7c2d12', borderRadius: 10, overflow: 'hidden', background: '#1a0800' }}>
                                        <div style={{ background: '#7c2d12', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 700, color: '#fed7aa', fontSize: 14 }}>⏪ Carry Forward — Previous Unpaid Rental Bills</span>
                                            <span style={{ fontWeight: 700, color: '#fb923c', fontSize: 16 }}>₹{fmt(combinedCarryForward.total)}</span>
                                        </div>
                                        <div className="table-wrap">
                                            <table>
                                                <thead><tr><th>Week</th><th>Total Bill (₹)</th><th>Paid (₹)</th><th>Remaining (₹)</th></tr></thead>
                                                <tbody>
                                                {combinedCarryForward.weeks.map((w, i) => (
                                                    <tr key={i}>
                                                        <td style={{ color: '#ccc' }}>{fmtDate(w.weekStart)} – {fmtDate(w.weekEnd)}</td>
                                                        <td style={{ color: '#eab308' }}>₹{fmt(w.totalBill)}</td>
                                                        <td style={{ color: '#4ade80' }}>₹{fmt(w.amountPaid)}</td>
                                                        <td style={{ color: '#fb923c', fontWeight: 700 }}>₹{fmt(w.remaining)}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                                <tfoot>
                                                <tr>
                                                    <td colSpan={3} style={{ color: '#888', padding: '10px 16px', fontWeight: 600 }}>Total Carry Forward</td>
                                                    <td style={{ color: '#fb923c', fontWeight: 700, padding: '10px 16px', fontSize: 15 }}>₹{fmt(combinedCarryForward.total)}</td>
                                                </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                        <div style={{ padding: '10px 16px', background: '#0f0800', display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 13 }}>
                                            <span style={{ color: '#888' }}>This Week: <strong style={{ color: '#4ade80' }}>₹{fmt(cb.weOweOwner)}</strong></span>
                                            <span style={{ color: '#888' }}>Carry Fwd: <strong style={{ color: '#fb923c' }}>₹{fmt(combinedCarryForward.total)}</strong></span>
                                            <span style={{ fontWeight: 700, color: '#f87171', fontSize: 15 }}>Total Rental Due: ₹{fmt(cb.weOweOwner + combinedCarryForward.total)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ── SECTION 2: BILLING PURCHASES ── */}
                            <div className="card">
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🛒 Section 2 — Billing Purchases (Owner Owes Us)</span>
                                    <span style={{ fontSize: 20, fontWeight: 700 }}>₹{fmt(cb.billing?.netDue || 0)}</span>
                                </div>
                                {!cb.billing ? (
                                    <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>
                                        No billing customer found matching <strong style={{ color: '#888' }}>{cb.ownerName}</strong>
                                    </div>
                                ) : cb.billing.netDue === 0 && cb.billing.weekTotal === 0 && cb.billing.carriedBalance === 0 ? (
                                    <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>
                                        No billing deliveries or outstanding balance for <strong style={{ color: '#888' }}>{cb.ownerName}</strong> this week
                                    </div>
                                ) : (
                                    <>
                                        {cb.billing.carriedBalance > 0 && (
                                            <div style={{ background: '#1a0e00', border: '1px solid #2a1800', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#eab308' }}>
                                                ⏪ Carried Forward from previous weeks: <strong>₹{fmt(cb.billing.carriedBalance)}</strong>
                                            </div>
                                        )}
                                        {cb.billing.dailyGroups.length === 0 ? (
                                            <div style={{ color: '#555', textAlign: 'center', padding: 16 }}>No billing deliveries this week</div>
                                        ) : (
                                            <div className="table-wrap">
                                                <table>
                                                    <thead><tr><th>Date</th><th>Deliveries</th><th>Amount (₹)</th></tr></thead>
                                                    <tbody>
                                                    {cb.billing.dailyGroups.map((dg, i) => (
                                                        <tr key={i}>
                                                            <td style={{ color: '#ccc' }}>{fmtDay(dg.date)}</td>
                                                            <td style={{ color: '#888' }}>{dg.deliveries.length}</td>
                                                            <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(dg.total)}</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                    <tfoot>
                                                    <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                                                        <td colSpan={2} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>This Week Total</td>
                                                        <td style={{ color: '#eab308', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(cb.billing.weekTotal)}</td>
                                                    </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 4px', borderTop: '1px solid #2a2a2a', marginTop: 8, fontSize: 13 }}>
                                            <span style={{ color: '#888' }}>Carry Fwd: <strong style={{ color: '#eab308' }}>₹{fmt(cb.billing.carriedBalance)}</strong></span>
                                            <span style={{ color: '#888' }}>This Week: <strong style={{ color: '#eab308' }}>₹{fmt(cb.billing.weekTotal)}</strong></span>
                                            <span style={{ color: '#888' }}>Paid: <strong style={{ color: '#4ade80' }}>₹{fmt(cb.billing.weekPaid)}</strong></span>
                                            <span style={{ color: '#888' }}>Net Due: <strong style={{ color: '#f87171', fontSize: 16 }}>₹{fmt(cb.billing.netDue)}</strong></span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ── SECTION 3: KHET PURCHASES ── */}
                            <div className="card">
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#fb923c', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🌾 Section 3 — Khet Purchases (Owner Owes Us)</span>
                                    <span style={{ fontSize: 20, fontWeight: 700 }}>₹{fmt(cb.khet?.netDue || 0)}</span>
                                </div>
                                {!cb.khet ? (
                                    <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>
                                        No khet orders or outstanding balance for <strong style={{ color: '#888' }}>{cb.ownerName}</strong> this week
                                    </div>
                                ) : cb.khet.netDue === 0 && cb.khet.weekTotal === 0 && cb.khet.carriedBalance === 0 ? (
                                    <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>
                                        No khet orders or outstanding balance for <strong style={{ color: '#888' }}>{cb.ownerName}</strong> this week
                                    </div>
                                ) : (
                                    <>
                                        {cb.khet.carriedBalance > 0 && (
                                            <div style={{ background: '#1a0e00', border: '1px solid #2a1800', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#eab308' }}>
                                                ⏪ Carried Forward from previous weeks: <strong>₹{fmt(cb.khet.carriedBalance)}</strong>
                                            </div>
                                        )}
                                        <div className="table-wrap">
                                            <table>
                                                <thead><tr><th>Date</th><th>Material</th><th>Billing</th><th>Trips/Qty</th><th>Amount (₹)</th>{cb.khet.royalty > 0 && <th>Royalty (₹)</th>}<th>Total (₹)</th></tr></thead>
                                                <tbody>
                                                {cb.khet.orders.map((o, i) => (
                                                    <tr key={i}>
                                                        <td style={{ color: '#ccc' }}>{fmtDay(o.date)}</td>
                                                        <td style={{ color: '#aaa' }}>{o.material || '—'}</td>
                                                        <td style={{ color: o.billingType === 'Quantity' ? '#a78bfa' : '#60a5fa', fontWeight: 600 }}>{o.billingType}</td>
                                                        <td style={{ color: '#fff' }}>
                                                            {o.billingType === 'Quantity'
                                                                ? `${o.vehicles.reduce((s, v) => s + (v.quantity || 0), 0)} ${o.quantityUnit}`
                                                                : o.vehicles.reduce((s, v) => s + (v.numberOfTrips || 0), 0)}
                                                        </td>
                                                        <td style={{ color: '#eab308', fontWeight: 600 }}>₹{fmt(o.totalAmount)}</td>
                                                        {cb.khet.royalty > 0 && <td style={{ color: '#fb923c' }}>{o.totalRoyalty ? `₹${fmt(o.totalRoyalty)}` : '—'}</td>}
                                                        <td style={{ color: '#fb923c', fontWeight: 600 }}>₹{fmt(o.grandTotal || o.totalAmount)}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                                <tfoot>
                                                <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                                                    <td colSpan={4} style={{ color: '#666', padding: '10px 16px', fontWeight: 600 }}>This Week Total</td>
                                                    <td style={{ color: '#eab308', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(cb.khet.weekTotal)}</td>
                                                    {cb.khet.royalty > 0 && <td style={{ color: '#fb923c', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(cb.khet.royalty)}</td>}
                                                    <td style={{ color: '#fb923c', fontWeight: 700, padding: '10px 16px' }}>₹{fmt(cb.khet.grandTotal)}</td>
                                                </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 4px', borderTop: '1px solid #2a2a2a', marginTop: 8, fontSize: 13 }}>
                                            <span style={{ color: '#888' }}>Carry Fwd: <strong style={{ color: '#eab308' }}>₹{fmt(cb.khet.carriedBalance)}</strong></span>
                                            <span style={{ color: '#888' }}>This Week: <strong style={{ color: '#eab308' }}>₹{fmt(cb.khet.grandTotal)}</strong></span>
                                            <span style={{ color: '#888' }}>Paid: <strong style={{ color: '#4ade80' }}>₹{fmt(cb.khet.weekPaid)}</strong></span>
                                            <span style={{ color: '#888' }}>Net Due: <strong style={{ color: '#fb923c', fontSize: 16 }}>₹{fmt(cb.khet.netDue)}</strong></span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ── FINAL SETTLEMENT BOX ── */}
                            <div style={{
                                background: wePayOwner ? '#0a1a0a' : ownerPaysUs ? '#1a0500' : '#111',
                                border: `2px solid ${wePayOwner ? '#16a34a' : ownerPaysUs ? '#c2410c' : '#333'}`,
                                borderRadius: 12, padding: 24
                            }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 20 }}>
                                    📊 Final Settlement — {cb.ownerName} — Week {fmtDate(cb.weekStart)} to {fmtDate(cb.weekEnd)}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: cf > 0 ? '1fr auto 1fr auto 1fr auto 1fr auto 1fr' : '1fr auto 1fr auto 1fr auto 1fr', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                                    <div style={{ textAlign: 'center', background: '#0f1f0f', border: '1px solid #14532d', borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 11, color: '#4ade80', textTransform: 'uppercase', marginBottom: 6 }}>Rental Bill</div>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>₹{fmt(cb.weOweOwner)}</div>
                                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>This week</div>
                                    </div>
                                    {cf > 0 && <>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#555' }}>+</div>
                                        <div style={{ textAlign: 'center', background: '#1a0800', border: '1px solid #7c2d12', borderRadius: 8, padding: 16 }}>
                                            <div style={{ fontSize: 11, color: '#fb923c', textTransform: 'uppercase', marginBottom: 6 }}>⏪ Carry Fwd</div>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#fb923c' }}>₹{fmt(cf)}</div>
                                            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{combinedCarryForward.weeks.length} wk{combinedCarryForward.weeks.length !== 1 ? 's' : ''} unpaid</div>
                                        </div>
                                    </>}
                                    <div style={{ fontSize: 20, fontWeight: 700, color: '#555' }}>−</div>
                                    <div style={{ textAlign: 'center', background: '#1f0f0f', border: '1px solid #7f1d1d', borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 11, color: '#f87171', textTransform: 'uppercase', marginBottom: 6 }}>Billing Bill</div>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171' }}>₹{fmt(cb.billing?.netDue || 0)}</div>
                                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Owner owes us</div>
                                    </div>
                                    <div style={{ fontSize: 20, fontWeight: 700, color: '#555' }}>−</div>
                                    <div style={{ textAlign: 'center', background: '#1f0e00', border: '1px solid #7c2d12', borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 11, color: '#fb923c', textTransform: 'uppercase', marginBottom: 6 }}>Khet Bill</div>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#fb923c' }}>₹{fmt(cb.khet?.netDue || 0)}</div>
                                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Owner owes us</div>
                                    </div>
                                    <div style={{ fontSize: 20, fontWeight: 700, color: '#555' }}>=</div>
                                    <div style={{ textAlign: 'center', background: wePayOwner ? '#0a2a0a' : ownerPaysUs ? '#2a0a00' : '#111', border: `2px solid ${wePayOwner ? '#16a34a' : ownerPaysUs ? '#c2410c' : '#333'}`, borderRadius: 8, padding: 16 }}>
                                        <div style={{ fontSize: 11, color: wePayOwner ? '#4ade80' : ownerPaysUs ? '#fb923c' : '#888', textTransform: 'uppercase', marginBottom: 6 }}>
                                            {settled ? 'Settled' : wePayOwner ? 'We Pay Owner' : 'Owner Pays Us'}
                                        </div>
                                        <div style={{ fontSize: 28, fontWeight: 700, color: wePayOwner ? '#4ade80' : ownerPaysUs ? '#fb923c' : '#fff' }}>
                                            ₹{fmt(finalAbs)}
                                        </div>
                                    </div>
                                </div>
                                {cf > 0 && (
                                    <div style={{ background: 'rgba(124,45,18,0.2)', border: '1px solid #7c2d12', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: '#ccc', textAlign: 'center' }}>
                                        (₹{fmt(cb.weOweOwner)} this week + ₹{fmt(cf)} carry fwd) − ₹{fmt(cb.billing?.netDue || 0)} billing − ₹{fmt(cb.khet?.netDue || 0)} khet = <strong style={{ color: wePayOwner ? '#4ade80' : ownerPaysUs ? '#fb923c' : '#fff', fontSize: 14 }}>₹{fmt(finalAbs)}</strong>
                                    </div>
                                )}
                                {!settled && (
                                    <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: wePayOwner ? '#4ade80' : '#fb923c', background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '12px 20px' }}>
                                        {wePayOwner
                                            ? `✅ After offsetting purchases, we pay ₹${fmt(finalAbs)} to ${cb.ownerName}`
                                            : `💰 After offsetting rental bill, ${cb.ownerName} owes us ₹${fmt(finalAbs)}`}
                                    </div>
                                )}
                                {settled && (
                                    <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#4ade80', background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '12px 20px' }}>
                                        ✅ All amounts cancel out — no payment required either way
                                    </div>
                                )}
                            </div>

                        </div>
                    );
                })()}


                {tab === 'summary' && allWeekly && (
                    <div className="card">
                        <div style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: 16, marginBottom: 20 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', fontFamily: 'Syne, sans-serif' }}>
                                Weekly Summary — All Owners
                            </div>
                            <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
                                Week: {fmtDate(allWeekly.weekStart)} to {fmtDate(allWeekly.weekEnd)}
                            </div>
                        </div>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                <tr>
                                    <th>Owner Name</th><th>Vehicles</th><th>Total Trips</th>
                                    <th>Total Rent</th><th>Diesel</th><th>Net Payable</th>
                                    <th>⏪ Carry Fwd</th><th>Total Due</th>
                                </tr>
                                </thead>
                                <tbody>
                                {allWeekly.summary.length === 0 && (
                                    <tr><td colSpan={8} style={{ textAlign: 'center', color: '#444', padding: 24 }}>No rental data for this week</td></tr>
                                )}
                                {allWeekly.summary.map((s, i) => {
                                    const cf = summaryCarryForwards[s.ownerName] || 0;
                                    return (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600, color: '#f0f0f0' }}>{s.ownerName}</td>
                                            <td style={{ color: '#888' }}>{s.vehicleCount}</td>
                                            <td style={{ color: '#fff' }}>{s.totalTrips}</td>
                                            <td style={{ color: '#eab308' }}>₹{fmt(s.totalRent)}</td>
                                            <td style={{ color: '#f87171' }}>₹{fmt(s.totalDiesel)}</td>
                                            <td style={{ color: '#4ade80', fontWeight: 700 }}>₹{fmt(s.netAmount)}</td>
                                            <td style={{ color: cf > 0 ? '#fb923c' : '#444', fontWeight: cf > 0 ? 700 : 400 }}>{cf > 0 ? `₹${fmt(cf)}` : '—'}</td>
                                            <td style={{ color: '#f87171', fontWeight: 700 }}>₹{fmt(s.netAmount + cf)}</td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                                {allWeekly.summary.length > 0 && (
                                    <tfoot>
                                    <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                                        <td colSpan={2} style={{ color: '#666', padding: '12px 16px', fontWeight: 600 }}>Grand Total</td>
                                        <td style={{ color: '#fff', fontWeight: 700, padding: '12px 16px' }}>
                                            {allWeekly.summary.reduce((s, o) => s + o.totalTrips, 0)}
                                        </td>
                                        <td style={{ color: '#eab308', fontWeight: 700, padding: '12px 16px' }}>
                                            ₹{fmt(allWeekly.summary.reduce((s, o) => s + o.totalRent, 0))}
                                        </td>
                                        <td style={{ color: '#f87171', fontWeight: 700, padding: '12px 16px' }}>
                                            ₹{fmt(allWeekly.summary.reduce((s, o) => s + o.totalDiesel, 0))}
                                        </td>
                                        <td style={{ color: '#4ade80', fontWeight: 700, padding: '12px 16px' }}>
                                            ₹{fmt(allWeekly.summary.reduce((s, o) => s + o.netAmount, 0))}
                                        </td>
                                        <td style={{ color: '#fb923c', fontWeight: 700, padding: '12px 16px' }}>
                                            ₹{fmt(allWeekly.summary.reduce((s, o) => s + (summaryCarryForwards[o.ownerName] || 0), 0))}
                                        </td>
                                        <td style={{ color: '#f87171', fontWeight: 700, padding: '12px 16px', fontSize: 15 }}>
                                            ₹{fmt(allWeekly.summary.reduce((s, o) => s + o.netAmount + (summaryCarryForwards[o.ownerName] || 0), 0))}
                                        </td>
                                    </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Payment Controls — outside printRef so they don't print */}
            {tab === 'weekly' && weeklyBill && (
                <div className="card" style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ccc', marginBottom: 12 }}>
                        💳 Update Payment Status — {weeklyBill.ownerName}
                    </div>
                    <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                        {rentalPayment?.isPaid
                            ? <span style={{ color: '#4ade80' }}>✅ Fully Paid ₹{fmt(rentalPayment.amountPaid)}</span>
                            : rentalPayment?.isPartial
                                ? <span style={{ color: '#eab308' }}>⚠️ Partial ₹{fmt(rentalPayment.amountPaid)} paid — ₹{fmt((weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment.amountPaid||0))} remaining{carryForward.total > 0 ? ` (incl. ₹${fmt(carryForward.total)} carry fwd)` : ''}</span>
                                : <span style={{ color: '#f87171' }}>❌ Not paid yet — ₹{fmt(weeklyBill.grandNet + (carryForward.total||0))} due{carryForward.total > 0 ? ` (incl. ₹${fmt(carryForward.total)} carry fwd from ${carryForward.weeks.length} week${carryForward.weeks.length!==1?'s':''})` : ''}</span>}
                    </div>

                    {/* Payment form */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input type="checkbox" checked={rentalPayForm.isPaid}
                                   onChange={e => setRentalPayForm({ ...rentalPayForm, isPaid: e.target.checked, isPartial: false, amountPaid: '' })}
                                   style={{ width: 16, height: 16, cursor: 'pointer' }}/>
                            <label style={{ fontSize: 13, color: '#ccc', cursor: 'pointer' }}>Fully Paid</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input type="checkbox" checked={rentalPayForm.isPartial}
                                   onChange={e => setRentalPayForm({ ...rentalPayForm, isPartial: e.target.checked, isPaid: false })}
                                   style={{ width: 16, height: 16, cursor: 'pointer' }}/>
                            <label style={{ fontSize: 13, color: '#ccc', cursor: 'pointer' }}>Partial Payment</label>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: 12, color: '#888' }}>Payment Date</label>
                            <input type="date" value={rentalPayForm.paymentDate}
                                   onChange={e => setRentalPayForm({ ...rentalPayForm, paymentDate: e.target.value })}
                                   style={{ padding: '6px 10px', fontSize: 13 }}/>
                        </div>
                    </div>
                    {rentalPayForm.isPartial && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Amount Now (₹) <span style={{ color: '#555', fontWeight: 400 }}>
                  max ₹{fmt((weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment?.amountPaid||0))}
                </span></label>
                                <input type="number" placeholder="0" value={rentalPayForm.amountPaid}
                                       onChange={e => setRentalPayForm({ ...rentalPayForm, amountPaid: Math.min(Number(e.target.value)||0, (weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment?.amountPaid||0)) })}/>
                                {rentalPayForm.amountPaid > 0 && (
                                    <div style={{ fontSize: 12, color: '#eab308', marginTop: 4 }}>
                                        Remaining after this: ₹{fmt((weeklyBill.grandNet + (carryForward.total||0)) - (rentalPayment?.amountPaid||0) - (Number(rentalPayForm.amountPaid)||0))}
                                    </div>
                                )}
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Note</label>
                                <input placeholder="e.g. Half payment" value={rentalPayForm.note}
                                       onChange={e => setRentalPayForm({ ...rentalPayForm, note: e.target.value })}/>
                            </div>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
                        <button className="btn btn-primary" style={{ padding: '10px 24px' }}
                                onClick={handleRentalPayment} disabled={savingPay}>
                            {savingPay ? 'Saving...' : 'Save Payment Status'}
                        </button>
                    </div>

                    {/* Payment History */}
                    {paymentHistory.length > 0 && (
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 10, borderTop: '1px solid #1e1e1e', paddingTop: 16 }}>
                                📋 Payment History — {weeklyBill.ownerName}
                            </div>
                            <div className="table-wrap">
                                <table>
                                    <thead>
                                    <tr>
                                        <th>Week</th>
                                        <th>Payment Date</th>
                                        <th>Total Bill</th>
                                        <th>Amount Paid</th>
                                        <th>Status</th>
                                        <th>Note</th>
                                        <th>Action</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {paymentHistory.map((p) => (
                                        <tr key={p._id}>
                                            <td style={{ color: '#ccc', fontSize: 12 }}>
                                                {fmtDate(p.weekStart)} – {fmtDate(new Date(new Date(p.weekStart).getTime() + 6*24*60*60*1000))}
                                            </td>
                                            <td style={{ color: '#aaa', fontSize: 12 }}>
                                                {p.paidDate ? fmtDate(p.paidDate) : '—'}
                                            </td>
                                            <td style={{ color: '#eab308' }}>₹{fmt(p.totalBill)}</td>
                                            <td style={{ color: '#4ade80', fontWeight: 600 }}>₹{fmt(p.amountPaid)}</td>
                                            <td>
                                                {p.isPaid
                                                    ? <span style={{ color: '#4ade80', fontSize: 12 }}>✅ Paid</span>
                                                    : p.isPartial
                                                        ? <span style={{ color: '#eab308', fontSize: 12 }}>⚠️ Partial</span>
                                                        : <span style={{ color: '#f87171', fontSize: 12 }}>❌ Unpaid</span>}
                                            </td>
                                            <td style={{ color: '#666', fontSize: 12 }}>{p.note || '—'}</td>
                                            <td>
                                                <button
                                                    onClick={() => handleDeletePayment(p._id)}
                                                    disabled={deletingPayId === p._id}
                                                    style={{ background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                                                    {deletingPayId === p._id ? '...' : '🗑 Delete'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}