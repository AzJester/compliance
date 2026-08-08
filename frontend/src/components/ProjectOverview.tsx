import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import type {
  Project,
  ProjectDocument,
  ProjectView,
  ProjectWorkflow,
  ReadinessSummary,
  UploadState,
  WorkflowStage as PersistedWorkflowStage,
  WorkflowStatus,
} from '../types'
import { CrosswalkWorkspace } from './CrosswalkWorkspace'
import { DocumentManifest } from './DocumentManifest'
import { DocumentUpload } from './DocumentUpload'
import { PackageVerification } from './PackageVerification'
import { ProjectDashboard } from './ProjectDashboard'
import { ProposalWorkspace } from './ProposalWorkspace'
import { ReportsWorkspace } from './ReportsWorkspace'
import { RequirementsWorkspace } from './RequirementsWorkspace'
import {
  WorkflowRail,
  type WorkflowStage,
  type WorkflowStageId,
} from './WorkflowRail'

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
  onProjectUpdated: (project: Project) => void
}

const workflowStageIds = new Set<WorkflowStageId>([
  'setup',
  'solicitation-files',
  'verify-package',
  'requirements',
  'proposal-response',
  'crosswalk',
  'reports',
])

const requirementViews: [ProjectView, string][] = [
  ['requirements', 'All requirements'],
  ['section-l', 'Section L'],
  ['section-m', 'Section M'],
  ['cdrls', 'CDRLs'],
]

const attentionStatuses = new Set(['failed', 'error', 'needs_ocr'])

const persistedStage: Record<WorkflowStageId, PersistedWorkflowStage> = {
  setup: 'PROJECT_SETUP',
  'solicitation-files': 'SOLICITATION_FILES',
  'verify-package': 'VERIFY_PACKAGE',
  requirements: 'REQUIREMENTS',
  'proposal-response': 'PROPOSAL_RESPONSE',
  crosswalk: 'CROSSWALK',
  reports: 'REPORTS',
}

const workflowStageDefinitions: Array<Pick<WorkflowStage, 'id' | 'label' | 'shortLabel'>> = [
  { id: 'setup', label: 'Project Setup', shortLabel: 'Setup' },
  { id: 'solicitation-files', label: 'Solicitation Files', shortLabel: 'Files' },
  { id: 'verify-package', label: 'Verify Package', shortLabel: 'Verify' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'proposal-response', label: 'Proposal Response', shortLabel: 'Response' },
  { id: 'crosswalk', label: 'Crosswalk' },
  { id: 'reports', label: 'Reports' },
]

const workflowStageIdByPersisted = Object.fromEntries(
  Object.entries(persistedStage).map(([stage, persisted]) => [persisted, stage]),
) as Record<PersistedWorkflowStage, WorkflowStageId>

const nextActionLabel: Record<WorkflowStageId, string> = {
  setup: 'Complete project setup',
  'solicitation-files': 'Review solicitation files',
  'verify-package': 'Verify package',
  requirements: 'Review requirements',
  'proposal-response': 'Review proposal response',
  crosswalk: 'Review crosswalk',
  reports: 'Review readiness',
}

function dueDate(value?: string | null, timeZone?: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone && { timeZone }),
  }).format(new Date(value))
}

function stageFromUrl(): WorkflowStageId {
  const stage = new URLSearchParams(window.location.search).get('stage') as WorkflowStageId | null
  return stage && workflowStageIds.has(stage) ? stage : 'setup'
}

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
  onProjectUpdated,
}: ProjectOverviewProps) {
  const [activeStage, setActiveStage] = useState<WorkflowStageId>(stageFromUrl)
  const [activeRequirementView, setActiveRequirementView] = useState<ProjectView>('requirements')
  const [packageVerified, setPackageVerified] = useState(false)
  const [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null)
  const [readiness, setReadiness] = useState<ReadinessSummary | null>(null)
  const [readinessLoadState, setReadinessLoadState] = useState<'loading' | 'loaded' | 'unavailable'>('loading')
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const failures = documents.filter((document) => (
    document.error || attentionStatuses.has(document.status.toLowerCase())
  )).length
  const proposalDocuments = useMemo(
    () => documents.filter((document) => document.classification === 'PROPOSAL_VOLUME'),
    [documents],
  )
  const proposalDocumentCount = proposalDocuments.length
  const authoritativeReadiness = readiness?.project_id === project.id ? readiness : null

  const refreshProgress = useCallback(async () => {
    setReadiness(null)
    setReadinessLoadState('loading')
    const [verificationResult, workflowResult, readinessResult] = await Promise.allSettled([
      api.listIntakeVerifications(project.id),
      api.getWorkflow(project.id),
      api.getReadiness(project.id),
    ])
    if (verificationResult.status === 'fulfilled') {
      const records = verificationResult.value
      setPackageVerified(records.length > 0 && records.every((record) => (
        record.status === 'VERIFIED' || record.status === 'NOT_APPLICABLE'
      )))
    }
    if (workflowResult.status === 'fulfilled') setWorkflow(workflowResult.value)
    if (readinessResult.status === 'fulfilled') {
      setReadiness(readinessResult.value)
      setReadinessLoadState('loaded')
    } else {
      setReadinessLoadState('unavailable')
    }
  }, [project.id])

  useEffect(() => { void refreshProgress() }, [refreshProgress])

  const stageProgress = useCallback((stage: WorkflowStageId) => (
    authoritativeReadiness?.stages.find((item) => item.stage === persistedStage[stage]) ?? null
  ), [authoritativeReadiness])

  const stageStatus = useCallback((stage: WorkflowStageId): WorkflowStatus => (
    stageProgress(stage)?.status === 'COMPLETE' ? 'COMPLETE' : 'IN_PROGRESS'
  ), [stageProgress])

  const navigateStage = useCallback((stage: WorkflowStageId, focusContent = false) => {
    setActiveStage(stage)
    setWorkflowError(null)
    const url = new URL(window.location.href)
    url.searchParams.set('project', project.id)
    url.searchParams.set('stage', stage)
    window.history.replaceState(window.history.state, '', url)
    const status = stageStatus(stage)
    void api.updateWorkflow(project.id, {
      stage: persistedStage[stage],
      status,
      // Computed stage blockers stay visible in readiness. Persisting them as the
      // workflow's manual BLOCKED state would create a separate sticky blocker.
      blocker_summary: null,
    }).then(setWorkflow).catch((reason: unknown) => {
      setWorkflowError(reason instanceof Error ? reason.message : 'Workflow progress could not be saved.')
    })
    if (focusContent) queueMicrotask(() => document.getElementById('workflow-content')?.focus())
  }, [project.id, stageStatus])

  useEffect(() => {
    const syncFromHistory = () => setActiveStage(stageFromUrl())
    window.addEventListener('popstate', syncFromHistory)
    return () => window.removeEventListener('popstate', syncFromHistory)
  }, [])

  const stages = useMemo<WorkflowStage[]>(() => workflowStageDefinitions.map((definition) => {
    const progress = stageProgress(definition.id)
    if (progress) {
      const status = progress.status === 'COMPLETE'
        ? 'complete'
        : progress.status === 'BLOCKED'
          ? 'attention'
          : progress.status === 'NOT_STARTED'
            ? 'waiting'
            : 'ready'
      const statusLabel = progress.status === 'COMPLETE'
        ? 'Complete'
        : progress.status === 'BLOCKED'
          ? 'Blocked'
          : progress.status === 'IN_PROGRESS'
            ? `${progress.completed_items}/${progress.total_items} complete`
            : 'Waiting'
      return {
        ...definition,
        status,
        statusLabel,
        statusDetail: progress.blocking_reasons.join(' ') || progress.next_action || undefined,
      }
    }

    const hasLocalAttention = definition.id === 'solicitation-files' && failures > 0
    const hasLocalProgress = definition.id === 'solicitation-files'
      ? documents.length > 0
      : definition.id === 'verify-package'
        ? packageVerified
        : definition.id === 'proposal-response'
          ? proposalDocumentCount > 0
          : false
    return {
      ...definition,
      status: hasLocalAttention ? 'attention' : hasLocalProgress ? 'ready' : 'waiting',
      statusLabel: hasLocalAttention
        ? `${failures} issues`
        : readinessLoadState === 'unavailable'
          ? 'Status unavailable'
          : 'Checking progress',
      statusDetail: readinessLoadState === 'unavailable'
        ? 'Authoritative readiness could not be loaded.'
        : 'Authoritative readiness is loading.',
    }
  }), [documents.length, failures, packageVerified, proposalDocumentCount, readinessLoadState, stageProgress])

  const nextAction = useMemo(() => {
    const blocked = authoritativeReadiness?.stages.find((stage) => stage.blocking_reasons.length > 0)
    if (blocked) {
      const stage = workflowStageIdByPersisted[blocked.stage]
      return {
        stage,
        label: nextActionLabel[stage],
        description: blocked.blocking_reasons[0] ?? blocked.next_action ?? 'Review this workflow stage.',
      }
    }
    if (authoritativeReadiness) {
      return {
        stage: 'reports' as const,
        label: 'Review readiness',
        description: authoritativeReadiness.next_action ?? 'Review readiness and download the current compliance records.',
      }
    }
    if (documents.length === 0) {
      return { stage: 'solicitation-files' as const, label: 'Add solicitation files', description: 'No source package is registered yet.' }
    }
    if (failures > 0) {
      return { stage: 'solicitation-files' as const, label: 'Resolve document issues', description: `${failures} ${failures === 1 ? 'file needs' : 'files need'} attention.` }
    }
    return {
      stage: 'setup' as const,
      label: 'Review project setup',
      description: readinessLoadState === 'unavailable'
        ? 'Current readiness could not be loaded. Retry before relying on workflow completion.'
        : 'Authoritative readiness is still loading.',
    }
  }, [authoritativeReadiness, documents.length, failures, readinessLoadState])

  const navigateRequirementTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % requirementViews.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + requirementViews.length) % requirementViews.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = requirementViews.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextView = requirementViews[nextIndex][0]
    setActiveRequirementView(nextView)
    queueMicrotask(() => document.getElementById(`requirement-view-${nextView}`)?.focus())
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

      <WorkflowRail stages={stages} activeStage={activeStage} onChange={(stage) => navigateStage(stage, true)} />

      {workflowError && (
        <div className="inline-alert inline-alert--error" role="alert">
          Progress is visible, but could not be saved: {workflowError}
        </div>
      )}

      {readinessLoadState === 'unavailable' && (
        <div className="inline-alert" role="status">
          Current readiness could not be loaded. Workflow stages remain conservatively incomplete until the service responds.
        </div>
      )}

      {workflow && (
        <p className="visually-hidden" aria-live="polite">
          Saved workflow stage {workflow.stage.replaceAll('_', ' ').toLowerCase()}, status {workflow.status.replaceAll('_', ' ').toLowerCase()}.
        </p>
      )}

      {activeStage !== nextAction.stage && (
        <aside className="next-action-bar" aria-label="Recommended next action">
          <div>
            <span>Recommended next</span>
            <strong>{nextAction.description}</strong>
          </div>
          <button className="button button--primary" type="button" onClick={() => navigateStage(nextAction.stage, true)}>
            {nextAction.label} <span aria-hidden="true">→</span>
          </button>
        </aside>
      )}

      <div id="workflow-content" className="workflow-content" tabIndex={-1}>
        {activeStage === 'setup' && (
          <ProjectDashboard
            project={project}
            documents={documents}
            packageVerified={packageVerified}
            readiness={authoritativeReadiness}
            onNavigate={(stage) => navigateStage(stage, true)}
            onProjectUpdated={(updated) => {
              onProjectUpdated(updated)
              void refreshProgress()
            }}
          />
        )}

        {activeStage === 'solicitation-files' && (
          <>
            <DocumentUpload
              state={uploadState}
              message={uploadMessage}
              isAnonymous={isAnonymous}
              onUpload={onUpload}
            />
            <DocumentManifest
              documents={documents}
              isLoading={isLoadingDocuments}
              error={documentError}
              onRefresh={onRefresh}
              projectId={project.id}
              onDocumentsChanged={() => {
                onRefresh()
                void refreshProgress()
              }}
            />
          </>
        )}

        {activeStage === 'verify-package' && (
          <PackageVerification
            projectId={project.id}
            documents={documents}
            onVerified={() => {
              setPackageVerified(true)
              void refreshProgress()
              navigateStage('requirements', true)
            }}
          />
        )}

        {activeStage === 'requirements' && (
          <section className="requirements-stage" aria-labelledby="requirements-stage-title">
            <header className="stage-heading">
              <div>
                <div className="section-kicker">Solicitation obligations</div>
                <h2 id="requirements-stage-title">Review requirements</h2>
                <p>Verify each candidate against the source, then use the focused L, M, and CDRL views.</p>
              </div>
            </header>
            <nav className="requirement-view-tabs" aria-label="Requirement register views" role="tablist">
              {requirementViews.map(([view, label], index) => (
                <button
                  key={view}
                  id={`requirement-view-${view}`}
                  type="button"
                  role="tab"
                  aria-selected={activeRequirementView === view}
                  aria-controls="requirement-view-panel"
                  tabIndex={activeRequirementView === view ? 0 : -1}
                  onClick={() => setActiveRequirementView(view)}
                  onKeyDown={(event) => navigateRequirementTabs(event, index)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div id="requirement-view-panel" role="tabpanel" aria-labelledby={`requirement-view-${activeRequirementView}`}>
              <RequirementsWorkspace
                key={`${project.id}:${activeRequirementView}`}
                projectId={project.id}
                view={activeRequirementView}
                onProgressChanged={refreshProgress}
              />
            </div>
          </section>
        )}

        {activeStage === 'proposal-response' && (
          <ProposalWorkspace
            projectId={project.id}
            documents={documents}
            isAnonymous={isAnonymous}
            onDocumentsChanged={() => {
              onRefresh()
              void refreshProgress()
            }}
            onContinue={() => navigateStage('crosswalk', true)}
          />
        )}

        {activeStage === 'crosswalk' && (
          <CrosswalkWorkspace
            projectId={project.id}
            proposalDocuments={proposalDocuments}
            onContinue={() => {
              void refreshProgress()
            }}
          />
        )}

        {activeStage === 'reports' && (
          <ReportsWorkspace projectId={project.id} />
        )}
      </div>
    </div>
  )
}
