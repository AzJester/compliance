import { useState, type KeyboardEvent } from 'react'
import type { Project, ProjectDocument, ProjectView, UploadState } from '../types'
import { DocumentManifest } from './DocumentManifest'
import { DocumentUpload } from './DocumentUpload'
import { RequirementsWorkspace } from './RequirementsWorkspace'

interface ProjectOverviewProps {
  project: Project
  documents: ProjectDocument[]
  isLoadingDocuments: boolean
  documentError: string | null
  uploadState: UploadState
  uploadMessage: string | null
  isAnonymous: boolean
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

const projectViews: [ProjectView, string][] = [
  ['documents', 'Documents'],
  ['requirements', 'All Requirements'],
  ['section-l', 'Section L'],
  ['section-m', 'Section M'],
  ['cdrls', 'CDRLs'],
]

export function ProjectOverview({
  project,
  documents,
  isLoadingDocuments,
  documentError,
  uploadState,
  uploadMessage,
  isAnonymous,
  onUpload,
  onRefresh,
}: ProjectOverviewProps) {
  const [activeView, setActiveView] = useState<ProjectView>('documents')
  const extracted = documents.reduce((total, document) => total + (document.extraction_count ?? 0), 0)
  const attentionStatuses = new Set(['failed', 'error', 'needs_ocr'])
  const failures = documents.filter((document) => document.error || attentionStatuses.has(document.status.toLowerCase())).length

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % projectViews.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + projectViews.length) % projectViews.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = projectViews.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextView = projectViews[nextIndex][0]
    setActiveView(nextView)
    queueMicrotask(() => document.getElementById(`tab-${nextView}`)?.focus())
  }

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

      <nav className="workspace-tabs" aria-label="Project workspace views" role="tablist">
        {projectViews.map(([value, label], index) => (
          <button
            key={value}
            id={`tab-${value}`}
            type="button"
            role="tab"
            aria-selected={activeView === value}
            aria-controls="project-workspace-panel"
            tabIndex={activeView === value ? 0 : -1}
            onClick={() => setActiveView(value)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section
        className="workspace-tabpanel"
        id="project-workspace-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeView}`}
      >
        {activeView === 'documents' ? (
          <>
            <DocumentUpload
              state={uploadState}
              message={uploadMessage}
              isAnonymous={isAnonymous}
              onUpload={onUpload}
            />
            <DocumentManifest documents={documents} isLoading={isLoadingDocuments} error={documentError} onRefresh={onRefresh} />
          </>
        ) : (
          <RequirementsWorkspace key={project.id} projectId={project.id} view={activeView} />
        )}
      </section>
    </div>
  )
}
