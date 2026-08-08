import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type {
  DocumentClassification,
  DocumentProfileUpdate,
  DocumentText,
  ProjectDocument,
} from '../types'
import { formatBytes } from './DocumentUpload'
import './document-manifest.css'

interface DocumentManifestProps {
  documents: ProjectDocument[]
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  projectId?: string
  onDocumentsChanged?: () => void | Promise<void>
}

const CLASSIFICATIONS: Array<{ value: DocumentClassification; label: string; help: string }> = [
  { value: 'UNCLASSIFIED', label: 'File role not assigned', help: 'Review this file before extracting requirements.' },
  { value: 'BASE_SOLICITATION', label: 'Base solicitation', help: 'The primary RFP or solicitation document.' },
  { value: 'AMENDMENT', label: 'Amendment', help: 'A formal amendment that may supersede earlier content.' },
  { value: 'ATTACHMENT', label: 'Attachment', help: 'An exhibit, PWS, SOW, specification, or other attachment.' },
  { value: 'CDRL', label: 'CDRL / DD Form 1423', help: 'A contract data requirements list or related form.' },
  { value: 'Q_AND_A', label: 'Questions and answers', help: 'Government answers or bidder questions.' },
  { value: 'REFERENCE', label: 'Reference only', help: 'Context that should not be treated as proposal evidence.' },
  { value: 'PROPOSAL_VOLUME', label: 'Proposal response', help: 'Your written response; excluded from solicitation extraction.' },
]

function formatType(document: ProjectDocument) {
  const extension = document.name.split('.').pop()
  if (extension && extension !== document.name) return extension.toUpperCase()
  return document.content_type?.split('/').pop()?.toUpperCase() || 'FILE'
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase())
}

function classificationLabel(classification?: DocumentClassification | null) {
  return CLASSIFICATIONS.find((item) => item.value === classification)?.label ?? 'File role not assigned'
}

interface ProfileDraft {
  classification: DocumentClassification
  volume_name: string
  classification_notes: string
}

function draftFrom(document: ProjectDocument): ProfileDraft {
  return {
    classification: document.classification ?? 'UNCLASSIFIED',
    volume_name: document.volume_name ?? '',
    classification_notes: document.classification_notes ?? '',
  }
}

export function DocumentManifest({
  documents,
  isLoading,
  error,
  onRefresh,
  projectId,
  onDocumentsChanged,
}: DocumentManifestProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [previewDocument, setPreviewDocument] = useState<ProjectDocument | null>(null)
  const [preview, setPreview] = useState<DocumentText | null>(null)
  const [previewStart, setPreviewStart] = useState(0)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const classifiedCount = useMemo(
    () => documents.filter((document) => document.classification && document.classification !== 'UNCLASSIFIED').length,
    [documents],
  )

  useEffect(() => {
    if (!previewDocument || !projectId) return
    let active = true
    setPreviewBusy(true)
    setPreviewError(null)
    api.getDocumentText(projectId, previewDocument.id, previewStart)
      .then((result) => {
        if (active) setPreview(result)
      })
      .catch((reason: unknown) => {
        if (active) setPreviewError(reason instanceof Error ? reason.message : 'Could not load extracted text.')
      })
      .finally(() => {
        if (active) setPreviewBusy(false)
      })
    return () => { active = false }
  }, [previewDocument, previewStart, projectId])

  function beginEdit(document: ProjectDocument) {
    setEditingId(document.id)
    setDraft(draftFrom(document))
    setProfileError(null)
  }

  async function saveProfile(document: ProjectDocument) {
    if (!projectId || !draft) return
    setSavingId(document.id)
    setProfileError(null)
    const update: DocumentProfileUpdate = {
      classification: draft.classification,
      volume_name: draft.volume_name.trim() || null,
      classification_notes: draft.classification_notes.trim() || null,
    }
    try {
      await api.updateDocumentProfile(projectId, document.id, update)
      setEditingId(null)
      setDraft(null)
      await onDocumentsChanged?.()
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not save the document profile.')
    } finally {
      setSavingId(null)
    }
  }

  async function copyHash(document: ProjectDocument) {
    try {
      await navigator.clipboard.writeText(document.sha256)
      setCopiedId(document.id)
      window.setTimeout(() => setCopiedId((current) => current === document.id ? null : current), 1800)
    } catch {
      setProfileError('The browser could not copy the hash. Select the full value instead.')
    }
  }

  function openPreview(document: ProjectDocument) {
    setPreviewDocument(document)
    setPreviewStart(0)
    setPreview(null)
    setPreviewError(null)
  }

  return (
    <section className="panel manifest-panel" aria-labelledby="manifest-title">
      <div className="panel-heading">
        <div>
          <div className="section-kicker">Package inventory</div>
          <h2 id="manifest-title">Document manifest</h2>
          <p>
            {documents.length} {documents.length === 1 ? 'file' : 'files'} registered · {classifiedCount} with assigned roles
          </p>
        </div>
        <button className="button button--quiet" type="button" onClick={onRefresh} disabled={isLoading}>
          <span aria-hidden="true">↻</span> {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {documents.length > 0 && classifiedCount < documents.length && (
        <div className="manifest-callout" role="status">
          <strong>{documents.length - classifiedCount} {documents.length - classifiedCount === 1 ? 'file needs' : 'files need'} a role.</strong>
          <span> Assign every file so solicitation requirements and proposal evidence stay separate.</span>
        </div>
      )}

      {profileError && <div className="inline-alert inline-alert--error" role="alert">{profileError}</div>}

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
          <strong>No documents registered</strong>
          <p>Upload the solicitation package. Each file will be hashed, extracted, and added here.</p>
        </div>
      ) : (
        <div className="table-wrap manifest-table-wrap">
          <table className="manifest-table">
            <caption className="visually-hidden">Documents ingested for this project</caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">File role</th>
                <th scope="col">Integrity</th>
                <th scope="col">Processing</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const editing = editingId === document.id
                return (
                  <tr key={document.id} className={document.error ? 'document-row--error' : undefined}>
                    <td data-label="Document">
                      <strong>{document.name}</strong>
                      <span className="manifest-file-meta">{formatType(document)} · {formatBytes(document.size_bytes)}</span>
                      {document.relative_path && document.relative_path !== document.name && <small>{document.relative_path}</small>}
                      {document.source_archive && <small>From archive: {document.source_archive}</small>}
                      {document.error && <span className="row-error" role="alert">{document.error}</span>}
                    </td>
                    <td data-label="File role">
                      {editing && draft ? (
                        <div className="document-profile-editor">
                          <label>
                            <span>File role</span>
                            <select
                              value={draft.classification}
                              onChange={(event) => {
                                const classification = event.target.value as DocumentClassification
                                setDraft({
                                  ...draft,
                                  classification,
                                  volume_name: classification === 'PROPOSAL_VOLUME' ? draft.volume_name : '',
                                })
                              }}
                            >
                              {CLASSIFICATIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          {draft.classification === 'PROPOSAL_VOLUME' && (
                            <label>
                              <span>Volume name</span>
                              <input
                                value={draft.volume_name}
                                onChange={(event) => setDraft({ ...draft, volume_name: event.target.value })}
                                placeholder="e.g., Technical Volume"
                              />
                            </label>
                          )}
                          <label>
                            <span>File role note</span>
                            <textarea
                              rows={2}
                              value={draft.classification_notes}
                              onChange={(event) => setDraft({ ...draft, classification_notes: event.target.value })}
                              placeholder="Optional package or amendment note"
                            />
                          </label>
                          <small>{CLASSIFICATIONS.find((item) => item.value === draft.classification)?.help}</small>
                          <div className="document-profile-actions">
                            <button className="button button--primary button--small" type="button" onClick={() => void saveProfile(document)} disabled={savingId === document.id}>
                              {savingId === document.id ? 'Saving…' : 'Save'}
                            </button>
                            <button className="button button--quiet button--small" type="button" onClick={() => { setEditingId(null); setDraft(null) }} disabled={savingId === document.id}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className={`classification-pill classification-pill--${(document.classification ?? 'UNCLASSIFIED').toLowerCase()}`}>
                            {classificationLabel(document.classification)}
                          </span>
                          {document.volume_name && <small>{document.volume_name}</small>}
                          {document.classification_notes && <small>{document.classification_notes}</small>}
                        </>
                      )}
                    </td>
                    <td data-label="Integrity">
                      <span className="hash-value" title={document.sha256}>
                        {document.sha256 ? document.sha256.slice(0, 12) : 'Pending'}
                      </span>
                      {document.sha256 && (
                        <button className="text-button" type="button" onClick={() => void copyHash(document)}>
                          {copiedId === document.id ? 'Copied' : 'Copy full SHA-256'}
                        </button>
                      )}
                      {document.duplicate_of && <small>Duplicate of {document.duplicate_of.slice(0, 12)}…</small>}
                    </td>
                    <td data-label="Processing">
                      <span className={`status status--${document.status.toLowerCase()}`}>
                        <span aria-hidden="true" />{statusLabel(document.status)}
                      </span>
                      <small>{document.extraction_count ?? 0} extracted characters</small>
                    </td>
                    <td data-label="Actions" className="manifest-row-actions">
                      {projectId && document.status === 'EXTRACTED' && (
                        <button className="button button--quiet button--small" type="button" onClick={() => openPreview(document)}>View text</button>
                      )}
                      {projectId && !editing && (
                        <button className="button button--secondary button--small" type="button" onClick={() => beginEdit(document)}>Assign role</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {previewDocument && (
        <div className="document-preview" role="region" aria-labelledby="document-preview-title">
          <div className="document-preview__header">
            <div>
              <div className="section-kicker">Extracted source</div>
              <h3 id="document-preview-title">{previewDocument.name}</h3>
              {preview && <p>Characters {preview.start.toLocaleString()}–{preview.end.toLocaleString()} of {preview.total_characters.toLocaleString()}</p>}
            </div>
            <button className="button button--quiet" type="button" onClick={() => { setPreviewDocument(null); setPreview(null) }} aria-label="Close document text preview">Close</button>
          </div>
          {previewError ? <div className="inline-alert inline-alert--error" role="alert">{previewError}</div> : previewBusy ? (
            <p role="status">Loading extracted text…</p>
          ) : preview ? (
            <pre tabIndex={0}>{preview.text || 'No text was extracted from this file.'}</pre>
          ) : null}
          {preview && (
            <div className="document-preview__paging" aria-label="Document text pages">
              <button className="button button--quiet button--small" type="button" disabled={previewBusy || preview.start === 0} onClick={() => setPreviewStart(Math.max(0, preview.start - 20_000))}>Previous text</button>
              <button className="button button--quiet button--small" type="button" disabled={previewBusy || !preview.truncated} onClick={() => setPreviewStart(preview.end)}>Next text</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
