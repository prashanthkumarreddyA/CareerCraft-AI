import mongoose from 'mongoose';

/**
 * One tailored version of the master resume for one job analysis.
 * draft → approved (content frozen, hashed) → pdf_ready (validated PDF stored privately).
 * The master resume is never modified: `baseContent` is a snapshot taken at creation.
 * `revision` increases on every change and guards against lost updates (optimistic concurrency).
 */
const tailoredResumeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobAnalysisId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobAnalysis', required: true },
    masterResumeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sourceResumeHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    versionNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['draft', 'approved', 'pdf_ready'], default: 'draft', required: true },
    revision: { type: Number, default: 0, min: 0 },
    companyName: { type: String, required: true },
    jobTitle: { type: String, required: true },
    baseContent: { type: mongoose.Schema.Types.Mixed, required: true }, // master snapshot, never edited
    analysisSnapshot: { type: mongoose.Schema.Types.Mixed, required: true }, // requirements + responsibilities used for checks
    changes: { type: [mongoose.Schema.Types.Mixed], default: [] }, // proposals + decisions + audit history
    blocked: { type: [mongoose.Schema.Types.Mixed], default: [] }, // AI proposals rejected by the claim checker
    gaps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    copiedFrom: { versionNumber: Number, tailoredResumeId: mongoose.Schema.Types.ObjectId },
    finalContent: { type: mongoose.Schema.Types.Mixed, default: null },
    contentHash: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    validationReport: { type: mongoose.Schema.Types.Mixed, default: null },
    pdf: {
      cloudinaryPublicId: String,
      fileHash: String,
      fileSize: Number,
      pageCount: Number,
      templateId: String,
      generatedAt: Date,
      validation: mongoose.Schema.Types.Mixed,
    },
    ai: { provider: String, model: String, latencyMs: Number, attempts: Number, repairRound: Boolean },
    generatorVersion: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

tailoredResumeSchema.index({ userId: 1, jobAnalysisId: 1, versionNumber: 1 }, { unique: true });
tailoredResumeSchema.index({ userId: 1, createdAt: -1 });
tailoredResumeSchema.index({ 'pdf.cloudinaryPublicId': 1 }, { unique: true, partialFilterExpression: { 'pdf.cloudinaryPublicId': { $type: 'string' } } });

export const TailoredResume = mongoose.models.TailoredResume ?? mongoose.model('TailoredResume', tailoredResumeSchema);
