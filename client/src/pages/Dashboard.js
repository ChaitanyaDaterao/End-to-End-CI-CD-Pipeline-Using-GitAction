import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import './Dashboard.css';
import logoImg from '../assets/nil_bmms_logo.png';

const NAV_ITEMS = [
  { path: '/dashboard', icon: '📊', label: 'Dashboard' },
  { path: '/dashboard/materials', icon: '📦', label: 'Materials' },
  { path: '/dashboard/vehicles', icon: '🚛', label: 'Vehicles' },
  { path: '/dashboard/staff', icon: '👷', label: 'Staff' },
  { path: '/dashboard/billing', icon: '🧾', label: 'Billing' },
  { path: '/dashboard/pokland', icon: '🏗️', label: 'Pokland' },
  { path: '/dashboard/pl', icon: '📈', label: 'P&L Report' },
  { path: '/dashboard/rentalbills', icon: '🧾', label: 'Rental Bills' },
  { path: '/dashboard/ownvehiclebills', icon: '🔧', label: 'Own Vehicle Bills' },
  { path: '/dashboard/khet', icon: '🌾', label: 'Khet' },
  { path: '/dashboard/siteb', icon: '🏗️', label: 'Site B' },
  { path: '/dashboard/owner-ledger', icon: '💼', label: 'Owner Ledger' },
];

const Dashboard = ({ children }) => {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [stats, setStats] = useState({
    materials: 0,
    vehicles: 0,
    billing: 0,
    staff: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('bms_token');
        const res = await axios.get('/api/dashboard/stats', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setStats(res.data);
      } catch (err) {
        console.log("Dashboard stats not available");
      }
    };

    if (location.pathname === '/dashboard') {
      fetchStats();
    }
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  return (
    <div className={`dashboard-layout ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">
            <img
              src={logoImg}
              alt="NIL Logo"
              style={{ width: '40px', height: '40px', objectFit: 'contain' }}
            />
          </span>
          {sidebarOpen && <span className="sidebar-title">NIL</span>}
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {sidebarOpen && <span className="nav-label">{item.label}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          {sidebarOpen && admin && (
            <div className="admin-info">
              <div className="admin-avatar">{admin.name?.[0]?.toUpperCase()}</div>
              <div>
                <div className="admin-name">{admin.name}</div>
                <div className="admin-role">Administrator</div>
              </div>
            </div>
          )}
          <button className="logout-btn" onClick={handleLogout}>
            🚪 {sidebarOpen && 'Logout'}
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <div className="dashboard-content">
          {location.pathname === '/dashboard' ? (
            <div className="dashboard-home">
              <div className="welcome-banner">
                <h1>Welcome back, {admin?.name || 'Owner'}! 👋</h1>
                <p>Here's your business overview for today</p>
              </div>

              <div className="stats-grid">
                <div className="stat-card yellow">
                  <div className="stat-icon">📦</div>
                  <div className="stat-info">
                    <div className="stat-value">{stats.materials}</div>
                    <div className="stat-label">Materials in Stock</div>
                  </div>
                </div>
                <div className="stat-card blue">
                  <div className="stat-icon">🚛</div>
                  <div className="stat-info">
                    <div className="stat-value">{stats.vehicles}</div>
                    <div className="stat-label">Active Vehicles</div>
                  </div>
                </div>
                <div className="stat-card green">
                  <div className="stat-icon">🧾</div>
                  <div className="stat-info">
                    <div className="stat-value">₹ {stats.billing.toLocaleString()}</div>
                    <div className="stat-label">Today's Billing</div>
                  </div>
                </div>
                <div className="stat-card red">
                  <div className="stat-icon">👷</div>
                  <div className="stat-info">
                    <div className="stat-value">{stats.staff}</div>
                    <div className="stat-label">Active Staff</div>
                  </div>
                </div>
              </div>

              <div className="module-grid">
                {NAV_ITEMS.slice(1).map(item => (
                  <Link key={item.path} to={item.path} className="module-card">
                    <span className="module-icon">{item.icon}</span>
                    <span className="module-label">{item.label}</span>
                    <span className="module-arrow">→</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;