// Live check of the Cloudinary configuration using a tiny generated PDF (no personal data).
// usage (from backend/): node scripts/cloudinary-smoke-test.js
// Verifies: private upload, no public access, signed URL works, expired URL fails, delete works.
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryStorage } from '../services/cloudinary.service.js';

function minimalPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // content stream, filled below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const status = async (url) => (await fetch(url, { redirect: 'manual' })).status;

const pdf = minimalPdf('Cloudinary smoke test - fictional content');
let publicId;
try {
  const uploaded = await cloudinaryStorage.uploadPdf(pdf, { folder: 'resumes/smoke-test' });
  publicId = uploaded.publicId;
  check('upload (raw, authenticated)', uploaded.bytes === pdf.length, `${uploaded.bytes} bytes`);

  const publicUrl = cloudinary.url(publicId, { resource_type: 'raw', type: 'upload', secure: true });
  const unsignedAuthUrl = cloudinary.url(publicId, { resource_type: 'raw', type: 'authenticated', secure: true });
  check('public delivery URL is blocked', (await status(publicUrl)) >= 400, `HTTP ${await status(publicUrl)}`);
  check('unsigned authenticated URL is blocked', (await status(unsignedAuthUrl)) >= 400, `HTTP ${await status(unsignedAuthUrl)}`);

  const fetched = await cloudinaryStorage.fetchFile(publicId);
  check('signed URL returns identical bytes', sha(fetched) === sha(pdf));

  const { url: downloadUrl } = cloudinaryStorage.getSignedUrl(publicId, { ttlSeconds: 120, attachment: true });
  const dl = await fetch(downloadUrl);
  check('signed download link works', dl.ok, `HTTP ${dl.status}, ${dl.headers.get('content-disposition') ?? 'no disposition'}`);

  const { url: expiredUrl } = cloudinaryStorage.getSignedUrl(publicId, { ttlSeconds: -60 });
  check('expired signed link is rejected', (await status(expiredUrl)) >= 400, `HTTP ${await status(expiredUrl)}`);

  const tampered = downloadUrl.replace(/signature=[^&]+/, 'signature=0000000000000000000000000000000000000000');
  check('tampered signature is rejected', (await status(tampered)) >= 400, `HTTP ${await status(tampered)}`);
} catch (err) {
  check('smoke test ran without errors', false, err.message);
} finally {
  if (publicId) {
    await cloudinaryStorage.deleteFile(publicId);
    const after = cloudinaryStorage.getSignedUrl(publicId, { ttlSeconds: 60 }).url;
    check('delete removes the asset', (await status(after)) >= 400, `HTTP ${await status(after)}`);
    await cloudinaryStorage.deleteFile(publicId); // idempotent
    check('second delete is a no-op', true);
  }
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nAll Cloudinary checks passed');
process.exit(failed ? 1 : 0);
