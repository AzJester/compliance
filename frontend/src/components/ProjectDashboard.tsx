import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Project, ProjectDocument, ReadinessSummary, WorkflowStage } from '../types'
import type { WorkflowStageId } from './WorkflowRail'

interface ProjectDashboardProps {
  project: Project
  documents: ProjectDocument[]
  packageVerified: boolean
  readiness?: ReadinessSummary | null
  onNavigate: (stage: WorkflowStageId) => void
  onProjectUpdated: (project: Project) => void
}

const attentionStatuses = new Set(['failed', 'error', 'needs_ocr'])

const dashboardActionByStage: Record<WorkflowStage, { label: string; stage: WorkflowStageId }> = {
  PROJECT_SETUP: { label: 'Review project setup', stage: 'setup' },
  SOLICITATION_FILES: { label: 'Review solicitation files', stage: 'solicitation-files' },
  VERIFY_PACKAGE: { label: 'Verify package', stage: 'verify-package' },
  REQUIREMENTS: { label: 'Open requirements', stage: 'requirements' },
  PROPOSAL_RESPONSE: { label: 'Review proposal response', stage: 'proposal-response' },
  CROSSWALK: { label: 'Review crosswalk', stage: 'crosswalk' },
  REPORTS: { label: 'Review readiness', stage: 'reports' },
}

function formatDate(value?: string | null, timeZone?: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone && { timeZone }),
  }).format(new Date(value))
}

export function ProjectDashboard({
  project,
  documents,
  packageVerified,
  readiness,
  onNavigate,
  onProjectUpdated,
}: ProjectDashboardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(project.name)
  const [solicitationNumber, setSolicitationNumber] = useState(project.solicitation_number ?? '')
  const [agency, setAgency] = useState(project.agency ?? '')
  const [dueAt, setDueAt] = useState(toLocalDateTime(project.due_at))
  const [dueInputInvalid, setDueInputInvalid] = useState(false)
  const dueInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(project.name)
    setSolicitationNumber(project.solicitation_number ?? '')
    setAgency(project.agency ?? '')
    setDueAt(toLocalDateTime(project.due_at))
    setDueInputInvalid(false)
  }, [project])

  const failures = documents.filter((document) => (
    document.error || attentionStatuses.has(document.status.toLowerCase())
  )).length
  const completedStages = readiness
    ? readiness.stages.filter((stage) => stage.status === 'COMPLETE').length
    : 0
  const blockedStage = readiness?.stages.find((stage) => stage.blocking_reasons.length > 0)
  const nextAction = blockedStage
    ? {
        title: blockedStage.label,
        detail: blockedStage.blocking_reasons[0] ?? blockedStage.next_action ?? 'Review this workflow stage.',
        ...dashboardActionByStage[blockedStage.stage],
      }
    : readiness
      ? {
          title: readiness.ready ? 'Review final readiness' : 'Continue the workflow',
          detail: readiness.next_action ?? 'Review the current compliance status and remaining work.',
          label: 'Review readiness',
          stage: 'reports' as const,
        }
      : documents.length === 0
    ? {
        title: 'Add the solicitation package',
        detail: 'Import the base RFP, amendments, attachments, and exhibits.',
        label: 'Add solicitation files',
        stage: 'solicitation-files' as const,
      }
    : failures > 0
      ? {
          title: `Resolve ${failures} document ${failures === 1 ? 'issue' : 'issues'}`,
          detail: 'Review the manifest before marking the package ready.',
          label: 'Review document issues',
          stage: 'solicitation-files' as const,
        }
      : !packageVerified
        ? {
            title: 'Verify that the package is complete',
            detail: 'Confirm amendments, versions, and the PUBLIC-data boundary.',
            label: 'Verify package',
            stage: 'verify-package' as const,
          }
        : {
            title: 'Review extracted requirements',
            detail: 'Extract candidates and verify each one against its source.',
            label: 'Open requirements',
            stage: 'requirements' as const,
          }

  const saveProject = async () => {
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    if (dueInputInvalid || dueInputRef.current?.validity.badInput) {
      setError('Enter both a proposal due date and time, or clear the deadline field.')
      dueInputRef.current?.focus()
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const updated = await api.updateProject(project.id, {
        name: name.trim(),
        solicitation_number: solicitationNumber.trim() || null,
        agency: agency.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        due_timezone: dueAt ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      })
      onProjectUpdated(updated)
      setIsEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update project details.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="project-dashboard" aria-labelledby="dashboard-title">
      <div className="dashboard-hero">
        <div>
          <div className="section-kicker">Project dashboard</div>
          <h2 id="dashboard-title">Continue where you left off</h2>
          <p>Move through the guided workflow and resolve blockers before reporting readiness.</p>
        </div>
        <div className="dashboard-progress" aria-label={`${completedStages} of 7 workflow stages complete`}>
          <strong>{completedStages}<span>/7</span></strong>
          <small>stages complete</small>
          <progress max="7" value={completedStages}>{completedStages} of 7</progress>
        </div>
      </div>

      <div className="dashboard-grid">
        <article className="next-action-card">
          <span className="next-action-card__label">Recommended next action</span>
          <h3>{nextAction.title}</h3>
          <p>{nextAction.detail}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onNavigate(nextAction.stage)}
          >
            {nextAction.label} <span aria-hidden="true">→</span>
          </button>
        </article>

        <section className="readiness-card" aria-labelledby="readiness-title">
          <div className="readiness-card__heading">
            <h3 id="readiness-title">Intake readiness</h3>
            <span className={failures > 0 ? 'readiness-badge readiness-badge--attention' : 'readiness-badge'}>
              {failures > 0 ? 'Needs attention' : documents.length > 0 ? 'On track' : 'Not started'}
            </span>
          </div>
          <ul>
            <li className="is-complete"><span aria-hidden="true">✓</span>Project record created</li>
            <li className={documents.length > 0 ? 'is-complete' : ''}>
              <span aria-hidden="true">{documents.length > 0 ? '✓' : '2'}</span>
              {documents.length > 0
                ? `${documents.length} source ${documents.length === 1 ? 'file' : 'files'} registered`
                : 'Solicitation files not added'}
            </li>
            <li className={packageVerified ? 'is-complete' : failures > 0 ? 'has-attention' : ''}>
              <span aria-hidden="true">{packageVerified ? '✓' : failures > 0 ? '!' : '3'}</span>
              {packageVerified ? 'Package verification recorded' : failures > 0 ? 'Document issues need review' : 'Package verification pending'}
            </li>
          </ul>
        </section>
      </div>

      <details className="project-details">
        <summary>View or edit project details</summary>
        {isEditing ? (
          <div className="project-details-form">
            <label>Project name <span aria-hidden="true">*</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Solicitation number<input value={solicitationNumber} onChange={(event) => setSolicitationNumber(event.target.value)} /></label>
            <label>Agency or customer<input value={agency} onChange={(event) => setAgency(event.target.value)} /></label>
            <label>Proposal due date and time<input ref={dueInputRef} type="datetime-local" value={dueAt} onChange={(event) => { setDueInputInvalid(event.currentTarget.validity.badInput); setDueAt(event.target.value) }} aria-invalid={dueInputInvalid || undefined} /></label>
            <p className="project-details__note">Data boundary: {project.sensitivity}. This hosted demo accepts synthetic PUBLIC data only.</p>
            {error && <p className="inline-alert inline-alert--error" role="alert">{error}</p>}
            <div className="project-details-form__actions">
              <button className="button button--primary" type="button" disabled={isSaving} onClick={() => void saveProject()}>{isSaving ? 'Saving…' : 'Save details'}</button>
              <button
                className="button button--quiet"
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setName(project.name)
                  setSolicitationNumber(project.solicitation_number ?? '')
                  setAgency(project.agency ?? '')
                  setDueAt(toLocalDateTime(project.due_at))
                  setDueInputInvalid(false)
                  setError(null)
                  setIsEditing(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <dl>
              <div><dt>Project name</dt><dd>{project.name}</dd></div>
              <div><dt>Solicitation</dt><dd>{project.solicitation_number || 'Not set'}</dd></div>
              <div><dt>Agency</dt><dd>{project.agency || 'Not set'}</dd></div>
              <div><dt>Proposal due</dt><dd>{formatDate(project.due_at, project.due_timezone)}</dd></div>
              <div><dt>Data boundary</dt><dd>{project.sensitivity}</dd></div>
            </dl>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setName(project.name)
                  setSolicitationNumber(project.solicitation_number ?? '')
                  setAgency(project.agency ?? '')
                  setDueAt(toLocalDateTime(project.due_at))
                  setDueInputInvalid(false)
                  setError(null)
                  setIsEditing(true)
                }}
              >
                Edit project details
              </button>
          </>
        )}
      </details>
    </section>
  )
}

function toLocalDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
