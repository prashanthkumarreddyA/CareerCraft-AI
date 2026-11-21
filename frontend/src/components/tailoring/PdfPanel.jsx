import { useState } from 'react';
import { CheckCircle2, Download, FileText, Loader2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import PdfPreview from '../PdfPreview';
import { fetchTailoredPdf, fetchTailoredPdfDownloadUrl, generateTailoredPdf } from '../../services/tailoredResume.service';
import { IssueList } from './ChangeCard';

function Check({ ok, children }) {
  return (
    <li className="flex items-start gap-1.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />}
      <span>{children}</span>
    </li>
  );
}

export function PdfValidationSummary({ validation }) {
  if (!validation) return null;
  const c = validation.comparisonWithMaster;
  return (
    <ul className="space-y-1 text-sm text-slate-700">
      <Check ok={validation.pageCount <= validation.maxPages}>
        {validation.pageCount} page{validation.pageCount === 1 ? '' : 's'} (maximum {validation.maxPages})
      </Check>
      <Check ok={!validation.layout?.errors?.length}>No text overflow</Check>
      {validation.roundTrip && <Check ok={validation.roundTrip.identical}>Text read back from the PDF matches the approved content</Check>}
      {validation.template && <Check ok={validation.template.compatible}>Matches the {validation.template.templateId ?? 'original'} template (page size, fonts, sizes, sections)</Check>}
      {c && (
        <Check ok={c.sameFontsAndSizes && c.sameLeftMargin && c.sameHeadings}>
          Same fonts, sizes, margins and headings as your master resume · {c.identicalLines} of {c.linesTailored} lines identical in text and position
        </Check>
      )}
      <Check ok={!validation.problems?.some((p) => ['UNSUPPORTED_CLAIM', 'REVIEW_NOT_CONFIRMED'].includes(p.code))}>
        Claims re-checked ({validation.claims?.checked ?? 0}){validation.claims?.overrides ? `, ${validation.claims.overrides} confirmed override(s)` : ''}
      </Check>
    </ul>
  );
}

export default function PdfPanel({ resume, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  async function generate() {
    setBusy(true);
    setFailure(null);
    try {
      onUpdated(await generateTailoredPdf(resume.id));
      toast.success('PDF generated and validated.');
    } catch (err) {
      setFailure(err);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      const { url } = await fetchTailoredPdfDownloadUrl(resume.id);
      window.location.assign(url);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="pdf-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pdf-heading" className="flex items-center gap-2 font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-brand-700" aria-hidden="true" /> Tailored PDF
        </h2>
        {resume.status === 'approved' && (
          <button type="button" onClick={generate} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Generating and checking…' : 'Generate PDF'}
          </button>
        )}
        {resume.status === 'pdf_ready' && (
          <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" aria-hidden="true" /> Download
          </button>
        )}
      </div>
      {resume.status === 'approved' && !failure && <p className="text-sm text-slate-600">The approved content is rendered with your original template, then checked (pages, overflow, read-back, template, claims) before it becomes available.</p>}
      {failure && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-800">{failure.message}</p>
          <IssueList tone="red" issues={failure.details?.problems ?? []} />
        </div>
      )}
      {resume.pdf && (
        <>
          <PdfValidationSummary validation={resume.pdf.validation} />
          <PdfPreview version={resume.pdf.fileHash} fetchPdf={(opts) => fetchTailoredPdf(resume.id, opts)} title="Tailored resume preview" />
        </>
      )}
    </section>
  );
}
