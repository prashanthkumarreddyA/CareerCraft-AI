import { registerUser, loginUser, logoutUser } from '../services/auth.service.js';

export async function register(req, res) {
  res.status(201).json({ success: true, data: await registerUser(req.body) });
}

export async function login(req, res) {
  res.json({ success: true, data: await loginUser(req.body) });
}

export async function logout(req, res) {
  await logoutUser(req.user.id);
  res.json({ success: true, data: { loggedOut: true } });
}

export function me(req, res) {
  res.json({ success: true, data: { user: req.user } });
}
