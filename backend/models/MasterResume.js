import mongoose from 'mongoose';
import { structuredResumeSchema } from '../validators/resume.schema.js';

const { Schema } = mongoose;

/**
 * One master profile/resume per user: optionally backed by an uploaded original PDF
 * (in Cloudinary, private) and/or manually created/edited structured profile data.
 * Job analysis and tailoring read from `structuredResumeData` as the single source of truth.
 */
const masterResumeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    source: { type: String, enum: ['pdf_upload', 'manual', 'pdf_and_manual'], default: 'pdf_upload' },
    originalFileName: { type: String, trim: true, maxlength: 255 },

    // Cloudinary asset (private: resource_type "raw", delivery type "authenticated") — optional for manual-only profiles
    cloudinaryPublicId: { type: String, unique: true, sparse: true, maxlength: 255 },
    cloudinaryResourceType: { type: String, enum: ['raw'], default: 'raw' },
    cloudinaryDeliveryType: { type: String, enum: ['authenticated'], default: 'authenticated' },

    fileFormat: { type: String, enum: ['pdf'] },
    fileSize: { type: Number, min: 1 },
    fileHash: { type: String, match: /^[a-f0-9]{64}$/ }, // SHA-256 of original PDF bytes
    profileHash: { type: String, match: /^[a-f0-9]{64}$/ }, // SHA-256 of structuredResumeData (staleness check)
    pageCount: { type: Number, min: 1 },

    // Raw extraction: per-line text, style runs and coordinates, plus page/font metadata (when uploaded from PDF).
    extractedContent: { type: Schema.Types.Mixed },
    // Structured resume/profile (extended Phase 1 contract, editable by user).
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
      compatible: { type: Boolean, default: false },
      issues: { type: [String], default: [] },
    },
    extractorVersion: { type: String, default: 'manual-v1' },
    uploadedAt: { type: Date },

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
