import { createContext, useContext } from 'react';
import { useBackendHealth } from '../hooks/useBackendHealth';

const BackendStatusContext = createContext(null);

/** One shared health/wake-up loop for the whole app (header badge, dashboard, later: forms). */
export function BackendStatusProvider({ children }) {
  const value = useBackendHealth();
  return <BackendStatusContext.Provider value={value}>{children}</BackendStatusContext.Provider>;
}

export function useBackendStatus() {
  const ctx = useContext(BackendStatusContext);
  if (!ctx) throw new Error('useBackendStatus must be used inside <BackendStatusProvider>');
  return ctx;
}
