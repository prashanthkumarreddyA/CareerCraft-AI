import { ApiError } from '../utils/ApiError.js';
import { dashboardQuerySchema, listQuerySchema, timeZone } from '../validators/job-application.schema.js';
import {
  addFollowUp,
  addInterview,
  cancelInterview,
  deleteFollowUp,
  exportApplicationsCsv,
  getBoard,
  getDashboard,
  updateFollowUp,
  changeStatus,
  createApplication,
  rescheduleInterview,
  updateInterview,
  deleteApplication,
  undoStatus,
  findOwned,
  listApplications,
  toPublicApplication,
  todayIn,
  updateApplication,
} from '../services/job-application.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

/** Validates a query string; invalid filters are a 400 (never silently ignored). */
export function parseQuery(schema, query) {
  const result = schema.safeParse(query ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw ApiError.badRequest('Please correct the filters.', { code: 'VALIDATION_ERROR', details });
  }
  return result.data;
}

const tzOf = (req) => timeZone.parse(req.query?.tz ?? 'UTC');

/** Full public view (link summaries are added by `describeLinks` when available). */
export async function present(req, doc, describeLinks) {
  const tz = tzOf(req);
  const links = describeLinks ? await describeLinks(req.user.id, doc) : null;
  return toPublicApplication(doc, { today: todayIn(tz), links });
}

export function createController({ resolveLinks = null, describeLinks = null, setLinks = null } = {}) {
  return {
    async create(req, res) {
      const doc = await createApplication(req.user.id, req.body, { resolveLinks });
      ok(res, { application: await present(req, doc, describeLinks) }, 201);
    },
    async list(req, res) {
      const q = parseQuery(listQuerySchema, req.query);
      ok(res, await listApplications(req.user.id, q, { today: todayIn(tzOf(req)) }));
    },
    async get(req, res) {
      ok(res, { application: await present(req, await findOwned(req.user.id, req.params.id), describeLinks) });
    },
    async update(req, res) {
      const doc = await updateApplication(req.user.id, req.params.id, req.body);
      ok(res, { application: await present(req, doc, describeLinks) });
    },
    async status(req, res) {
      const doc = await changeStatus(req.user.id, req.params.id, req.body, { tz: tzOf(req) });
      ok(res, { application: await present(req, doc, describeLinks) });
    },
    async undo(req, res) {
      const doc = await undoStatus(req.user.id, req.params.id, req.body);
      ok(res, { application: await present(req, doc, describeLinks) });
    },
    async links(req, res) {
      const doc = await setLinks(req.user.id, req.params.id, req.body);
      ok(res, { application: await present(req, doc, describeLinks) });
    },
    async addInterview(req, res) {
      ok(res, { application: await present(req, await addInterview(req.user.id, req.params.id, req.body), describeLinks) }, 201);
    },
    async updateInterview(req, res) {
      ok(res, { application: await present(req, await updateInterview(req.user.id, req.params.id, req.params.interviewId, req.body), describeLinks) });
    },
    async rescheduleInterview(req, res) {
      ok(res, { application: await present(req, await rescheduleInterview(req.user.id, req.params.id, req.params.interviewId, req.body), describeLinks) });
    },
    async cancelInterview(req, res) {
      ok(res, { application: await present(req, await cancelInterview(req.user.id, req.params.id, req.params.interviewId, req.body), describeLinks) });
    },
    async addFollowUp(req, res) {
      ok(res, { application: await present(req, await addFollowUp(req.user.id, req.params.id, req.body), describeLinks) }, 201);
    },
    async updateFollowUp(req, res) {
      ok(res, { application: await present(req, await updateFollowUp(req.user.id, req.params.id, req.params.followUpId, req.body), describeLinks) });
    },
    async deleteFollowUp(req, res) {
      ok(res, { application: await present(req, await deleteFollowUp(req.user.id, req.params.id, req.params.followUpId, req.body), describeLinks) });
    },
    async dashboard(req, res) {
      const { tz } = parseQuery(dashboardQuerySchema, req.query);
      res.set('Cache-Control', 'private, no-store');
      ok(res, { dashboard: await getDashboard(req.user.id, { tz }) });
    },
    async board(req, res) {
      ok(res, await getBoard(req.user.id, { tz: tzOf(req) }));
    },
    async exportCsv(req, res) {
      const q = parseQuery(listQuerySchema, req.query);
      const { csv } = await exportApplicationsCsv(req.user.id, q);
      const stamp = new Date().toISOString().slice(0, 10);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="job-applications-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(csv);
    },
    async remove(req, res) {
      await deleteApplication(req.user.id, req.params.id);
      ok(res, { deleted: true });
    },
  };
}
