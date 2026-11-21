import axios from 'axios';
import { API_URL } from '../utils/env';

/** Normalised error for every failed API call, so UI code handles one shape. */
export class ApiRequestError extends Error {
  constructor({ message, status = 0, code = 'UNKNOWN', isNetworkError = false, isTimeout = false, details }) {
    super(message);
    this.name = 'ApiRequestError';
    Object.assign(this, { status, code, isNetworkError, isTimeout, details });
  }
}

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

// Session wiring: AuthContext registers how to read the token and what to do on a 401.
let getToken = () => null;
let onUnauthorized = () => {};
export function configureAuth({ tokenGetter, unauthorizedHandler }) {
  getToken = tokenGetter;
  onUnauthorized = unauthorizedHandler;
}

api.interceptors.request.use((request) => {
  const token = getToken();
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

async function readErrorBody(data) {
  // Blob responses (file downloads) carry JSON errors as a Blob.
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return JSON.parse(await data.text());
    } catch {
      return null;
    }
  }
  return data;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return Promise.reject(new ApiRequestError({ message: 'The server took too long to respond.', code: 'TIMEOUT', isTimeout: true }));
    }
    if (!error.response) {
      return Promise.reject(new ApiRequestError({ message: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK_ERROR', isNetworkError: true }));
    }
    const { status } = error.response;
    const data = await readErrorBody(error.response.data);
    const apiError = data?.error ?? {};
    const normalised = new ApiRequestError({
      status,
      code: apiError.code ?? `HTTP_${status}`,
      message: apiError.message ?? `Request failed with status ${status}.`,
      details: apiError.details,
    });
    // An expired/revoked session on an authenticated request ends the local session.
    if (status === 401 && error.config?.headers?.Authorization) onUnauthorized(normalised);
    return Promise.reject(normalised);
  },
);
