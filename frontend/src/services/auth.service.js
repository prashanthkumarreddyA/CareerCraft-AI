import { api } from './api';

export async function register({ name, email, password }) {
  const { data } = await api.post('/auth/register', { name, email, password });
  return data.data; // { user, token, expiresAt }
}

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password });
  return data.data;
}

export async function logout() {
  await api.post('/auth/logout');
}

export async function fetchCurrentUser() {
  const { data } = await api.get('/auth/me');
  return data.data.user;
}
