import type { ProjectDocument } from '../types'
import { formatBytes } from './DocumentUpload'

interface DocumentManifestProps {
  documents: ProjectDocument[]
  isLoading: boolean
  error: string | null
  onRefresh: () => void
}

function formatType(document: ProjectDocument) {
  const extension = document.name.split('.').pop()
  if (extension && extension !== document.name) return extension.toUpperCase()
  return document.content_type?.split('/').pop()?.toUpperCase() || 'FILE'
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase())
}

export function DocumentManifest({ documents, isLoading, error, onRefresh }: DocumentManifestProps) {
  return (
    <section className="panel manifest-panel" aria-labelledby="manifest-title">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">Chain of custody</div>
          <h2 id="manifest-title">Document manifest</h2>
          <p>{documents.length} source {documents.length === 1 ? 'document' : 'documents'} registered</p>
        </div>
        <button className="button button--quiet" type="button" onClick={onRefresh} disabled={isLoading}>
          <span aria-hidden="true">↻</span> {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="state-card state-card--error" role="alert">
          <strong>Manifest unavailable</strong>
          <p>{error}</p>
          <button className="button button--secondary" type="button" onClick={onRefresh}>Try again</button>
        </div>
      ) : isLoading ? (
        <div className="manifest-loading" aria-label="Loading document manifest" aria-busy="true">
          <span /><span /><span />
        </div>
      ) : documents.length === 0 ? (
        <div className="state-card">
          <div className="state-card__icon" aria-hidden="true">▤</div>
          <strong>No source documents registered</strong>
          <p>Upload the solicitation package above. Each file will be hashed and added to this manifest.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Documents ingested for this project</caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Status</th>
                <th scope="col">Characters</th>
                <th scope="col">Source archive</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className={document.error ? 'document-row--error' : undefined}>
                  <td data-label="Document">
                    <strong>{document.name}</strong>
                    {document.relative_path && document.relative_path !== document.name && (
                      <small>{document.relative_path}</small>
                    )}
                    {document.error && <span className="row-error" role="alert">{document.error}</span>}
                  </td>
                  <td data-label="Type"><span className="file-type">{formatType(document)}</span></td>
                  <td data-label="Size">{formatBytes(document.size_bytes)}</td>
                  <td data-label="SHA-256"><code title={document.sha256}>{document.sha256.slice(0, 12) || 'Pending'}</code></td>
                  <td data-label="Status">
                    <span className={`status status--${document.status.toLowerCase()}`}>
                      <span aria-hidden="true" />{statusLabel(document.status)}
                    </span>
                    {document.duplicate_of && (
                      <small>Duplicate of {document.duplicate_of.slice(0, 12)}</small>
                    )}
                  </td>
                  <td data-label="Characters">{document.extraction_count ?? '—'}</td>
                  <td data-label="Source archive">{document.source_archive || 'Direct upload'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
