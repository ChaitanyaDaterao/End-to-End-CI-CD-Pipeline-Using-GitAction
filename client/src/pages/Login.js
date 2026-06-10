import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import './Login.css';
import logoImg from '../assets/nil_bmms_logo.png';

const Login = () => {
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) return toast.error('Please fill all fields');
    setLoading(true);
    try {
      await login(form.username, form.password);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-brand">
          <div className="brand-icon"><span className="sidebar-logo">
                                        <img
                                          src={logoImg}
                                          alt="NIL Logo"
                                          style={{ width: '200px', height: '200px', objectFit: 'contain' }}
                                        />
                                      </span></div>
          <h1>NIL BMS</h1>
          <p>Building Material Management Software System</p>

          <div className="developer-info" style={{ marginTop: '20px', fontSize: '0.85rem', color: '#ccc', lineHeight: '1.5' }}>
            Developed By Chaitanya H Daterao<br />
            Mob No: 9766150846<br />
            email ID: chaitanyadaterao@gmail.com
          </div>
        </div>
        <div className="login-stats">
          <div className="stat"><span>📦</span> Material Tracking</div>
          <div className="stat"><span>🧾</span> Smart Billing</div>
          <div className="stat"><span>🚛</span> Vehicle Management</div>
          <div className="stat"><span>📊</span> Profit & Loss</div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <div className="login-header">
            <h2>Admin Login</h2>
            <p>Sign in to manage your business</p>
          </div>
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="Enter username"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Enter password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <span className="btn-spinner" /> : 'Sign In'}
            </button>
          </form>
          <p className="login-hint">Default: admin / admin123</p>
        </div>
      </div>
    </div>
  );
};

export default Login;