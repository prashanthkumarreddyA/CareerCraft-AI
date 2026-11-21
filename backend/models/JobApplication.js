import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One job application tracked by a user (Phase 6). Everything that belongs to the application
 * (status history, resume-link history, interview rounds, follow-ups) is embedded, so every
 * change is a single-document atomic update: no multi-document transactions are needed, which
 * also works on standalone MongoDB.
 *
 * Linked JobAnalysis / TailoredResume documents are referenced, never copied. The job
 * description text is stored here so it survives the original posting being taken down.
 * History arrays are append-only. Every query must be scoped by userId.
 */

export const STATUSES = ['saved', 'applied', 'interview', 'selected', 'rejected', 'withdrawn'];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'freelance', 'other'];
export const SOURCES = ['linkedin', 'naukri', 'indeed', 'company_website', 'referral', 'recruiter', 'other'];
export const SALARY_PERIODS = ['year', 'month', 'hour'];
export const ROUND_TYPES = ['phone_screen', 'technical', 'system_design', 'hr', 'managerial', 'take_home', 'other'];
export const INTERVIEW_RESULTS = ['pending', 'passed', 'failed', 'no_show'];
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled'];
export const LIMITS = { interviews: 20, followUps: 50, statusHistory: 500, linkHistory: 200, rescheduleHistory: 50 };

const statusEventSchema = new Schema(
  {
    from: { type: String, enum: [...STATUSES, null], default: null },
    to: { type: String, enum: STATUSES, required: true },
    kind: { type: String, enum: ['created', 'change', 'undo'], required: true },
    note: { type: String, maxlength: 500, default: '' },
    applicationDateSet: { type: Date, default: null }, // date filled automatically by this change (cleared again by its undo)
    at: { type: Date, required: true },
  },
  { _id: true },
);

/**
 * Allowed status moves. Rejected and Withdrawn are final; a wrong move is corrected with
 * "undo" (recorded in the history, never erased).
 */
export const TRANSITIONS = {
  saved: ['applied', 'interview', 'withdrawn'],
  applied: ['interview', 'rejected', 'withdrawn'],
  interview: ['selected', 'rejected', 'withdrawn'],
  selected: ['withdrawn'],
  rejected: [],
  withdrawn: [],
};

const linkEventSchema = new Schema(
  {
    jobAnalysisId: { type: Schema.Types.ObjectId, default: null },
    tailoredResumeId: { type: Schema.Types.ObjectId, default: null },
    versionNumber: { type: Number, default: null }, // kept so history stays readable
    linkedAt: { type: Date, required: true },
    unlinkedAt: { type: Date, required: true },
  },
  { _id: false },
);

const rescheduleSchema = new Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, maxlength: 500, default: '' },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const interviewSchema = new Schema(
  {
    round: { type: Number, required: true, min: 1 },
    roundType: { type: String, enum: ROUND_TYPES, required: true },
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, min: 5, max: 600, default: null },
    interviewer: { type: String, maxlength: 200, default: '' },
    meetingLink: { type: String, maxlength: 2048, default: '' },
    notes: { type: String, maxlength: 5000, default: '' },
    feedback: { type: String, maxlength: 5000, default: '' },
    result: { type: String, enum: INTERVIEW_RESULTS, default: 'pending' },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'scheduled' },
    rescheduleHistory: { type: [rescheduleSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, maxlength: 500, default: '' },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: true },
);

const followUpSchema = new Schema(
  {
    dueDate: { type: Date, required: true }, // calendar date (UTC midnight)
    note: { type: String, maxlength: 1000, default: '' },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    completedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { _id: true },
);

const jobApplicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    jobTitle: { type: String, required: true, trim: true, maxlength: 150 },
    location: { type: String, trim: true, maxlength: 150, default: '' },
    employmentType: { type: String, enum: [...EMPLOYMENT_TYPES, null], default: null },
    salary: {
      min: { type: Number, min: 0, default: null },
      max: { type: Number, min: 0, default: null },
      currency: { type: String, match: /^[A-Z]{3}$/, default: null },
      period: { type: String, enum: [...SALARY_PERIODS, null], default: null },
    },
    experience: {
      minYears: { type: Number, min: 0, max: 60, default: null },
      maxYears: { type: Number, min: 0, max: 60, default: null },
      text: { type: String, maxlength: 200, default: '' },
    },
    source: { type: String, enum: [...SOURCES, null], default: null },
    sourceDetail: { type: String, maxlength: 150, default: '' },
    jobUrl: { type: String, maxlength: 2048, default: '' },
    jobDescription: { type: String, maxlength: 20_000, default: '' },
    applicationDate: { type: Date, default: null }, // calendar date (UTC midnight)
    notes: { type: String, maxlength: 5000, default: '' },

    status: { type: String, enum: STATUSES, required: true, default: 'saved' },
    statusHistory: { type: [statusEventSchema], default: [] },

    jobAnalysisId: { type: Schema.Types.ObjectId, ref: 'JobAnalysis', default: null },
    tailoredResumeId: { type: Schema.Types.ObjectId, ref: 'TailoredResume', default: null },
    linkedAt: { type: Date, default: null },
    linkHistory: { type: [linkEventSchema], default: [] },

    interviews: { type: [interviewSchema], default: [] },
    followUps: { type: [followUpSchema], default: [] },

    revision: { type: Number, required: true, default: 0 }, // optimistic concurrency
  },
  { timestamps: true, versionKey: false, minimize: false },
);

jobApplicationSchema.index({ userId: 1, status: 1, updatedAt: -1 }); // board + status filter
jobApplicationSchema.index({ userId: 1, applicationDate: -1 }); // trends + date filter + sort
jobApplicationSchema.index({ userId: 1, createdAt: -1 }); // recent
jobApplicationSchema.index({ userId: 1, 'followUps.dueDate': 1 }); // upcoming follow-ups
jobApplicationSchema.index({ userId: 1, 'interviews.scheduledAt': 1 }); // upcoming interviews
jobApplicationSchema.index({ userId: 1, jobAnalysisId: 1 }); // "is this analysis linked?" guard
jobApplicationSchema.index({ userId: 1, tailoredResumeId: 1 }); // "is this version linked?" guard
jobApplicationSchema.index({ userId: 1, 'linkHistory.jobAnalysisId': 1 }); // … also in the link history
jobApplicationSchema.index({ userId: 1, 'linkHistory.tailoredResumeId': 1 });

export const JobApplication = mongoose.models.JobApplication ?? mongoose.model('JobApplication', jobApplicationSchema);
