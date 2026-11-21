import mongoose from 'mongoose';

/**
 * One saved job-description analysis. Results are stored as computed (an analysis is a snapshot):
 * later changes to the master resume do not rewrite old analyses; `sourceResume` records which
 * resume version (file hash) was analysed. Every query must be scoped by userId.
 */
const jobAnalysisSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    jobTitle: { type: String, required: true, trim: true, maxlength: 150 },
    jobDescription: { type: String, required: true, maxlength: 20_000 },
    jobAnalysis: { type: mongoose.Schema.Types.Mixed, required: true }, // what the JD asks for
    keywordAnalysis: { type: mongoose.Schema.Types.Mixed, required: true }, // keywords by importance/category + status
    matchAnalysis: { type: mongoose.Schema.Types.Mixed, required: true }, // per-requirement evidence + score breakdown
    matchPercentage: { type: Number, required: true, min: 0, max: 100 }, // denormalised for history lists
    analysisVersion: { type: String, required: true },
    sourceResume: {
      masterResumeId: { type: mongoose.Schema.Types.ObjectId, required: true },
      fileHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
      extractorVersion: { type: String },
    },
    ai: {
      provider: { type: String, required: true },
      model: { type: String, required: true },
      latencyMs: { type: Number },
      attempts: { type: Number },
    },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

// History list: newest first, per user.
jobAnalysisSchema.index({ userId: 1, createdAt: -1 });

export const JobAnalysis = mongoose.models.JobAnalysis ?? mongoose.model('JobAnalysis', jobAnalysisSchema);
