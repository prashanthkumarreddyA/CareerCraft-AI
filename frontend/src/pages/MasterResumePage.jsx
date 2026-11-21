import { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, FileText, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMasterResume } from '../hooks/useMasterResume';
import { fetchMasterBackupDownloadUrl, fetchMasterResumeDownloadUrl } from '../services/masterResume.service';
import FileDropzone from '../components/FileDropzone';
import UploadProgress from '../components/UploadProgress';
import PdfPreview from '../components/PdfPreview';
import ResumeDetails from '../components/ResumeDetails';
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
  if (resume.templateCompatibility.compatible) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Matches template ({resume.templateId})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-700">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Layout differs from the supported template
    </span>
  );
}

export default function MasterResumePage() {
  const { status, resume, error, upload, reload, uploadFile, remove } = useMasterResume();
  const [replacing, setReplacing] = useState(false);
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
      toast.success(mode === 'replace' ? 'Master resume replaced.' : 'Master resume uploaded.');
    } catch (err) {
      setUploadError(err);
      toast.error(err.message);
      if (err.code === 'MASTER_RESUME_EXISTS') reload(); // uploaded elsewhere meanwhile
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await remove();
      setConfirmDelete(false);
      toast.success('Master resume deleted.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload(backupId) {
    setDownloading(true);
    try {
      // signed, expires within minutes
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
      <h1 className="text-2xl font-semibold text-slate-900">Master resume</h1>
      <p className="mt-1 text-sm text-slate-600">Upload your original resume once. Tailored resumes are generated from it; it is never modified.</p>
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
      <FileDropzone onFile={handleFile} label={resume ? 'Upload the replacement PDF' : 'Upload your resume PDF'} />
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
        {uploadArea}
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
              <p className="truncate font-medium text-slate-900">{resume.originalFileName}</p>
              <p className="text-xs text-slate-500">
                {formatBytes(resume.fileSize)} · {resume.pageCount} page{resume.pageCount === 1 ? '' : 's'} · Uploaded {formatDateTime(resume.uploadedAt)}
              </p>
              <p className="mt-1 text-sm">
                <TemplateStatus resume={resume} />
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleDownload} disabled={downloading || Boolean(upload)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Download
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadError(null);
                setReplacing((r) => !r);
              }}
              disabled={Boolean(upload)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {replacing ? <X className="h-4 w-4" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {replacing ? 'Cancel replace' : 'Replace'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={Boolean(upload)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
            </button>
          </div>
        </div>

        {!resume.templateCompatibility.compatible && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Tailored resumes may not reproduce this layout exactly:</p>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="mb-3 font-semibold text-slate-900">
            Original PDF
          </h2>
          <PdfPreview version={resume.fileHash} />
        </section>
        <section aria-labelledby="extracted-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="extracted-heading" className="mb-4 font-semibold text-slate-900">
            Extracted content
          </h2>
          <ResumeDetails resume={resume.structuredResumeData} />
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete master resume?"
        message="This permanently deletes the stored PDF, its extracted content and all previous versions (backups). You can upload a new one afterwards."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
