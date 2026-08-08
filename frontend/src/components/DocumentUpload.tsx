import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { UploadState } from '../types'

interface DocumentUploadProps {
  state: UploadState
  message: string | null
  isAnonymous: boolean
  onUpload: (files: File[]) => Promise<void>
}

const acceptedExtensions = ['pdf', 'docx', 'xlsx', 'pptx', 'zip']

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function DocumentUpload({ state, message, isAnonymous, onUpload }: DocumentUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [publicDataAcknowledged, setPublicDataAcknowledged] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]) => {
    setPublicDataAcknowledged(false)
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
    if (!files.length || (isAnonymous && !publicDataAcknowledged)) return
    try {
      await onUpload(files)
      setFiles([])
      setPublicDataAcknowledged(false)
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
          <p>
            {isAnonymous
              ? 'Synthetic PUBLIC data only. Files are retained on shared storage and visible to every visitor.'
              : 'Keep base RFPs, amendments, attachments, and exhibits together.'}
          </p>
        </div>
        <label
          className="button button--secondary"
          htmlFor="document-upload-input"
          role="button"
          tabIndex={0}
          aria-controls="document-upload-input"
          onKeyDown={(event: KeyboardEvent<HTMLLabelElement>) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            inputRef.current?.click()
          }}
        >
          Choose documents
        </label>
        <input
          id="document-upload-input"
          ref={inputRef}
          type="file"
          hidden
          accept={acceptedExtensions.map((extension) => `.${extension}`).join(',')}
          multiple
          onChange={choose}
        />
      </div>

      {files.length > 0 && (
        <div className="staged-files" aria-live="polite">
          <div className="staged-files__summary">
            <strong>{files.length} {files.length === 1 ? 'file' : 'files'} ready</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setFiles([])
                setPublicDataAcknowledged(false)
              }}
              disabled={isUploading}
            >
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
                  onClick={() => {
                    setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))
                    setPublicDataAcknowledged(false)
                  }}
                  disabled={isUploading}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {isAnonymous && (
            <label className="upload-acknowledgement">
              <input
                type="checkbox"
                checked={publicDataAcknowledged}
                onChange={(event) => setPublicDataAcknowledged(event.target.checked)}
                disabled={isUploading}
              />
              <span>
                I confirm these files contain only synthetic PUBLIC data and understand that
                anyone can view or change uploads retained on shared storage.
              </span>
            </label>
          )}
          <button
            className="button button--primary"
            type="button"
            onClick={submit}
            disabled={isUploading || (isAnonymous && !publicDataAcknowledged)}
          >
            {isUploading
              ? isAnonymous ? 'Uploading to shared storage…' : 'Uploading files…'
              : `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}${isAnonymous ? ' to shared storage' : ''}`}
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
