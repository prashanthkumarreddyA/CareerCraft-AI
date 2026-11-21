import multer from 'multer';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Files are held in memory only (never written to local disk), so there are no temporary files
// to clean up and nothing persists on Render's ephemeral filesystem. The 5 MB cap bounds memory.
const ACCEPTED_MIME = new Set(['application/pdf', 'application/x-pdf']);

export const uploadResumePdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1, fields: 5, parts: 6 },
  fileFilter(_req, file, cb) {
    const looksLikePdf = ACCEPTED_MIME.has(file.mimetype) || (file.mimetype === 'application/octet-stream' && /\.pdf$/i.test(file.originalname));
    if (!looksLikePdf) return cb(new ApiError(415, 'Only PDF files are supported.', { code: 'UNSUPPORTED_FILE_TYPE' }));
    cb(null, true);
  },
}).single('resume');
