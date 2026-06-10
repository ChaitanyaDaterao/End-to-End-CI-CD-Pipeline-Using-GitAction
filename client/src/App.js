import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Materials from './pages/Materials';
import Vehicles from './pages/Vehicles';
import RentalBills from './pages/RentalBills';
import OwnVehicleBills from './pages/OwnVehicleBills';
import Staff from './pages/Staff';
import Billing from './pages/Billing';
import Pokland from './pages/Pokland';
import Khet from './pages/Khet';
import './pages/Modal.css';
import PL from './pages/PL';
import SiteB from './pages/SiteB';
import OwnerLedgerPage from './pages/OwnerLedgerPage';


const P = ({ children }) => <ProtectedRoute><Dashboard>{children}</Dashboard></ProtectedRoute>;

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1a1a1a',
              color: '#e0e0e0',
              border: '1px solid #2a2a2a',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#eab308', secondary: '#0e0e0e' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<P />} />
          <Route path="/dashboard/materials" element={<P><Materials /></P>} />
          {/* Modules 3–7 routes will be added here */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard/vehicles" element={<P><Vehicles /></P>} />
          <Route path="/dashboard/rentalbills" element={<P><RentalBills /></P>} />
          <Route path="/dashboard/ownvehiclebills" element={<P><OwnVehicleBills /></P>} />
          <Route path="/dashboard/staff" element={<P><Staff /></P>} />
          <Route path="/dashboard/billing" element={<P><Billing /></P>} />
          <Route path="/dashboard/pokland" element={<P><Pokland /></P>} />
          <Route path="/dashboard/khet" element={<P><Khet /></P>} />
          <Route path="/dashboard/pl" element={<P><PL /></P>} />
          <Route path="/dashboard/siteb" element={<P><SiteB /></P>} />
          <Route path="/dashboard/owner-ledger" element={<P><OwnerLedgerPage /></P>} />

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
