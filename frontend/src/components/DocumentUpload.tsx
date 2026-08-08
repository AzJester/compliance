import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { UploadState } from '../types'

interface DocumentUploadProps {
  state: UploadState
  message: string | null
  onUpload: (files: File[]) => Promise<void>
}

const acceptedExtensions = ['pdf', 'docx', 'xlsx', 'pptx', 'zip']

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function DocumentUpload({ state, message, onUpload }: DocumentUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]) => {
    setFiles((current) => {
      const seen = new Set(current.map(fileKey))
      return [...current, ...incoming.filter((file) => !seen.has(fileKey(file)))]
    })
  }

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  const submit = async () => {
    if (!files.length) return
    try {
      await onUpload(files)
      setFiles([])
    } catch {
      // The parent reports the actionable API error and preserves this selection for retry.
    }
  }

  const isUploading = state === 'uploading'

  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">Source package</div>
          <h2 id="upload-title">Import documents</h2>
        </div>
        <span className="format-list">PDF · DOCX · XLSX · PPTX · ZIP</span>
      </div>

      <div
        className={`dropzone${isDragging ? ' dropzone--active' : ''}`}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <div className="dropzone__mark" aria-hidden="true">⇧</div>
        <div>
          <strong>Drop a solicitation package here</strong>
          <p>Keep base RFPs, amendments, attachments, and exhibits together.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={() => inputRef.current?.click()}>
          Choose documents
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          aria-label="Choose documents"
          accept={acceptedExtensions.map((extension) => `.${extension}`).join(',')}
          multiple
          onChange={choose}
        />
      </div>

      {files.length > 0 && (
        <div className="staged-files" aria-live="polite">
          <div className="staged-files__summary">
            <strong>{files.length} {files.length === 1 ? 'file' : 'files'} ready</strong>
            <button type="button" className="text-button" onClick={() => setFiles([])} disabled={isUploading}>
              Clear
            </button>
          </div>
          <ul>
            {files.map((file) => (
              <li key={fileKey(file)}>
                <span>{file.name}</span>
                <span>{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                  disabled={isUploading}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button className="button button--primary" type="button" onClick={submit} disabled={isUploading}>
            {isUploading ? 'Uploading securely…' : `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
          </button>
        </div>
      )}

      {isUploading && (
        <div className="upload-progress" role="status">
          <progress aria-label="Document upload in progress" />
          <span>Hashing and storing files…</span>
        </div>
      )}
      {message && state !== 'uploading' && (
        <p className={`upload-message upload-message--${state}`} role={state === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
    </section>
  )
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`
}
