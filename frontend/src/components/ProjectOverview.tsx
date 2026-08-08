import type { Project, ProjectDocument, UploadState } from '../types'
import { DocumentManifest } from './DocumentManifest'
import { DocumentUpload } from './DocumentUpload'

interface ProjectOverviewProps {
  project: Project
  documents: ProjectDocument[]
  isLoadingDocuments: boolean
  documentError: string | null
  uploadState: UploadState
  uploadMessage: string | null
  onUpload: (files: File[]) => Promise<void>
  onRefresh: () => void
}

function dueDate(value?: string | null, timeZone?: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone && { timeZone }),
  }).format(new Date(value))
}

export function ProjectOverview({
  project,
  documents,
  isLoadingDocuments,
  documentError,
  uploadState,
  uploadMessage,
  onUpload,
  onRefresh,
}: ProjectOverviewProps) {
  const extracted = documents.reduce((total, document) => total + (document.extraction_count ?? 0), 0)
  const attentionStatuses = new Set(['failed', 'error', 'needs_ocr'])
  const failures = documents.filter((document) => document.error || attentionStatuses.has(document.status.toLowerCase())).length

  return (
    <div className="project-overview">
      <header className="project-header">
        <div>
          <div className="project-header__eyebrow">
            <span className={`sensitivity sensitivity--${project.sensitivity.toLowerCase()}`}>{project.sensitivity}</span>
            <span>{project.solicitation_number || 'Solicitation number pending'}</span>
          </div>
          <h1>{project.name}</h1>
          <p>{project.agency || 'Agency not specified'}</p>
        </div>
        <dl className="deadline">
          <div>
            <dt>Proposal due</dt>
            <dd>{dueDate(project.due_at, project.due_timezone)}</dd>
            {project.due_at && <small>{project.due_timezone || 'Local time zone'}</small>}
          </div>
        </dl>
      </header>

      <section className="metrics" aria-label="Project intake summary">
        <article><span>01</span><div><strong>{documents.length}</strong><small>Source files</small></div></article>
        <article><span>02</span><div><strong>{extracted.toLocaleString()}</strong><small>Extracted characters</small></div></article>
        <article><span>03</span><div><strong>{failures}</strong><small>Needs attention</small></div></article>
        <article className="metrics__next"><span>Next</span><div><strong>Validate intake</strong><small>Before requirement extraction</small></div></article>
      </section>

      <DocumentUpload state={uploadState} message={uploadMessage} onUpload={onUpload} />
      <DocumentManifest documents={documents} isLoading={isLoadingDocuments} error={documentError} onRefresh={onRefresh} />
    </div>
  )
}
