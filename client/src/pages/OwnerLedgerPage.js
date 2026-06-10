import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const API      = '/api/owner-ledger';
const BANK_API = '/api/bank-accounts';
const OWNERS   = ['Chand Laluwale', 'Roshan Laluwale', 'Home Expenses'];
const MODES    = ['Cash', 'Online'];

const OWNER_ICONS = {
  'Chand Laluwale':  '👤',
  'Roshan Laluwale': '👤',
  'Home Expenses':   '🏠',
};

const MODE_COLORS = {
  Cash:   { bg: '#1a2e1a', border: '#22c55e', accent: '#22c55e', icon: '💵' },
  Online: { bg: '#1a1f2e', border: '#3b82f6', accent: '#3b82f6', icon: '📱' },
};

const EMPTY_FORM = {
  owner: OWNERS[0], type: 'received', amount: '', note: '', date: '',
  paymentMode: 'Cash', bankAccountId: '',
};

const EMPTY_BANK_FORM = { owner: OWNERS[0], accountName: '', accountNumber: '', balance: '' };

export default function OwnerLedgerPage() {
  const [summary,       setSummary]       = useState([]);
  const [selected,      setSelected]      = useState(null); // { owner, paymentMode }
  const [entries,       setEntries]       = useState([]);
  const [from,          setFrom]          = useState('');
  const [to,            setTo]            = useState('');
  const [showForm,      setShowForm]      = useState(false);
  const [editEntry,     setEditEntry]     = useState(null);
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [loading,       setLoading]       = useState(false);

  // Bank accounts state
  const [bankAccounts,    setBankAccounts]    = useState([]); // all bank accounts
  const [showBankSection, setShowBankSection] = useState(false);
  const [showBankForm,    setShowBankForm]    = useState(false);
  const [editBank,        setEditBank]        = useState(null);
  const [bankForm,        setBankForm]        = useState(EMPTY_BANK_FORM);
  const [bankLoading,     setBankLoading]     = useState(false);

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/summary`);
      setSummary(data);
    } catch { toast.error('Failed to load summary'); }
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!selected) return;
    try {
      const params = { owner: selected.owner, paymentMode: selected.paymentMode };
      if (from) params.from = from;
      if (to)   params.to   = to;
      const { data } = await axios.get(`${API}/entries`, { params });
      setEntries(data);
    } catch { toast.error('Failed to load entries'); }
  }, [selected, from, to]);

  const fetchBankAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get(BANK_API);
      setBankAccounts(data);
    } catch { toast.error('Failed to load bank accounts'); }
  }, []);

  useEffect(() => { fetchSummary(); },      [fetchSummary]);
  useEffect(() => { fetchEntries(); },      [fetchEntries]);
  useEffect(() => { fetchBankAccounts(); }, [fetchBankAccounts]);

  // ── Bank accounts for a specific owner + Online mode ────────────────────────

  const banksForOwner = (owner) =>
      bankAccounts.filter(b => b.owner === owner);

  // ── Entry form handlers ─────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter a valid amount');
    if (form.paymentMode === 'Online' && !form.bankAccountId)
      return toast.error('Please select a bank account for Online payment');
    setLoading(true);
    try {
      const payload = {
        amount: form.amount, note: form.note, date: form.date,
        paymentMode: form.paymentMode, type: form.type,
        bankAccountId: form.paymentMode === 'Online' ? form.bankAccountId : null,
      };
      if (editEntry) {
        await axios.patch(`${API}/entry/${editEntry._id}`, payload);
        toast.success('Entry updated');
      } else {
        await axios.post(`${API}/entry`, { ...payload, owner: form.owner });
        toast.success('Entry added');
      }
      closeForm();
      fetchSummary();
      fetchEntries();
      fetchBankAccounts(); // refresh bank balances
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error saving entry');
    } finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await axios.delete(`${API}/entry/${id}`);
      toast.success('Deleted');
      fetchSummary(); fetchEntries(); fetchBankAccounts();
    } catch { toast.error('Delete failed'); }
  };

  const openAdd = () => {
    setEditEntry(null);
    const pm = selected?.paymentMode || 'Cash';
    // Pre-select first bank account for this owner if Online
    const firstBank = pm === 'Online' ? (banksForOwner(selected?.owner || OWNERS[0])[0]?._id || '') : '';
    setForm({
      ...EMPTY_FORM,
      owner: selected?.owner || OWNERS[0],
      paymentMode: pm,
      bankAccountId: firstBank,
    });
    setShowForm(true);
  };

  const openEdit = (e) => {
    setEditEntry(e);
    setForm({
      owner:         e.owner,
      type:          e.type,
      amount:        e.amount,
      note:          e.note || '',
      date:          e.date?.slice(0, 10) || '',
      paymentMode:   e.paymentMode || 'Cash',
      bankAccountId: e.bankAccountId?._id || e.bankAccountId || '',
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditEntry(null); };

  const switchMode = (newMode) => {
    if (!selected) return;
    setSelected({ owner: selected.owner, paymentMode: newMode });
  };

  // ── Bank account CRUD ───────────────────────────────────────────────────────

  const handleBankSubmit = async () => {
    if (!bankForm.accountName.trim()) return toast.error('Account name is required');
    if (!bankForm.accountNumber.trim()) return toast.error('Account number is required');
    setBankLoading(true);
    try {
      if (editBank) {
        await axios.patch(`${BANK_API}/${editBank._id}`, {
          accountName:   bankForm.accountName,
          accountNumber: bankForm.accountNumber,
        });
        toast.success('Bank account updated');
      } else {
        await axios.post(BANK_API, {
          owner:         bankForm.owner,
          accountName:   bankForm.accountName,
          accountNumber: bankForm.accountNumber,
          balance:       bankForm.balance ? Number(bankForm.balance) : 0,
        });
        toast.success('Bank account added');
      }
      closeBankForm();
      fetchBankAccounts();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Error saving bank account');
    } finally { setBankLoading(false); }
  };

  const handleBankDelete = async (id) => {
    if (!window.confirm('Delete this bank account? This will not affect existing ledger entries.')) return;
    try {
      await axios.delete(`${BANK_API}/${id}`);
      toast.success('Bank account deleted');
      fetchBankAccounts();
    } catch { toast.error('Delete failed'); }
  };

  const openAddBank = (ownerPreset) => {
    setEditBank(null);
    setBankForm({ ...EMPTY_BANK_FORM, owner: ownerPreset || OWNERS[0] });
    setShowBankForm(true);
  };

  const openEditBank = (b) => {
    setEditBank(b);
    setBankForm({ owner: b.owner, accountName: b.accountName, accountNumber: b.accountNumber, balance: b.balance });
    setShowBankForm(true);
  };

  const closeBankForm = () => { setShowBankForm(false); setEditBank(null); };

  // ── PDF Export ──────────────────────────────────────────────────────────────

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text(`${selected?.owner} — ${selected?.paymentMode} Ledger`, 14, 18);
    if (from || to) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Period: ${from || '...'} to ${to || '...'}`, 14, 26);
    }

    const isOnline = selected?.paymentMode === 'Online';
    const cols = ['Date', 'Type', 'Amount (Rs)', ...(isOnline ? ['Bank Account'] : []), 'Note'];
    const rows = entries.map(e => [
      new Date(e.date).toLocaleDateString('en-IN'),
      e.type === 'received' ? 'Received' : 'Paid',
      `Rs ${e.amount.toLocaleString('en-IN')}`,
      ...(isOnline ? [e.bankAccountId ? `${e.bankAccountId.accountName} (${maskAccNum(e.bankAccountId.accountNumber)})` : '-'] : []),
      e.note || '-',
    ]);

    const colStyles = isOnline
        ? { 0: { cellWidth: 28 }, 1: { cellWidth: 26 }, 2: { cellWidth: 32, halign: 'right' }, 3: { cellWidth: 50 }, 4: { cellWidth: 'auto' } }
        : { 0: { cellWidth: 30 }, 1: { cellWidth: 30 }, 2: { cellWidth: 40, halign: 'right' }, 3: { cellWidth: 'auto' } };

    autoTable(doc, {
      startY: from || to ? 32 : 24,
      head: [cols],
      body: rows,
      tableWidth: 'auto',
      margin: { left: 14, right: 14 },
      styles:             { fontSize: 10, textColor: [20, 20, 20], cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, valign: 'middle', overflow: 'linebreak' },
      headStyles:         { fillColor: [30, 80, 180], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, halign: 'left' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      bodyStyles:         { textColor: [20, 20, 20], fillColor: [255, 255, 255], halign: 'left' },
      columnStyles: colStyles,
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) {
          data.cell.styles.textColor = data.cell.raw === 'Received' ? [22, 163, 74] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
        // right-align amount header too
        if (data.section === 'head' && data.column.index === 2) {
          data.cell.styles.halign = 'right';
        }
      },
    });

    const totalReceived = entries.filter(e => e.type === 'received').reduce((s, e) => s + e.amount, 0);
    const totalPaid     = entries.filter(e => e.type === 'paid').reduce((s, e) => s + e.amount, 0);
    const balance       = totalReceived - totalPaid;
    const finalY        = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(`Total Received: Rs ${totalReceived.toLocaleString('en-IN')}`, 14, finalY);
    doc.text(`Total Paid: Rs ${totalPaid.toLocaleString('en-IN')}`, 90, finalY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(balance >= 0 ? [22, 163, 74] : [220, 38, 38]));
    doc.text(`Balance: Rs ${balance.toLocaleString('en-IN')}`, 160, finalY);

    doc.save(`ledger-${selected?.owner?.replace(/ /g, '-')}-${selected?.paymentMode}.pdf`);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const maskAccNum = (num) => {
    if (!num) return '';
    const s = String(num);
    return s.length > 4 ? '••••' + s.slice(-4) : s;
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  // Bank balances per owner (sum of all bank accounts for that owner)
  const bankBalanceByOwner = (owner) =>
      bankAccounts.filter(b => b.owner === owner).reduce((sum, b) => sum + (b.balance || 0), 0);

  // Total bank balance across all owners
  const grandBankBalance = bankAccounts.reduce((sum, b) => sum + (b.balance || 0), 0);

  const byOwner = OWNERS.map(o => ({
    owner: o,
    accounts: MODES.map(m => {
      const s = summary.find(s => s.owner === o && s.paymentMode === m)
          || { owner: o, paymentMode: m, totalReceived: 0, totalPaid: 0, balance: 0 };
      // For Online accounts, add bank account balances on top of ledger balance
      if (m === 'Online') {
        const bankTotal = bankBalanceByOwner(o);
        return { ...s, balance: s.balance + bankTotal };
      }
      return s;
    }),
  }));

  const ownerTotals = (accounts) => ({
    cash:    accounts.find(a => a.paymentMode === 'Cash')?.balance   || 0,
    online:  accounts.find(a => a.paymentMode === 'Online')?.balance || 0,
    get combined() { return this.cash + this.online; },
  });

  const grand = summary.reduce(
      (acc, s) => {
        if (s.paymentMode === 'Cash')   acc.cash   += s.balance;
        if (s.paymentMode === 'Online') acc.online += s.balance;
        return acc;
      },
      { cash: 0, online: grandBankBalance, get combined() { return this.cash + this.online; } }
  );

  // Banks grouped by owner for the management panel
  const banksByOwner = OWNERS.map(o => ({ owner: o, banks: banksForOwner(o) }));

  // Banks available in entry form (filtered by current form owner)
  const availableBanks = banksForOwner(form.owner);

  // ── Styles ──────────────────────────────────────────────────────────────────

  const S = {
    page:    { padding: '24px', fontFamily: 'DM Sans, sans-serif', color: '#e0e0e0' },
    h1:      { fontSize: 22, fontWeight: 700, marginBottom: 20 },
    section: { marginBottom: 28 },
    sTitle:  { fontSize: 13, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
    cards:   { display: 'flex', gap: 14, flexWrap: 'wrap' },
    card:    (active, mode) => ({
      flex: '1 1 200px', minWidth: 180,
      background: active ? MODE_COLORS[mode].bg : '#141414',
      border: `1.5px solid ${active ? MODE_COLORS[mode].border : '#222'}`,
      borderRadius: 10, padding: '16px 18px', cursor: 'pointer', transition: 'all .18s',
    }),
    cardTop:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    cardName: { fontSize: 13, fontWeight: 600 },
    cardMode: (mode) => ({ fontSize: 11, fontWeight: 700, color: MODE_COLORS[mode].accent, background: '#1e1e1e', borderRadius: 4, padding: '2px 7px' }),
    stat:     { fontSize: 12, color: '#888', marginBottom: 3 },
    bal:      (b, mode) => ({ fontSize: 18, fontWeight: 700, color: b >= 0 ? MODE_COLORS[mode].accent : '#ef4444', marginTop: 6 }),
    row:      { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 },
    input:    { background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '7px 11px', fontSize: 13 },
    btn:      (v) => ({
      padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
      background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'success' ? '#22c55e' : v === 'warning' ? '#f59e0b' : '#2a2a2a',
      color: '#fff',
    }),
    table:    { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:       { background: '#1a1a1a', padding: '9px 12px', textAlign: 'left', borderBottom: '1px solid #2a2a2a', color: '#aaa' },
    td:       { padding: '9px 12px', borderBottom: '1px solid #1e1e1e' },
    overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal:    { background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' },
    label:    { fontSize: 12, color: '#aaa', marginBottom: 4 },
    toggleRow: { display: 'flex', gap: 8 },
    toggleBtn: (active, color) => ({
      flex: 1, padding: '8px 0', borderRadius: 6, border: `1.5px solid ${active ? color : '#333'}`,
      background: active ? color + '22' : '#1a1a1a', color: active ? color : '#888',
      fontWeight: 700, fontSize: 13, cursor: 'pointer',
    }),
    bankCard: { background: '#0f1520', border: '1px solid #1e3a5f', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    bankBadge: { background: '#1e3a5f', color: '#3b82f6', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 },
    bankBal:   (b) => ({ fontSize: 14, fontWeight: 700, color: b >= 0 ? '#3b82f6' : '#ef4444' }),
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
      <div style={S.page}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ ...S.h1, marginBottom: 0 }}>Owner Ledger</h2>
          <button
              style={{ ...S.btn('primary'), background: showBankSection ? '#1e3a5f' : '#3b82f6', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setShowBankSection(v => !v)}
          >
            🏦 {showBankSection ? 'Hide' : 'Manage'} Bank Accounts
          </button>
        </div>

        {/* ── Bank Accounts Management Panel ───────────────────────────────── */}
        {showBankSection && (
            <div style={{ background: '#0a0f1a', border: '1px solid #1e3a5f', borderRadius: 12, padding: 20, marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#3b82f6' }}>🏦 Bank Accounts</span>
                <button style={S.btn('primary')} onClick={() => openAddBank()}>+ Add Bank Account</button>
              </div>

              {banksByOwner.map(({ owner, banks }) => (
                  <div key={owner} style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      {OWNER_ICONS[owner]} {owner}
                      <button
                          style={{ ...S.btn('primary'), marginLeft: 10, padding: '3px 10px', fontSize: 11 }}
                          onClick={() => openAddBank(owner)}
                      >+ Add</button>
                    </div>
                    {banks.length === 0 && (
                        <div style={{ color: '#444', fontSize: 13, marginLeft: 4, marginBottom: 8 }}>No bank accounts linked.</div>
                    )}
                    {banks.map(b => (
                        <div key={b._id} style={S.bankCard}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>
                              {b.accountName}
                              <span style={{ ...S.bankBadge, marginLeft: 8 }}>••••{String(b.accountNumber).slice(-4)}</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Acc No: {b.accountNumber}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={S.bankBal(b.balance)}>Rs {b.balance.toLocaleString('en-IN')}</div>
                            <button style={{ ...S.btn('warning'), padding: '4px 10px', fontSize: 12 }} onClick={() => openEditBank(b)}>Edit</button>
                            <button style={{ ...S.btn('danger'),  padding: '4px 10px', fontSize: 12 }} onClick={() => handleBankDelete(b._id)}>Delete</button>
                          </div>
                        </div>
                    ))}
                  </div>
              ))}
            </div>
        )}

        {/* ── Summary Cards ─────────────────────────────────────────────────── */}
        {byOwner.map(({ owner, accounts }) => {
          const tot = ownerTotals(accounts);
          const ownerBanks = banksForOwner(owner);
          return (
              <div key={owner} style={S.section}>
                <div style={S.sTitle}>{OWNER_ICONS[owner]} {owner}</div>
                <div style={S.cards}>
                  {accounts.map(s => {
                    const isActive = selected?.owner === s.owner && selected?.paymentMode === s.paymentMode;
                    return (
                        <div key={s.paymentMode} style={S.card(isActive, s.paymentMode)}
                             onClick={() => setSelected({ owner: s.owner, paymentMode: s.paymentMode })}>
                          <div style={S.cardTop}>
                            <div style={S.cardName}>{MODE_COLORS[s.paymentMode].icon} {s.paymentMode}</div>
                            <div style={S.cardMode(s.paymentMode)}>{s.paymentMode}</div>
                          </div>
                          <div style={S.stat}>Received: Rs {(s.totalReceived || 0).toLocaleString('en-IN')}</div>
                          <div style={S.stat}>Paid:     Rs {(s.totalPaid    || 0).toLocaleString('en-IN')}</div>
                          <div style={S.bal(s.balance, s.paymentMode)}>Rs {(s.balance || 0).toLocaleString('en-IN')}</div>

                          {/* Bank account mini-list inside Online card */}
                          {s.paymentMode === 'Online' && ownerBanks.length > 0 && (
                              <div style={{ marginTop: 10, borderTop: '1px solid #1e3a5f', paddingTop: 8 }}>
                                {ownerBanks.map(b => (
                                    <div key={b._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 3 }}>
                                      <span>🏦 {b.accountName} <span style={{ color: '#555' }}>••••{String(b.accountNumber).slice(-4)}</span></span>
                                      <span style={{ color: b.balance >= 0 ? '#3b82f6' : '#ef4444', fontWeight: 600 }}>
                              Rs {b.balance.toLocaleString('en-IN')}
                            </span>
                                    </div>
                                ))}
                              </div>
                          )}
                        </div>
                    );
                  })}
                </div>

                {/* Owner totals row */}
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <div style={{ background: '#1a2e1a', border: '1px solid #22c55e44', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
                    💵 Cash: <span style={{ fontWeight: 700, color: tot.cash >= 0 ? '#22c55e' : '#ef4444' }}>Rs {tot.cash.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ background: '#1a1f2e', border: '1px solid #3b82f644', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
                    📱 Online: <span style={{ fontWeight: 700, color: tot.online >= 0 ? '#3b82f6' : '#ef4444' }}>Rs {tot.online.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ background: '#1e1a2e', border: '1px solid #a855f744', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>
                    🧾 Total: <span style={{ fontWeight: 700, color: tot.combined >= 0 ? '#a855f7' : '#ef4444' }}>Rs {tot.combined.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
          );
        })}

        {/* ── Grand Total Bar ───────────────────────────────────────────────── */}
        <div style={{ background: '#181818', border: '1px solid #333', borderRadius: 10, padding: '14px 20px', marginBottom: 28, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' }}>Grand Total</span>
          <span style={{ fontSize: 13 }}>💵 All Cash:   <strong style={{ color: grand.cash   >= 0 ? '#22c55e' : '#ef4444' }}>Rs {grand.cash.toLocaleString('en-IN')}</strong></span>
          <span style={{ fontSize: 13 }}>📱 All Online: <strong style={{ color: grand.online >= 0 ? '#3b82f6' : '#ef4444' }}>Rs {grand.online.toLocaleString('en-IN')}</strong></span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>🏦 Overall: <strong style={{ color: grand.combined >= 0 ? '#a855f7' : '#ef4444' }}>Rs {grand.combined.toLocaleString('en-IN')}</strong></span>
        </div>

        {/* ── Entry Table ───────────────────────────────────────────────────── */}
        {selected && (
            <>
              <div style={S.row}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              {OWNER_ICONS[selected.owner]} {selected.owner}
            </span>
                <select
                    value={selected.paymentMode}
                    onChange={e => switchMode(e.target.value)}
                    style={{ ...S.input, fontWeight: 700, color: MODE_COLORS[selected.paymentMode].accent }}>
                  {MODES.map(m => <option key={m} value={m}>{MODE_COLORS[m].icon} {m}</option>)}
                </select>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={S.input} />
                <input type="date" value={to}   onChange={e => setTo(e.target.value)}   style={S.input} />
                {(from || to) && (
                    <button style={S.btn()} onClick={() => { setFrom(''); setTo(''); }}>✕ Clear</button>
                )}
                <button style={S.btn('primary')} onClick={openAdd}>+ Add Entry</button>
                <button style={S.btn('success')} onClick={exportPDF}>Export PDF</button>
              </div>

              <table style={S.table}>
                <thead>
                <tr>
                  {['Date', 'Type', 'Amount (Rs)',
                    ...(selected.paymentMode === 'Online' ? ['Bank Account'] : []),
                    'Note', 'Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr>
                </thead>
                <tbody>
                {entries.length === 0 && (
                    <tr><td colSpan={selected.paymentMode === 'Online' ? 6 : 5} style={{ ...S.td, color: '#555', textAlign: 'center' }}>No entries found</td></tr>
                )}
                {entries.map(e => (
                    <tr key={e._id}>
                      <td style={S.td}>{new Date(e.date).toLocaleDateString('en-IN')}</td>
                      <td style={{ ...S.td, color: e.type === 'received' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                        {e.type === 'received' ? '⬇ Received' : '⬆ Paid'}
                      </td>
                      <td style={S.td}>Rs {e.amount.toLocaleString('en-IN')}</td>
                      {selected.paymentMode === 'Online' && (
                          <td style={{ ...S.td, color: '#aaa' }}>
                            {e.bankAccountId
                                ? <span>🏦 {e.bankAccountId.accountName} <span style={{ color: '#555', fontSize: 11 }}>••••{String(e.bankAccountId.accountNumber).slice(-4)}</span></span>
                                : <span style={{ color: '#555' }}>—</span>
                            }
                          </td>
                      )}
                      <td style={{ ...S.td, color: '#aaa' }}>{e.note || '-'}</td>
                      <td style={S.td}>
                        <button type="button" style={{ ...S.btn('primary'), marginRight: 6 }} onClick={() => openEdit(e)}>Edit</button>
                        <button type="button" style={S.btn('danger')} onClick={() => handleDelete(e._id)}>Delete</button>
                      </td>
                    </tr>
                ))}
                </tbody>
              </table>
            </>
        )}

        {/* ── Entry Modal ───────────────────────────────────────────────────── */}
        {showForm && (
            <div style={S.overlay}>
              <div style={S.modal}>
                <h3 style={{ margin: 0, fontSize: 16 }}>{editEntry ? 'Edit Entry' : 'Add Entry'}</h3>

                {/* Owner — only on Add */}
                {!editEntry && (
                    <div>
                      <div style={S.label}>Owner / Account</div>
                      <select value={form.owner}
                              onChange={e => setForm(f => ({ ...f, owner: e.target.value, bankAccountId: '' }))}
                              style={{ ...S.input, width: '100%' }}>
                        {OWNERS.map(o => <option key={o} value={o}>{OWNER_ICONS[o]} {o}</option>)}
                      </select>
                    </div>
                )}

                {/* Payment Mode */}
                <div>
                  <div style={S.label}>Payment Mode</div>
                  <div style={S.toggleRow}>
                    <button type="button"
                            style={S.toggleBtn(form.paymentMode === 'Cash', '#22c55e')}
                            onClick={e => { e.preventDefault(); setForm(f => ({ ...f, paymentMode: 'Cash', bankAccountId: '' })); }}>
                      💵 Cash
                    </button>
                    <button type="button"
                            style={S.toggleBtn(form.paymentMode === 'Online', '#3b82f6')}
                            onClick={e => { e.preventDefault(); setForm(f => ({ ...f, paymentMode: 'Online', bankAccountId: availableBanks[0]?._id || '' })); }}>
                      📱 Online
                    </button>
                  </div>
                </div>

                {/* Bank Account selector — only when Online */}
                {form.paymentMode === 'Online' && (
                    <div>
                      <div style={S.label}>Bank Account <span style={{ color: '#ef4444' }}>*</span></div>
                      {availableBanks.length === 0 ? (
                          <div style={{ background: '#1a1a2e', border: '1px solid #ef444444', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#ef4444' }}>
                            ⚠️ No bank accounts for this owner.
                            <button
                                type="button"
                                style={{ ...S.btn('primary'), marginLeft: 10, padding: '3px 10px', fontSize: 12 }}
                                onClick={() => { closeForm(); setShowBankSection(true); openAddBank(form.owner); }}
                            >+ Add Bank</button>
                          </div>
                      ) : (
                          <select
                              value={form.bankAccountId}
                              onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
                              style={{ ...S.input, width: '100%', borderColor: form.bankAccountId ? '#3b82f6' : '#ef4444' }}>
                            <option value="">— Select Bank Account —</option>
                            {availableBanks.map(b => (
                                <option key={b._id} value={b._id}>
                                  🏦 {b.accountName} — ••••{String(b.accountNumber).slice(-4)} (Rs {b.balance.toLocaleString('en-IN')})
                                </option>
                            ))}
                          </select>
                      )}
                    </div>
                )}

                {/* Type */}
                <div>
                  <div style={S.label}>Type</div>
                  <div style={S.toggleRow}>
                    <button type="button"
                            style={S.toggleBtn(form.type === 'received', '#22c55e')}
                            onClick={e => { e.preventDefault(); setForm(f => ({ ...f, type: 'received' })); }}>
                      ⬇ Received
                    </button>
                    <button type="button"
                            style={S.toggleBtn(form.type === 'paid', '#ef4444')}
                            onClick={e => { e.preventDefault(); setForm(f => ({ ...f, type: 'paid' })); }}>
                      ⬆ Paid
                    </button>
                  </div>
                </div>

                <div>
                  <div style={S.label}>Amount (Rs)</div>
                  <input type="number" value={form.amount}
                         onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                         style={{ ...S.input, width: '100%' }} />
                </div>
                <div>
                  <div style={S.label}>Note</div>
                  <input value={form.note}
                         onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                         style={{ ...S.input, width: '100%' }} />
                </div>
                <div>
                  <div style={S.label}>Date</div>
                  <input type="date" value={form.date}
                         onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                         style={{ ...S.input, width: '100%' }} />
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" style={S.btn()} onClick={closeForm}>Cancel</button>
                  <button type="button" style={S.btn('primary')} onClick={handleSubmit} disabled={loading}>
                    {loading ? 'Saving...' : editEntry ? 'Update' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* ── Bank Account Modal ────────────────────────────────────────────── */}
        {showBankForm && (
            <div style={S.overlay}>
              <div style={S.modal}>
                <h3 style={{ margin: 0, fontSize: 16 }}>
                  🏦 {editBank ? 'Edit Bank Account' : 'Add Bank Account'}
                </h3>

                {/* Owner — only on Add */}
                {!editBank && (
                    <div>
                      <div style={S.label}>Owner</div>
                      <select value={bankForm.owner}
                              onChange={e => setBankForm(f => ({ ...f, owner: e.target.value }))}
                              style={{ ...S.input, width: '100%' }}>
                        {OWNERS.map(o => <option key={o} value={o}>{OWNER_ICONS[o]} {o}</option>)}
                      </select>
                    </div>
                )}

                <div>
                  <div style={S.label}>Account / Bank Name</div>
                  <input
                      placeholder="e.g. SBI Savings, HDFC Current"
                      value={bankForm.accountName}
                      onChange={e => setBankForm(f => ({ ...f, accountName: e.target.value }))}
                      style={{ ...S.input, width: '100%' }} />
                </div>

                <div>
                  <div style={S.label}>Account Number</div>
                  <input
                      placeholder="e.g. 1234567890"
                      value={bankForm.accountNumber}
                      onChange={e => setBankForm(f => ({ ...f, accountNumber: e.target.value }))}
                      style={{ ...S.input, width: '100%' }} />
                </div>

                {/* Opening balance — only on Add */}
                {!editBank && (
                    <div>
                      <div style={S.label}>Opening Balance (Rs) <span style={{ color: '#555' }}>optional</span></div>
                      <input
                          type="number"
                          placeholder="0"
                          value={bankForm.balance}
                          onChange={e => setBankForm(f => ({ ...f, balance: e.target.value }))}
                          style={{ ...S.input, width: '100%' }} />
                      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                        Balance will auto-update as Online entries are added/removed.
                      </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" style={S.btn()} onClick={closeBankForm}>Cancel</button>
                  <button type="button" style={S.btn('primary')} onClick={handleBankSubmit} disabled={bankLoading}>
                    {bankLoading ? 'Saving...' : editBank ? 'Update' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}