import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { admin, loading } = useAuth();
  if (loading) return <div className="loader-fullscreen"><div className="spinner" /></div>;
  return admin ? children : <Navigate to="/login" replace />;
};

export default ProtectedRoute;
