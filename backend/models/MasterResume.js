import mongoose from 'mongoose';
import { structuredResumeSchema } from '../validators/resume.schema.js';

const { Schema } = mongoose;

/**
 * One master resume per user: the uploaded original PDF (in Cloudinary, private) plus the
 * content extracted from it. Generation (later phases) only ever READS this document;
 * tailored resumes are stored separately and reference the master.
 */
const masterResumeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // unique index: one master per user
    originalFileName: { type: String, required: true, trim: true, maxlength: 255 },

    // Cloudinary asset (private: resource_type "raw", delivery type "authenticated")
    cloudinaryPublicId: { type: String, required: true, unique: true, maxlength: 255 },
    cloudinaryResourceType: { type: String, enum: ['raw'], default: 'raw' },
    cloudinaryDeliveryType: { type: String, enum: ['authenticated'], default: 'authenticated' },

    fileFormat: { type: String, enum: ['pdf'], required: true },
    fileSize: { type: Number, required: true, min: 1 },
    fileHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ }, // SHA-256 of the original bytes (integrity check)
    pageCount: { type: Number, required: true, min: 1 },

    // Raw extraction: per-line text, style runs and coordinates, plus page/font metadata.
    extractedContent: { type: Schema.Types.Mixed, required: true },
    // Structured resume (same contract as research/phase1/output/master-resume.json).
    structuredResumeData: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: (value) => structuredResumeSchema.safeParse(value).success,
        message: 'structuredResumeData does not match the resume schema',
      },
    },

    templateId: { type: String, default: null }, // "classic-v1" when the layout matches the measured template
    templateCompatibility: {
      compatible: { type: Boolean, required: true },
      issues: { type: [String], default: [] },
    },
    extractorVersion: { type: String, required: true },
    uploadedAt: { type: Date, required: true, default: Date.now }, // time of the current file's upload (changes on replace)

    // Previous PDFs, kept as private backups when the master resume is replaced (newest last).
    // Never used for analysis or tailoring; only downloadable by the owner.
    backups: {
      type: [
        new Schema(
          {
            cloudinaryPublicId: { type: String, required: true, maxlength: 255 },
            originalFileName: { type: String, required: true, maxlength: 255 },
            fileSize: { type: Number, required: true, min: 1 },
            fileHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
            pageCount: { type: Number, required: true, min: 1 },
            uploadedAt: { type: Date, required: true },
            replacedAt: { type: Date, required: true },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const MasterResume = mongoose.models.MasterResume ?? mongoose.model('MasterResume', masterResumeSchema);
