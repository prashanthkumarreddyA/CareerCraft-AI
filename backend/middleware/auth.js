import { authenticateToken } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

/** Requires `Authorization: Bearer <jwt>`; sets req.user = { id, name, email }. */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized('Please sign in to continue.', { code: 'AUTH_REQUIRED' }));
  const user = await authenticateToken(token);
  req.user = { id: String(user._id), name: user.name, email: user.email };
  next();
}
