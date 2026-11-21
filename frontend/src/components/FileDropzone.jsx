import { useId, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { formatBytes, MAX_UPLOAD_BYTES } from '../utils/format';

/** Client-side check mirroring the server; the server re-validates everything. */
export function validatePdfFile(file) {
  if (!file) return 'Choose a PDF file.';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'Only PDF files are supported.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `The file is ${formatBytes(file.size)}; the maximum is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  return null;
}

export default function FileDropzone({ onFile, disabled = false, label = 'Upload your resume PDF' }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  function accept(file) {
    const problem = validatePdfFile(file);
    setError(problem);
    if (!problem) onFile(file);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          if (e.dataTransfer.files.length > 1) return setError('Drop one file at a time.');
          accept(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-white'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <UploadCloud className="h-10 w-10 text-brand-700" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-1 text-xs text-slate-500">Drag and drop a PDF here, or choose a file. Max {formatBytes(MAX_UPLOAD_BYTES)}.</p>
        <label
          htmlFor={inputId}
          className={`mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 ${
            disabled ? 'pointer-events-none' : ''
          }`}
        >
          Choose PDF
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            accept(e.target.files[0]);
            e.target.value = ''; // allow choosing the same file again after an error
          }}
        />
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
