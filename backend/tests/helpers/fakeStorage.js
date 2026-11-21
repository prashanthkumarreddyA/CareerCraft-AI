import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';

/** In-memory stand-in for cloudinaryStorage with switchable failures and call tracking. */
export function createFakeStorage() {
  const files = new Map();
  const storage = {
    files,
    uploads: [],
    deletes: [],
    failUpload: false,
    failDelete: false,
    failFetch: false,
    corruptOnFetch: false,

    async uploadPdf(buffer, { folder }) {
      if (storage.failUpload) throw ApiError.badGateway('File storage is temporarily unavailable. Please try again.', { code: 'STORAGE_ERROR' });
      const publicId = `${folder}/${crypto.randomUUID()}.pdf`;
      files.set(publicId, Buffer.from(buffer));
      storage.uploads.push(publicId);
      return { publicId, bytes: buffer.length };
    },
    async deleteFile(publicId) {
      if (storage.failDelete) throw ApiError.badGateway('File storage is temporarily unavailable. Please try again.', { code: 'STORAGE_ERROR' });
      storage.deletes.push(publicId);
      files.delete(publicId);
    },
    getSignedUrl(publicId, { ttlSeconds = 300 } = {}) {
      return { url: `https://fake.storage/${publicId}?expires=${ttlSeconds}&signature=test`, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
    },
    async fetchFile(publicId) {
      if (storage.failFetch) throw ApiError.badGateway('File storage is temporarily unavailable. Please try again.', { code: 'STORAGE_ERROR' });
      const file = files.get(publicId);
      if (!file) throw ApiError.notFound('The stored file is missing.', { code: 'FILE_MISSING' });
      return storage.corruptOnFetch ? Buffer.concat([file, Buffer.from('x')]) : file;
    },
    reset() {
      Object.assign(storage, { failUpload: false, failDelete: false, failFetch: false, corruptOnFetch: false });
    },
  };
  return storage;
}
