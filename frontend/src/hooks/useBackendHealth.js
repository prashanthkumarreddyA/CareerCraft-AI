import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth } from '../services/health.service';
import { isApiConfigured } from '../utils/env';

// Render's free tier sleeps after inactivity; the first request can take up to about a minute.
const FIRST_ATTEMPT_TIMEOUT_MS = 8_000;
const RETRY_TIMEOUT_MS = 15_000;
const RETRY_INTERVAL_MS = 3_000;
const WAKE_BUDGET_MS = 90_000;

/**
 * status: 'checking' | 'waking' | 'online' | 'offline' | 'misconfigured'
 * 'waking' = first attempt failed or timed out, still retrying within the wake-up budget.
 */
export function useBackendHealth() {
  const [state, setState] = useState({ status: isApiConfigured ? 'checking' : 'misconfigured', health: null, error: null, checkedAt: null });
  const runId = useRef(0);
  const controllerRef = useRef(null);

  const check = useCallback(async () => {
    if (!isApiConfigured) return;
    const id = ++runId.current;
    controllerRef.current?.abort(); // cancel any in-flight check from a previous run
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = Date.now();
    let attempt = 0;
    setState((s) => ({ ...s, status: 'checking', error: null }));

    while (id === runId.current) {
      attempt += 1;
      try {
        const health = await fetchHealth({ signal: controller.signal, timeout: attempt === 1 ? FIRST_ATTEMPT_TIMEOUT_MS : RETRY_TIMEOUT_MS });
        if (id === runId.current) setState({ status: 'online', health, error: null, checkedAt: new Date() });
        return;
      } catch (error) {
        if (id !== runId.current) return;
        const retryable = error.isNetworkError || error.isTimeout || error.status >= 500;
        if (!retryable || Date.now() - startedAt > WAKE_BUDGET_MS) {
          setState({ status: 'offline', health: null, error, checkedAt: new Date() });
          return;
        }
        setState((s) => ({ ...s, status: 'waking', error }));
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
      }
    }
  }, []);

  useEffect(() => {
    check();
    return () => {
      runId.current += 1; // stops the retry loop
      controllerRef.current?.abort(); // and cancels the request in flight
    };
  }, [check]);

  return { ...state, recheck: check };
}
