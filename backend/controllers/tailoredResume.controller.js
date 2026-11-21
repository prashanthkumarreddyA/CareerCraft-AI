import {
  acceptAllPassing,
  approveTailoredResume,
  createTailoredResume,
  decideChange,
  deleteTailoredResume,
  duplicateTailoredResume,
  getTailoredResume,
  listTailoredResumes,
} from '../services/tailored-resume.service.js';
import { generateTailoredPdf, getTailoredPdfDownloadUrl, getTailoredPdfFile } from '../services/tailored-pdf.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

export async function createVersion(req, res) {
  ok(res, { tailoredResume: await createTailoredResume(req.user.id, req.params.id, req.app.locals.ai) }, 201);
}

export async function listForAnalysis(req, res) {
  ok(res, await listTailoredResumes(req.user.id, { jobAnalysisId: req.params.id }));
}

export async function listAll(req, res) {
  ok(res, await listTailoredResumes(req.user.id));
}

export async function getVersion(req, res) {
  ok(res, { tailoredResume: await getTailoredResume(req.user.id, req.params.id) });
}

export async function decide(req, res) {
  ok(res, { tailoredResume: await decideChange(req.user.id, req.params.id, req.params.changeId, req.body) });
}

export async function acceptAll(req, res) {
  ok(res, { tailoredResume: await acceptAllPassing(req.user.id, req.params.id, req.body) });
}

export async function approve(req, res) {
  ok(res, { tailoredResume: await approveTailoredResume(req.user.id, req.params.id, req.body) });
}

export async function duplicate(req, res) {
  ok(res, { tailoredResume: await duplicateTailoredResume(req.user.id, req.params.id) }, 201);
}

export async function remove(req, res) {
  await deleteTailoredResume(req.user.id, req.params.id, req.app.locals.storage);
  ok(res, { deleted: true });
}

export async function createPdf(req, res) {
  ok(res, { tailoredResume: await generateTailoredPdf(req.user.id, req.params.id, req.app.locals.storage) }, 201);
}

export async function streamPdf(req, res) {
  const { buffer, fileName } = await getTailoredPdfFile(req.user.id, req.params.id, req.app.locals.storage);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'Content-Length': buffer.length });
  res.send(buffer);
}

export async function pdfDownloadUrl(req, res) {
  ok(res, await getTailoredPdfDownloadUrl(req.user.id, req.params.id, req.app.locals.storage));
}
