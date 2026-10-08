/**
 * Import documents (N12 `/import`): drag-drop or "Choose files", sequential uploads (concurrency 2) into
 * one batch with per-file progress, a results table with parse/confidence feedback and a details dialog,
 * and "Create claims from accepted documents" (never automatic). All document-derived strings render as
 * text nodes; nothing is kept in browser storage.
 */
import { CommitResult, ImportBatch, type ImportDocumentDetailDto } from '@fr/shared';
import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';

import { useApi, useCan } from '../../app-context';
import { Dialog } from '../../components/ui/Dialog';
import { SafeText } from '../../components/ui/SafeText';

import { FieldsTable } from './FieldsTable';
import {
  CONFIDENCE_NOTE,
  DOC_TYPE_TEXT,
  MAX_FILES,
  STATUS_TEXT,
  UPLOAD_ERROR_TEXT,
  commitSummary,
  preFilter,
  uploadErrorText,
} from './import-format';

interface Row {
  localId: number;
  name: string;
  progress: number | null;
  error: string | null;
  doc: ImportDocumentDetailDto | null;
}

const CONCURRENCY = 2;
const COMMIT_FAILED = 'Claims could not be created. Try again.';

export function ImportPage() {
  const api = useApi();
  const canImport = useCan('import:run');
  const canReview = useCan('import:review');
  const [label, setLabel] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [perspective, setPerspective] = useState('');
  const [committing, setCommitting] = useState(false);
  const [details, setDetails] = useState<ImportDocumentDetailDto | null>(null);
  const batchId = useRef<string | null>(null);
  const [batchCreated, setBatchCreated] = useState(false);
  const nextId = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!canImport) {
    return (
      <section className="card p-6">
        <h1 className="mb-2 text-lg font-semibold">Import documents</h1>
        <p className="muted">You do not have permission to import documents.</p>
      </section>
    );
  }

  const patch = (localId: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.localId === localId ? { ...r, ...change } : r)));

  const ensureBatch = async (): Promise<string> => {
    if (batchId.current) return batchId.current;
    const trimmed = label.trim();
    const b = await api.post('/api/v1/imports', trimmed ? { label: trimmed } : {}, ImportBatch);
    batchId.current = b.id;
    setBatchCreated(true);
    return b.id;
  };

  const startUploads = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setAlert(null);
    setStatus('');
    const already = rows.filter((r) => r.doc !== null).length;
    const queued: { row: Row; file: File }[] = [];
    const added: Row[] = [];
    files.forEach((file, i) => {
      const localId = nextId.current++;
      const tooMany = already + i >= MAX_FILES;
      const error = tooMany ? UPLOAD_ERROR_TEXT.other : preFilter(file);
      const row: Row = { localId, name: file.name, progress: error ? null : 0, error, doc: null };
      added.push(row);
      if (!error) queued.push({ row, file });
    });
    setRows((rs) => [...rs, ...added]);
    const firstError = added.find((r) => r.error)?.error;
    if (firstError) setAlert(firstError);
    if (queued.length === 0) return;
    setBusy(true);
    try {
      let id: string;
      try {
        id = await ensureBatch();
      } catch {
        for (const q of queued) patch(q.row.localId, { progress: null, error: UPLOAD_ERROR_TEXT.other });
        setAlert(UPLOAD_ERROR_TEXT.other);
        return;
      }
      let cursor = 0;
      const worker = async () => {
        while (cursor < queued.length) {
          const item = queued[cursor];
          cursor += 1;
          if (!item) continue;
          try {
            const doc = await api.upload(id, item.file, item.file.name, { onProgress: (p) => patch(item.row.localId, { progress: p }) });
            patch(item.row.localId, { progress: null, doc });
          } catch (e) {
            const text = uploadErrorText(e);
            patch(item.row.localId, { progress: null, error: text });
            setAlert(text);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, () => worker()));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    void startUploads([...e.dataTransfer.files]);
  };

  const accepted = rows.filter((r) => r.doc?.status === 'ACCEPTED').length;
  const threshold = rows.find((r) => r.doc)?.doc?.reviewThreshold ?? 0.9;

  const commit = async () => {
    if (!batchId.current || !perspective) return;
    setCommitting(true);
    setAlert(null);
    try {
      const r = await api.post(`/api/v1/imports/${batchId.current}/commit`, { perspective }, CommitResult);
      setStatus(commitSummary(r.created.length, r.updated.length));
    } catch {
      setAlert(COMMIT_FAILED);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Import documents</h1>
        {canReview ? (
          <Link to="/import/review" className="text-[var(--color-accent)]">
            Review queue
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="batch-label">
            Batch label
          </label>
          <input id="batch-label" className="input w-72" maxLength={120} value={label} disabled={batchCreated} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      <section aria-label="Drop files here" className="card flex flex-col items-center gap-3 border-dashed p-8 text-center" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <Upload size={24} aria-hidden="true" />
        <p>Drop PDF, PNG, JPEG, CSV or TXT files here (at most {MAX_FILES} per batch, 10 MB each).</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          Choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to import"
          accept=".pdf,.png,.jpg,.jpeg,.csv,.txt"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void startUploads(files);
          }}
        />
      </section>

      {rows.length > 0 ? (
        <ul aria-label="Selected files" className="flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.doc?.id ?? `local-${r.localId}`} className="flex items-center gap-3">
              <SafeText value={r.doc?.displayName ?? r.name} className="max-w-96" />
              {r.progress !== null ? (
                <progress className="upload-progress" max={100} value={r.progress} aria-label={`Uploading ${r.name}`} aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {alert ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {alert}
        </p>
      ) : null}

      <p className="muted text-sm">
        Fields below {Math.round(threshold * 100)}% need review. {CONFIDENCE_NOTE}
      </p>

      <div className="card overflow-auto">
        <table className="data-table" aria-label="Import results">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Fields</th>
              <th scope="col">Needs review</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc?.id ?? `local-${r.localId}`}>
                <td className="max-w-72">
                  <SafeText value={r.doc?.displayName ?? r.name} />
                </td>
                <td>{r.doc ? DOC_TYPE_TEXT[r.doc.docType] : ''}</td>
                <td>{r.error ? <span className="text-[var(--color-danger)]">{r.error}</span> : r.doc ? STATUS_TEXT[r.doc.status] : 'Uploading'}</td>
                <td className="num">{r.doc ? r.doc.fieldCount : ''}</td>
                <td className="num">{r.doc ? r.doc.unresolvedFlaggedCount : ''}</td>
                <td>
                  {r.doc ? (
                    <button type="button" className="btn" onClick={() => setDetails(r.doc)}>
                      Details
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted p-6 text-center">No files imported yet.</p> : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="commit-perspective">
            Perspective
          </label>
          <select id="commit-perspective" className="input w-40" value={perspective} onChange={(e) => setPerspective(e.target.value)}>
            <option value="" disabled hidden>
              Choose a perspective
            </option>
            <option value="SHIPPER">Shipper</option>
            <option value="CARRIER">Carrier</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary" disabled={!perspective || accepted === 0 || committing || busy} onClick={() => void commit()}>
          Create claims from accepted documents
        </button>
      </div>
      <p role="status" className="text-sm">
        {status}
      </p>

      {details ? <DocumentDialog doc={details} onClose={() => setDetails(null)} /> : null}
    </div>
  );
}

function DocumentDialog({ doc, onClose }: { doc: ImportDocumentDetailDto; onClose: () => void }) {
  return (
    <Dialog title={`Document ${doc.displayName}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <p className="muted text-sm">
          {DOC_TYPE_TEXT[doc.docType]} - {STATUS_TEXT[doc.status]}
          {doc.rejectReason ? ` (${doc.rejectReason.replaceAll('_', ' ')})` : ''}. {CONFIDENCE_NOTE}
        </p>
        <FieldsTable fields={doc.fields} />
        <div className="flex justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
