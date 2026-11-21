import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { BackendStatusProvider } from './context/BackendStatusContext';
import { AuthProvider } from './context/AuthContext';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BackendStatusProvider>
      <AuthProvider>
        <App />
        <Toaster position="top-right" toastOptions={{ className: 'text-sm', duration: 5000 }} />
      </AuthProvider>
    </BackendStatusProvider>
  </StrictMode>,
);
