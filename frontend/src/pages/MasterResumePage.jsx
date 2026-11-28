import { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Edit3, FileText, Loader2, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMasterResume } from '../hooks/useMasterResume';
import { fetchMasterBackupDownloadUrl, fetchMasterResumeDownloadUrl } from '../services/masterResume.service';
import FileDropzone from '../components/FileDropzone';
import UploadProgress from '../components/UploadProgress';
import PdfPreview from '../components/PdfPreview';
import ResumeDetails from '../components/ResumeDetails';
import ProfileEditor, { EMPTY_PROFILE } from '../components/ProfileEditor';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatBytes, formatDateTime } from '../utils/format';

function ErrorDetails({ error }) {
  if (!error?.details?.length) return null;
  return (
    <ul className="mt-1 list-disc pl-5 text-xs">
      {error.details.slice(0, 5).map((d, i) => (
        <li key={i}>{typeof d === 'string' ? d : d.message ?? d.path}</li>
      ))}
    </ul>
  );
}

function TemplateStatus({ resume }) {
  if (!resume.hasPdf) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Manual profile · outputs in classic-v1 PDF template
      </span>
    );
  }
  if (resume.templateCompatibility?.compatible) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Matches output template ({resume.templateId})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-700">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Extracted from custom layout · tailored PDFs use classic-v1
    </span>
  );
}

export default function MasterResumePage() {
  const { status, resume, error, upload, reload, uploadFile, remove, saveProfile } = useMasterResume();
  const [replacing, setReplacing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  async function handleFile(file) {
    setUploadError(null);
    const mode = resume ? 'replace' : 'create';
    try {
      await uploadFile(file, mode);
      setReplacing(false);
      setCreatingManual(false);
      toast.success(mode === 'replace' ? 'Resume replaced and profile updated.' : 'Resume extracted into your profile.');
    } catch (err) {
      setUploadError(err);
      toast.error(err.message);
      if (err.code === 'MASTER_RESUME_EXISTS') reload();
    }
  }

  async function handleSaveProfile(profileData) {
    await saveProfile(profileData);
    setEditing(false);
    setCreatingManual(false);
    toast.success('Profile saved.');
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await remove();
      setConfirmDelete(false);
      setEditing(false);
      toast.success('Master resume and profile deleted.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload(backupId) {
    setDownloading(true);
    try {
      const { url } = typeof backupId === 'string' ? await fetchMasterBackupDownloadUrl(backupId) : await fetchMasterResumeDownloadUrl();
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const header = (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Master resume &amp; profile</h1>
      <p className="mt-1 text-sm text-slate-600">
        Upload any resume PDF to auto-fill your profile, or add and edit your experience, skills, projects, certifications and achievements manually.
      </p>
    </div>
  );

  if (status === 'loading' && !resume) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">{error?.message}</div>
          <button type="button" onClick={reload} className="rounded-lg border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const uploadArea = upload ? (
    <UploadProgress file={upload.file} phase={upload.phase} percent={upload.percent} />
  ) : (
    <>
      <FileDropzone onFile={handleFile} label={resume ? 'Upload a new PDF (any layout)' : 'Upload your resume PDF (any layout)'} />
      {uploadError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-medium">{uploadError.message}</p>
          <ErrorDetails error={uploadError} />
        </div>
      )}
    </>
  );

  if (!resume) {
    return (
      <div className="space-y-6">
        {header}
        {!creatingManual ? (
          <div className="space-y-4">
            {uploadArea}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Prefer to fill your profile manually?</p>
                <p className="text-xs text-slate-500">You can enter your experience, skills, projects and certifications directly without uploading a PDF.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreatingManual(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-4 w-4" aria-hidden="true" /> Build profile manually
              </button>
            </div>
          </div>
        ) : (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Create your profile</h2>
            <ProfileEditor initialData={EMPTY_PROFILE} onSave={handleSaveProfile} onCancel={() => setCreatingManual(false)} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {resume.hasPdf ? resume.originalFileName : `${resume.structuredResumeData.personalInfo.fullName} — Manual Profile`}
              </p>
              <p className="text-xs text-slate-500">
                {resume.hasPdf
                  ? `${formatBytes(resume.fileSize)} · ${resume.pageCount} page${resume.pageCount === 1 ? '' : 's'} · Uploaded ${formatDateTime(resume.uploadedAt)}`
                  : `Updated ${formatDateTime(resume.updatedAt)}`}
                {resume.source === 'pdf_and_manual' && ' · Edited manually'}
              </p>
              <p className="mt-1 text-sm">
                <TemplateStatus resume={resume} />
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {resume.hasPdf && (
              <button type="button" onClick={handleDownload} disabled={downloading || Boolean(upload)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                Download
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setUploadError(null);
                setReplacing((r) => !r);
              }}
              disabled={Boolean(upload)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {replacing ? <X className="h-4 w-4" aria-hidden="true" /> : resume.hasPdf ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {replacing ? 'Cancel' : resume.hasPdf ? 'Replace PDF' : 'Upload PDF'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={Boolean(upload)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </button>
          </div>
        </div>

        {resume.hasPdf && !resume.templateCompatibility?.compatible && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Your profile was extracted cleanly. Tailored PDFs will be generated in the standard classic-v1 output format:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {resume.templateCompatibility.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {(replacing || upload) && <div className="mt-5">{uploadArea}</div>}

        {resume.backups?.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Previous versions (private backups)</h2>
            <p className="text-xs text-slate-500">Kept when you replace your resume. Only you can download them; they are never used for analysis or tailoring.</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {[...resume.backups].reverse().map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{b.originalFileName}</span>
                    <span className="text-xs text-slate-500">
                      {formatBytes(b.fileSize)} · {b.pageCount} page{b.pageCount === 1 ? '' : 's'} · uploaded {formatDateTime(b.uploadedAt)} · replaced {formatDateTime(b.replacedAt)}
                    </span>
                  </span>
                  <button type="button" onClick={() => handleDownload(b.id)} disabled={downloading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className={resume.hasPdf && !editing ? 'grid gap-6 lg:grid-cols-2' : ''}>
        {resume.hasPdf && !editing && (
          <section aria-labelledby="preview-heading">
            <h2 id="preview-heading" className="mb-3 font-semibold text-slate-900">
              Original PDF
            </h2>
            <PdfPreview version={resume.fileHash} />
          </section>
        )}
        <section aria-labelledby="extracted-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="extracted-heading" className="font-semibold text-slate-900">
              {editing ? 'Edit profile' : 'User profile'}
            </h2>
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-4 w-4" aria-hidden="true" /> Edit / Add details
              </button>
            )}
          </div>
          {editing ? (
            <ProfileEditor
              initialData={resume.structuredResumeData}
              onSave={handleSaveProfile}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <ResumeDetails resume={resume.structuredResumeData} />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete master resume & profile?"
        message="This permanently deletes your profile, any stored PDF, and all previous backup versions. You can upload a new one or rebuild manually afterwards."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
