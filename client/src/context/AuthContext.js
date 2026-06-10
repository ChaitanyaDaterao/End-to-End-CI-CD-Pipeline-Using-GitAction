import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bms_token');
    const savedAdmin = localStorage.getItem('bms_admin');
    if (token && savedAdmin) {
      setAdmin(JSON.parse(savedAdmin));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    localStorage.setItem('bms_token', data.token);
    localStorage.setItem('bms_admin', JSON.stringify({ name: data.name, username: data.username }));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    setAdmin({ name: data.name, username: data.username });
    return data;
  };

  const logout = () => {
    localStorage.removeItem('bms_token');
    localStorage.removeItem('bms_admin');
    delete axios.defaults.headers.common['Authorization'];
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
