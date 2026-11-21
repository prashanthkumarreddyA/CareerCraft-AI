import mongoose from 'mongoose';
import { JobApplication, LIMITS, TRANSITIONS } from '../models/JobApplication.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Job application tracker (Phase 6). Every query is scoped by userId: another user's id and a
 * malformed id both return 404, so ids cannot be probed. Every change is ONE atomic update on
 * one document, guarded by `revision` (optimistic concurrency): no transactions are needed.
 * The master resume, analyses and tailored resumes are only read here, never written.
 */

export const notFound = () => ApiError.notFound('Job application not found.', { code: 'APPLICATION_NOT_FOUND' });
const conflict = () => ApiError.conflict('This application was changed elsewhere. Reload to see the latest version.', { code: 'REVISION_CONFLICT' });

export const isId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);

/** Calendar date (UTC midnight) of "today" in the given IANA time zone. */
export function todayIn(tz = 'UTC', now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

const dateOnlyString = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/* ------------------------------------------------------------------ public shapes */

function publicFollowUp(f, today) {
  return {
    id: String(f._id),
    dueDate: dateOnlyString(f.dueDate),
    note: f.note,
    status: f.status,
    overdue: f.status === 'pending' && f.dueDate < today,
    completedAt: f.completedAt,
    createdAt: f.createdAt,
  };
}

function publicInterview(i) {
  return {
    id: String(i._id),
    round: i.round,
    roundType: i.roundType,
    scheduledAt: i.scheduledAt,
    durationMinutes: i.durationMinutes,
    interviewer: i.interviewer,
    meetingLink: i.meetingLink,
    notes: i.notes,
    feedback: i.feedback,
    result: i.result,
    status: i.status,
    rescheduleHistory: i.rescheduleHistory,
    cancelledAt: i.cancelledAt,
    cancelReason: i.cancelReason,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

const nextPendingFollowUp = (o) =>
  (o.followUps ?? []).filter((f) => f.status === 'pending').sort((a, b) => a.dueDate - b.dueDate)[0] ?? null;
const nextInterview = (o, now) =>
  (o.interviews ?? []).filter((i) => i.status === 'scheduled' && i.scheduledAt >= now).sort((a, b) => a.scheduledAt - b.scheduledAt)[0] ?? null;

/** Full application. `links` (optional) carries summaries of the linked analysis/version. */
export function toPublicApplication(doc, { today = todayIn('UTC'), links = null, now = new Date() } = {}) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id),
    companyName: o.companyName,
    jobTitle: o.jobTitle,
    location: o.location,
    employmentType: o.employmentType,
    salary: o.salary,
    experience: o.experience,
    source: o.source,
    sourceDetail: o.sourceDetail,
    jobUrl: o.jobUrl,
    jobDescription: o.jobDescription,
    applicationDate: dateOnlyString(o.applicationDate),
    notes: o.notes,
    status: o.status,
    allowedStatuses: TRANSITIONS[o.status] ?? [],
    canUndo: o.statusHistory?.at(-1)?.kind === 'change',
    statusHistory: (o.statusHistory ?? []).map((e) => ({ from: e.from, to: e.to, kind: e.kind, note: e.note, at: e.at })),
    jobAnalysisId: o.jobAnalysisId ? String(o.jobAnalysisId) : null,
    tailoredResumeId: o.tailoredResumeId ? String(o.tailoredResumeId) : null,
    linkedAt: o.linkedAt,
    linkHistory: (o.linkHistory ?? []).map((l) => ({
      jobAnalysisId: l.jobAnalysisId ? String(l.jobAnalysisId) : null,
      tailoredResumeId: l.tailoredResumeId ? String(l.tailoredResumeId) : null,
      versionNumber: l.versionNumber,
      linkedAt: l.linkedAt,
      unlinkedAt: l.unlinkedAt,
    })),
    links,
    interviews: (o.interviews ?? []).map(publicInterview).sort((a, b) => a.round - b.round),
    followUps: (o.followUps ?? []).map((f) => publicFollowUp(f, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    nextInterview: nextInterview(o, now) ? publicInterview(nextInterview(o, now)) : null,
    revision: o.revision,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Light shape for lists and the board (no job description, notes or history). */
export function toApplicationSummary(o, { today = todayIn('UTC'), now = new Date() } = {}) {
  const follow = nextPendingFollowUp(o);
  const interview = nextInterview(o, now);
  return {
    id: String(o._id),
    companyName: o.companyName,
    jobTitle: o.jobTitle,
    location: o.location,
    employmentType: o.employmentType,
    source: o.source,
    status: o.status,
    allowedStatuses: TRANSITIONS[o.status] ?? [],
    applicationDate: dateOnlyString(o.applicationDate),
    hasResumeLink: Boolean(o.tailoredResumeId),
    jobAnalysisId: o.jobAnalysisId ? String(o.jobAnalysisId) : null,
    nextFollowUp: follow ? publicFollowUp(follow, today) : null,
    overdueFollowUps: (o.followUps ?? []).filter((f) => f.status === 'pending' && f.dueDate < today).length,
    nextInterview: interview ? { id: String(interview._id), round: interview.round, roundType: interview.roundType, scheduledAt: interview.scheduledAt } : null,
    revision: o.revision,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export const SUMMARY_FIELDS = 'companyName jobTitle location employmentType source status applicationDate tailoredResumeId jobAnalysisId followUps interviews revision createdAt updatedAt';

/* ------------------------------------------------------------------ lookups */

export async function findOwned(userId, id, { lean = true } = {}) {
  if (!isId(id)) throw notFound();
  const query = JobApplication.findOne({ _id: id, userId });
  const doc = lean ? await query.lean() : await query;
  if (!doc) throw notFound();
  return doc;
}

/**
 * Applies one atomic update guarded by the expected revision. `extraFilter` adds conditions that
 * must still hold at write time (e.g. the status the transition was validated against).
 */
export async function updateOwned(userId, id, expectedRevision, update, extraFilter = {}, options = {}) {
  if (!isId(id)) throw notFound();
  const set = { ...(update.$set ?? {}) };
  const updated = await JobApplication.findOneAndUpdate(
    { _id: id, userId, revision: expectedRevision, ...extraFilter },
    { ...update, $set: set, $inc: { ...(update.$inc ?? {}), revision: 1 } },
    { returnDocument: 'after', runValidators: true, ...options },
  ).lean();
  if (updated) return updated;
  if (!(await JobApplication.exists({ _id: id, userId }))) throw notFound();
  throw conflict();
}

/* ------------------------------------------------------------------ CRUD */

const FIELD_KEYS = ['companyName', 'jobTitle', 'location', 'employmentType', 'salary', 'experience', 'source', 'sourceDetail', 'jobUrl', 'jobDescription', 'applicationDate', 'notes'];
const pick = (body) => Object.fromEntries(FIELD_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

/**
 * Creates an application. Links to an analysis / tailored version are resolved by `resolveLinks`
 * (checkpoint 6C); without links, company and job title are required.
 */
export async function createApplication(userId, body, { resolveLinks = null, now = new Date() } = {}) {
  const fields = pick(body);
  let links = { jobAnalysisId: null, tailoredResumeId: null };
  if (body.jobAnalysisId || body.tailoredResumeId) {
    if (!resolveLinks) throw ApiError.badRequest('Linking is not available.', { code: 'VALIDATION_ERROR' });
    const resolved = await resolveLinks(userId, { jobAnalysisId: body.jobAnalysisId ?? null, tailoredResumeId: body.tailoredResumeId ?? null });
    links = { jobAnalysisId: resolved.jobAnalysisId, tailoredResumeId: resolved.tailoredResumeId };
    // Prefill from the analysis (the job description is copied so it survives the posting).
    if (resolved.analysis) {
      fields.companyName ??= resolved.analysis.companyName;
      fields.jobTitle ??= resolved.analysis.jobTitle;
      if (!fields.jobDescription) fields.jobDescription = resolved.analysis.jobDescription;
    }
  }
  if (!fields.companyName || !fields.jobTitle) {
    const details = [!fields.companyName && { path: 'companyName', message: 'Company name is required.' }, !fields.jobTitle && { path: 'jobTitle', message: 'Job title is required.' }].filter(Boolean);
    throw ApiError.badRequest('Please correct the highlighted fields.', { code: 'VALIDATION_ERROR', details });
  }
  const status = body.status ?? 'saved';
  if (status === 'applied' && !fields.applicationDate) fields.applicationDate = todayIn('UTC', now);
  const doc = await JobApplication.create({
    ...fields,
    userId,
    status,
    statusHistory: [{ from: null, to: status, kind: 'created', note: '', at: now }],
    ...links,
    linkedAt: links.jobAnalysisId || links.tailoredResumeId ? now : null,
  });
  return doc.toObject();
}

export async function updateApplication(userId, id, body) {
  const fields = pick(body);
  return updateOwned(userId, id, body.expectedRevision, { $set: fields });
}

/** Deletes ONLY the application. Linked analyses and tailored resumes are never touched. */
export async function deleteApplication(userId, id) {
  if (!isId(id)) throw notFound();
  const { deletedCount } = await JobApplication.deleteOne({ _id: id, userId });
  if (!deletedCount) throw notFound();
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Filter shared by the list and the CSV export (always scoped to the user). */
export function buildFilter(userId, q) {
  const filter = { userId: new mongoose.Types.ObjectId(String(userId)) };
  if (q.q) {
    const re = new RegExp(escapeRegExp(q.q), 'i');
    filter.$or = [{ companyName: re }, { jobTitle: re }];
  }
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.location) filter.location = new RegExp(escapeRegExp(q.location), 'i');
  if (q.source) filter.source = q.source;
  if (q.from || q.to) {
    filter.applicationDate = {};
    if (q.from) filter.applicationDate.$gte = q.from;
    if (q.to) filter.applicationDate.$lte = q.to;
  }
  return filter;
}

export function buildSort(q) {
  const dir = q.order === 'asc' ? 1 : -1;
  return { [q.sort]: dir, _id: dir };
}

export async function listApplications(userId, q, { today = todayIn('UTC') } = {}) {
  if (q.from && q.to && q.from > q.to) throw ApiError.badRequest('The start date must be before the end date.', { code: 'VALIDATION_ERROR' });
  const filter = buildFilter(userId, q);
  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .collation({ locale: 'en', strength: 2 }) // case-insensitive sort by company/title
      .sort(buildSort(q))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .select(SUMMARY_FIELDS)
      .lean(),
    JobApplication.countDocuments(filter),
  ]);
  return { items: items.map((o) => toApplicationSummary(o, { today })), page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
}

export { LIMITS };

/* ------------------------------------------------------------------ 6B: status pipeline */


export const allowedStatuses = (status) => TRANSITIONS[status] ?? [];

function assertHistoryRoom(doc) {
  if ((doc.statusHistory?.length ?? 0) >= LIMITS.statusHistory) {
    throw ApiError.unprocessable('This application has reached the maximum number of status changes.', { code: 'LIMIT_REACHED' });
  }
}

/**
 * Moves an application to another status if the pipeline allows it. The write is conditional on
 * the status and revision it was validated against, so a concurrent change cannot slip through.
 * Entering Applied/Interview without an application date fills in today (recorded on the event,
 * so undoing the change clears it again).
 */
export async function changeStatus(userId, id, { status, note = '', expectedRevision }, { tz = 'UTC', now = new Date() } = {}) {
  const doc = await findOwned(userId, id);
  if (doc.revision !== expectedRevision) throw conflict();
  if (status === doc.status) throw ApiError.unprocessable(`The application is already ${status}.`, { code: 'INVALID_STATUS_TRANSITION', details: { from: doc.status, to: status, allowed: allowedStatuses(doc.status) } });
  if (!allowedStatuses(doc.status).includes(status)) {
    const allowed = allowedStatuses(doc.status);
    throw ApiError.unprocessable(
      allowed.length ? `An application cannot move from ${doc.status} to ${status}. Allowed: ${allowed.join(', ')}.` : `${doc.status[0].toUpperCase()}${doc.status.slice(1)} is a final status. Use undo if it was a mistake.`,
      { code: 'INVALID_STATUS_TRANSITION', details: { from: doc.status, to: status, allowed } },
    );
  }
  assertHistoryRoom(doc);
  const $set = { status };
  let applicationDateSet = null;
  if ((status === 'applied' || status === 'interview') && !doc.applicationDate) {
    applicationDateSet = todayIn(tz, now);
    $set.applicationDate = applicationDateSet;
  }
  return updateOwned(userId, id, expectedRevision, { $set, $push: { statusHistory: { from: doc.status, to: status, kind: 'change', note, applicationDateSet, at: now } } }, { status: doc.status });
}

/**
 * Reverts the most recent status change (only when the latest history entry is a change, so undo
 * cannot be chained into arbitrary moves). The undo itself is appended to the history.
 */
export async function undoStatus(userId, id, { expectedRevision }, { now = new Date() } = {}) {
  const doc = await findOwned(userId, id);
  if (doc.revision !== expectedRevision) throw conflict();
  const last = doc.statusHistory?.at(-1);
  if (!last || last.kind !== 'change') {
    throw ApiError.unprocessable('There is no status change to undo.', { code: 'NOTHING_TO_UNDO' });
  }
  assertHistoryRoom(doc);
  const $set = { status: last.from };
  // Clear the application date only if this change filled it in and it was not edited since.
  if (last.applicationDateSet && doc.applicationDate && new Date(doc.applicationDate).getTime() === new Date(last.applicationDateSet).getTime()) $set.applicationDate = null;
  return updateOwned(
    userId,
    id,
    expectedRevision,
    { $set, $push: { statusHistory: { from: doc.status, to: last.from, kind: 'undo', note: '', at: now } } },
    { status: doc.status },
  );
}

/* ------------------------------------------------------------------ 6D: interviews */

const interviewNotFound = () => ApiError.notFound('Interview not found.', { code: 'INTERVIEW_NOT_FOUND' });
const INTERVIEW_FIELDS = ['roundType', 'durationMinutes', 'interviewer', 'meetingLink', 'notes', 'feedback', 'result'];

export async function loadForChange(userId, id, expectedRevision) {
  const doc = await findOwned(userId, id);
  if (doc.revision !== expectedRevision) throw conflict();
  return doc;
}

function findInterview(doc, interviewId) {
  if (!isId(interviewId)) throw interviewNotFound();
  const interview = doc.interviews.find((i) => String(i._id) === String(interviewId));
  if (!interview) throw interviewNotFound();
  return interview;
}

/** Positional update of one interview (array filter on its id). */
const updateInterviewFields = (userId, id, expectedRevision, interviewId, fields, extra = {}) =>
  updateOwned(
    userId,
    id,
    expectedRevision,
    { ...extra, $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`interviews.$[iv].${k}`, v])) },
    {},
    { arrayFilters: [{ 'iv._id': new mongoose.Types.ObjectId(String(interviewId)) }] },
  );

/** Adds the next interview round. Rounds are numbered in the order they are added. */
export async function addInterview(userId, id, body, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, body.expectedRevision);
  if (doc.interviews.length >= LIMITS.interviews) throw ApiError.unprocessable(`An application can have at most ${LIMITS.interviews} interview rounds.`, { code: 'LIMIT_REACHED' });
  const round = Math.max(0, ...doc.interviews.map((i) => i.round)) + 1;
  const fields = Object.fromEntries(INTERVIEW_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  const status = fields.result && fields.result !== 'pending' ? 'completed' : 'scheduled';
  return updateOwned(userId, id, body.expectedRevision, {
    $push: { interviews: { ...fields, round, scheduledAt: body.scheduledAt, status, createdAt: now, updatedAt: now } },
  });
}

/**
 * Edits an interview. A cancelled round keeps its record: only notes and feedback can still be
 * edited. Recording a result (passed/failed/no-show) or `completed: true` marks it as held.
 */
export async function updateInterview(userId, id, interviewId, body, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, body.expectedRevision);
  const interview = findInterview(doc, interviewId);
  const fields = Object.fromEntries(INTERVIEW_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  if (interview.status === 'cancelled') {
    const locked = Object.keys(fields).filter((k) => !['notes', 'feedback'].includes(k));
    if (locked.length || body.completed) throw ApiError.unprocessable('This interview was cancelled; only its notes and feedback can be edited.', { code: 'INTERVIEW_CANCELLED' });
  }
  if (body.completed || (fields.result && fields.result !== 'pending')) fields.status = 'completed';
  fields.updatedAt = now;
  return updateInterviewFields(userId, id, body.expectedRevision, interviewId, fields);
}

/** Moves a scheduled interview to a new time; the old time is kept in its reschedule history. */
export async function rescheduleInterview(userId, id, interviewId, { scheduledAt, reason = '', expectedRevision }, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, expectedRevision);
  const interview = findInterview(doc, interviewId);
  if (interview.status !== 'scheduled') throw ApiError.unprocessable(`Only scheduled interviews can be rescheduled (this one is ${interview.status}).`, { code: 'INTERVIEW_NOT_SCHEDULED' });
  if (new Date(interview.scheduledAt).getTime() === scheduledAt.getTime()) throw ApiError.unprocessable('The new time is the same as the current one.', { code: 'SAME_TIME' });
  if (interview.rescheduleHistory.length >= LIMITS.rescheduleHistory) throw ApiError.unprocessable('This interview has been rescheduled too many times.', { code: 'LIMIT_REACHED' });
  return updateInterviewFields(userId, id, expectedRevision, interviewId, { scheduledAt, updatedAt: now }, {
    $push: { 'interviews.$[iv].rescheduleHistory': { from: interview.scheduledAt, to: scheduledAt, reason, at: now } },
  });
}

/** Cancels a scheduled interview. The round stays in the record (history is never deleted). */
export async function cancelInterview(userId, id, interviewId, { reason = '', expectedRevision }, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, expectedRevision);
  const interview = findInterview(doc, interviewId);
  if (interview.status !== 'scheduled') throw ApiError.unprocessable(`Only scheduled interviews can be cancelled (this one is ${interview.status}).`, { code: 'INTERVIEW_NOT_SCHEDULED' });
  return updateInterviewFields(userId, id, expectedRevision, interviewId, { status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now });
}

/* ------------------------------------------------------------------ 6E: follow-ups */

const followUpNotFound = () => ApiError.notFound('Follow-up not found.', { code: 'FOLLOW_UP_NOT_FOUND' });

function findFollowUp(doc, followUpId) {
  if (!isId(followUpId)) throw followUpNotFound();
  const f = doc.followUps.find((x) => String(x._id) === String(followUpId));
  if (!f) throw followUpNotFound();
  return f;
}

export async function addFollowUp(userId, id, { dueDate, note = '', expectedRevision }, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, expectedRevision);
  if (doc.followUps.length >= LIMITS.followUps) throw ApiError.unprocessable(`An application can have at most ${LIMITS.followUps} follow-ups.`, { code: 'LIMIT_REACHED' });
  return updateOwned(userId, id, expectedRevision, { $push: { followUps: { dueDate, note, status: 'pending', completedAt: null, createdAt: now } } });
}

/** Edits a follow-up; completing records the time, re-opening clears it. */
export async function updateFollowUp(userId, id, followUpId, body, { now = new Date() } = {}) {
  const doc = await loadForChange(userId, id, body.expectedRevision);
  const current = findFollowUp(doc, followUpId);
  const fields = {};
  if (body.dueDate !== undefined) fields.dueDate = body.dueDate;
  if (body.note !== undefined) fields.note = body.note;
  if (body.status !== undefined && body.status !== current.status) {
    fields.status = body.status;
    fields.completedAt = body.status === 'completed' ? now : null;
  }
  if (!Object.keys(fields).length) return doc;
  return updateOwned(
    userId,
    id,
    body.expectedRevision,
    { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`followUps.$[fu].${k}`, v])) },
    {},
    { arrayFilters: [{ 'fu._id': new mongoose.Types.ObjectId(String(followUpId)) }] },
  );
}

export async function deleteFollowUp(userId, id, followUpId, { expectedRevision }) {
  const doc = await loadForChange(userId, id, expectedRevision);
  findFollowUp(doc, followUpId);
  return updateOwned(userId, id, expectedRevision, { $pull: { followUps: { _id: new mongoose.Types.ObjectId(String(followUpId)) } } });
}

/* ------------------------------------------------------------------ 6E: dashboard */

const DAY = 86_400_000;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
/** Monday (UTC midnight) of the ISO week containing calendar date d. */
const weekStart = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));
const monthKey = (d) => d.toISOString().slice(0, 7);

/**
 * Statuses an application has effectively passed through: its history replayed, with each undo
 * removing the change it reverted (so an undone move does not count in the conversion rates).
 */
export function reachedStatuses(statusHistory = []) {
  const path = [];
  for (const e of statusHistory) {
    if (e.kind === 'undo') path.pop();
    else path.push(e.to);
  }
  return new Set(path);
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

/** Dashboard figures for one user, computed in the user's time zone. */
export async function getDashboard(userId, { tz = 'UTC', now = new Date() } = {}) {
  const today = todayIn(tz, now);
  const docs = await JobApplication.find({ userId })
    .select('companyName jobTitle location employmentType source status applicationDate tailoredResumeId jobAnalysisId statusHistory followUps interviews revision createdAt updatedAt')
    .lean();

  const byStatus = Object.fromEntries(Object.keys(TRANSITIONS).map((s) => [s, 0]));
  let reachedApplied = 0;
  let reachedInterview = 0;
  let selected = 0;
  for (const d of docs) {
    byStatus[d.status] += 1;
    const r = reachedStatuses(d.statusHistory);
    if (['applied', 'interview', 'selected', 'rejected'].some((s) => r.has(s))) reachedApplied += 1;
    if (r.has('interview') || r.has('selected')) reachedInterview += 1;
    if (r.has('selected')) selected += 1;
  }

  // Trends by application date (calendar dates, so no time-zone shifts): last 12 weeks / months.
  const thisWeek = weekStart(today);
  const weekly = Array.from({ length: 12 }, (_, i) => ({ start: addDays(thisWeek, (i - 11) * 7).toISOString().slice(0, 10), count: 0 }));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11 + i, 1));
    return { month: monthKey(d), count: 0 };
  });
  const weekIndex = new Map(weekly.map((w, i) => [w.start, i]));
  const monthIndex = new Map(monthly.map((m, i) => [m.month, i]));
  for (const d of docs) {
    if (!d.applicationDate) continue;
    const date = new Date(d.applicationDate);
    const wi = weekIndex.get(weekStart(date).toISOString().slice(0, 10));
    if (wi !== undefined) weekly[wi].count += 1;
    const mi = monthIndex.get(monthKey(date));
    if (mi !== undefined) monthly[mi].count += 1;
  }

  const ref = (d) => ({ applicationId: String(d._id), companyName: d.companyName, jobTitle: d.jobTitle, status: d.status });
  const pending = docs.flatMap((d) => d.followUps.filter((f) => f.status === 'pending').map((f) => ({ ...ref(d), followUp: publicFollowUp(f, today) })));
  const horizon = addDays(today, 14);
  const upcomingInterviews = docs
    .flatMap((d) => d.interviews.filter((i) => i.status === 'scheduled' && i.scheduledAt >= now).map((i) => ({ ...ref(d), interview: { id: String(i._id), round: i.round, roundType: i.roundType, scheduledAt: i.scheduledAt, meetingLink: i.meetingLink } })))
    .sort((a, b) => a.interview.scheduledAt - b.interview.scheduledAt);

  return {
    generatedAt: now,
    timeZone: tz,
    today: today.toISOString().slice(0, 10),
    totals: {
      applications: docs.length,
      byStatus,
      interviewsScheduled: upcomingInterviews.length,
      offers: byStatus.selected,
      reachedApplied,
      reachedInterview,
      reachedSelected: selected,
    },
    rates: {
      interviewConversion: rate(reachedInterview, reachedApplied), // % of applied that reached an interview
      selectionRate: rate(selected, reachedInterview), // % of interviewed that were selected
      offerRate: rate(selected, reachedApplied), // % of applied that were selected
    },
    trends: { weekly, monthly },
    recentApplications: [...docs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((d) => toApplicationSummary(d, { today, now })),
    followUps: {
      overdue: pending.filter((p) => p.followUp.overdue).sort((a, b) => a.followUp.dueDate.localeCompare(b.followUp.dueDate)).slice(0, 20),
      upcoming: pending
        .filter((p) => !p.followUp.overdue && new Date(`${p.followUp.dueDate}T00:00:00Z`) <= horizon)
        .sort((a, b) => a.followUp.dueDate.localeCompare(b.followUp.dueDate))
        .slice(0, 20),
      pendingTotal: pending.length,
    },
    upcomingInterviews: upcomingInterviews.slice(0, 10),
  };
}

/* ------------------------------------------------------------------ 6F: board + CSV export */

export const BOARD_LIMIT = 1000;

/** Cards for the Kanban board, grouped by status (most recently updated first). */
export async function getBoard(userId, { tz = 'UTC', now = new Date() } = {}) {
  const today = todayIn(tz, now);
  const docs = await JobApplication.find({ userId }).sort({ updatedAt: -1, _id: -1 }).limit(BOARD_LIMIT + 1).select(SUMMARY_FIELDS).lean();
  const columns = Object.fromEntries(Object.keys(TRANSITIONS).map((s) => [s, []]));
  for (const d of docs.slice(0, BOARD_LIMIT)) columns[d.status].push(toApplicationSummary(d, { today, now }));
  return { columns, total: Math.min(docs.length, BOARD_LIMIT), truncated: docs.length > BOARD_LIMIT };
}

export const EXPORT_LIMIT = 10_000;

/**
 * Spreadsheet-safe cell: always quoted; a value starting with = + - @ (or a tab / carriage return)
 * is prefixed with ' so spreadsheet apps never evaluate it as a formula (CSV injection).
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS = [
  ['Company', (d) => d.companyName],
  ['Job title', (d) => d.jobTitle],
  ['Status', (d) => d.status],
  ['Application date', (d) => dateOnlyString(d.applicationDate)],
  ['Location', (d) => d.location],
  ['Employment type', (d) => d.employmentType],
  ['Salary min', (d) => d.salary?.min],
  ['Salary max', (d) => d.salary?.max],
  ['Salary currency', (d) => d.salary?.currency],
  ['Salary period', (d) => d.salary?.period],
  ['Experience', (d) => [d.experience?.minYears ?? '', d.experience?.maxYears ?? ''].join('–').replace(/^–$/, '') || d.experience?.text],
  ['Source', (d) => d.source],
  ['Source detail', (d) => d.sourceDetail],
  ['Job URL', (d) => d.jobUrl],
  ['Interview rounds', (d) => d.interviews.length],
  ['Next interview', (d, x) => x.nextInterview?.toISOString() ?? ''],
  ['Pending follow-ups', (d) => d.followUps.filter((f) => f.status === 'pending').length],
  ['Next follow-up', (d, x) => (x.nextFollowUp ? dateOnlyString(x.nextFollowUp) : '')],
  ['Analysis match %', (d, x) => x.match ?? ''],
  ['Resume version', (d, x) => x.version ?? ''],
  ['Notes', (d) => d.notes],
  ['Created', (d) => d.createdAt?.toISOString()],
  ['Last updated', (d) => d.updatedAt?.toISOString()],
];

/**
 * CSV of the user's applications matching the list filters (no pagination). Every query is scoped
 * to the user, including the lookups of linked analyses and versions. The job description is not
 * included (it can be very long); it stays available in the app.
 */
export async function exportApplicationsCsv(userId, q, { now = new Date() } = {}) {
  if (q.from && q.to && q.from > q.to) throw ApiError.badRequest('The start date must be before the end date.', { code: 'VALIDATION_ERROR' });
  const filter = buildFilter(userId, q);
  const docs = await JobApplication.find(filter)
    .collation({ locale: 'en', strength: 2 })
    .sort(buildSort(q))
    .limit(EXPORT_LIMIT + 1)
    .select('-jobDescription -statusHistory -linkHistory')
    .lean();
  if (docs.length > EXPORT_LIMIT) throw ApiError.unprocessable(`Too many applications to export at once (max ${EXPORT_LIMIT}). Narrow the filters.`, { code: 'EXPORT_TOO_LARGE' });

  const analysisIds = [...new Set(docs.map((d) => d.jobAnalysisId).filter(Boolean).map(String))];
  const versionIds = [...new Set(docs.map((d) => d.tailoredResumeId).filter(Boolean).map(String))];
  const [analyses, versions] = await Promise.all([
    analysisIds.length ? JobAnalysis.find({ _id: { $in: analysisIds }, userId }).select('matchPercentage').lean() : [],
    versionIds.length ? TailoredResume.find({ _id: { $in: versionIds }, userId }).select('versionNumber').lean() : [],
  ]);
  const match = new Map(analyses.map((a) => [String(a._id), a.matchPercentage]));
  const version = new Map(versions.map((v) => [String(v._id), v.versionNumber]));

  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(',')];
  for (const d of docs) {
    const extra = {
      nextInterview: nextInterview(d, now)?.scheduledAt ?? null,
      nextFollowUp: nextPendingFollowUp(d)?.dueDate ?? null,
      match: d.jobAnalysisId ? match.get(String(d.jobAnalysisId)) : null,
      version: d.tailoredResumeId ? version.get(String(d.tailoredResumeId)) : null,
    };
    lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(d, extra))).join(','));
  }
  // BOM so spreadsheet apps read UTF-8 (₹, é, …) correctly; CRLF per RFC 4180.
  return { csv: `﻿${lines.join('\r\n')}\r\n`, count: docs.length };
}
