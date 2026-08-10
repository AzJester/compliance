import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import type {
  DocumentProfileUpdate,
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
  onUpload: (files: File[], profile: DocumentProfileUpdate) => Promise<void>
  onRefresh: () => void
}

const workflowStageIds = new Set<WorkflowStageId>([
  'solicitation-files',
  'requirements',
  'proposal-compliance',
])

const legacyStageAliases: Record<string, WorkflowStageId> = {
  setup: 'solicitation-files',
  documents: 'solicitation-files',
  'verify-package': 'solicitation-files',
  'solicitation-files': 'solicitation-files',
  requirements: 'requirements',
  'proposal-response': 'proposal-compliance',
  crosswalk: 'proposal-compliance',
  reports: 'proposal-compliance',
  'proposal-compliance': 'proposal-compliance',
}

const requirementViews: [ProjectView, string][] = [
  ['requirements', 'All requirements'],
  ['section-l', 'Section L'],
  ['section-m', 'Section M'],
  ['cdrls', 'CDRLs'],
]

const attentionStatuses = new Set(['failed', 'error', 'needs_ocr'])

const persistedStage: Record<WorkflowStageId, PersistedWorkflowStage> = {
  'solicitation-files': 'SOLICITATION_FILES',
  requirements: 'REQUIREMENTS',
  'proposal-compliance': 'CROSSWALK',
}

const workflowStageDefinitions: Array<Pick<WorkflowStage, 'id' | 'label' | 'shortLabel'>> = [
  { id: 'solicitation-files', label: 'Solicitation', shortLabel: 'Solicitation' },
  { id: 'requirements', label: 'Requirements inventory', shortLabel: 'Requirements' },
  { id: 'proposal-compliance', label: 'Proposal compliance', shortLabel: 'Proposal compliance' },
]

const workflowStageIdByPersisted: Partial<Record<PersistedWorkflowStage, WorkflowStageId>> = {
  SOLICITATION_FILES: 'solicitation-files',
  REQUIREMENTS: 'requirements',
  CROSSWALK: 'proposal-compliance',
}

const nextActionLabel: Record<WorkflowStageId, string> = {
  'solicitation-files': 'Add solicitation documents',
  requirements: 'View requirements',
  'proposal-compliance': 'Assess proposal coverage',
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
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
  const requested = new URLSearchParams(window.location.search).get('stage')
  if (!requested) return 'solicitation-files'
  if (workflowStageIds.has(requested as WorkflowStageId)) return requested as WorkflowStageId
  return legacyStageAliases[requested] ?? 'solicitation-files'
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
}: ProjectOverviewProps) {
  const [activeStage, setActiveStage] = useState<WorkflowStageId>(stageFromUrl)
  const [activeRequirementView, setActiveRequirementView] = useState<ProjectView>('requirements')
  const [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null)
  const [readiness, setReadiness] = useState<ReadinessSummary | null>(null)
  const [readinessLoadState, setReadinessLoadState] = useState<'loading' | 'loaded' | 'unavailable'>('loading')
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [pipelinePhase, setPipelinePhase] = useState<'idle' | 'uploading' | 'extracting'>('idle')
  const [analysisRevision, setAnalysisRevision] = useState(0)
  const [isAnalysisBusy, setIsAnalysisBusy] = useState(false)
  const failures = documents.filter((document) => (
    document.error || attentionStatuses.has(document.status.toLowerCase())
  )).length
  const proposalDocuments = useMemo(
    () => documents.filter((document) => document.classification === 'PROPOSAL_VOLUME'),
    [documents],
  )
  const authoritativeReadiness = readiness?.project_id === project.id ? readiness : null

  const refreshProgress = useCallback(async () => {
    setReadiness(null)
    setReadinessLoadState('loading')
    const [workflowResult, readinessResult] = await Promise.allSettled([
      api.getWorkflow(project.id),
      api.getReadiness(project.id),
    ])
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
    void api.updateWorkflow(project.id, {
      stage: persistedStage[stage],
      status: stageStatus(stage),
      blocker_summary: null,
    }).then(setWorkflow).catch((reason: unknown) => {
      setWorkflowError(errorMessage(reason, 'Workflow progress could not be saved.'))
    })
    if (focusContent) queueMicrotask(() => document.getElementById('workflow-content')?.focus())
  }, [project.id, stageStatus])

  useEffect(() => {
    const syncFromHistory = () => setActiveStage(stageFromUrl())
    window.addEventListener('popstate', syncFromHistory)
    return () => window.removeEventListener('popstate', syncFromHistory)
  }, [])

  const stages = useMemo<WorkflowStage[]>(() => {
    const firstIncompleteIndex = workflowStageDefinitions.findIndex((definition) => (
      stageProgress(definition.id)?.status !== 'COMPLETE'
    ))
    return workflowStageDefinitions.map((definition, index) => {
    const progress = stageProgress(definition.id)
    if (progress) {
      if (progress.status !== 'COMPLETE' && firstIncompleteIndex >= 0 && index > firstIncompleteIndex) {
        return {
          ...definition,
          status: 'waiting',
          statusLabel: 'Waiting',
          statusDetail: 'Complete the prior step first.',
        }
      }
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
          ? 'Needs attention'
          : progress.status === 'IN_PROGRESS'
            ? `${progress.completed_items}/${progress.total_items} processed`
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
      : definition.id === 'proposal-compliance'
        ? proposalDocuments.length > 0
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
        ? 'Current processing status could not be loaded.'
        : 'Current processing status is loading.',
    }
    })
  }, [documents.length, failures, proposalDocuments.length, readinessLoadState, stageProgress])

  const nextAction = useMemo(() => {
    const blocked = authoritativeReadiness?.stages.find((stage) => stage.blocking_reasons.length > 0)
    const blockedStage = blocked ? workflowStageIdByPersisted[blocked.stage] : undefined
    if (blocked && blockedStage) {
      return {
        stage: blockedStage,
        label: nextActionLabel[blockedStage],
        description: blocked.blocking_reasons[0] ?? blocked.next_action ?? 'Review this step.',
      }
    }
    if (authoritativeReadiness?.ready) {
      return {
        stage: 'proposal-compliance' as const,
        label: 'Review assessment',
        description: 'The automated assessment found coverage for every active requirement.',
      }
    }
    if (documents.length === 0 || failures > 0) {
      return {
        stage: 'solicitation-files' as const,
        label: documents.length === 0 ? 'Add solicitation documents' : 'Resolve document issues',
        description: documents.length === 0
          ? 'Upload the solicitation package to begin.'
          : `${failures} ${failures === 1 ? 'file needs' : 'files need'} attention.`,
      }
    }
    return {
      stage: 'requirements' as const,
      label: 'View requirements',
      description: readinessLoadState === 'unavailable'
        ? 'Current processing status could not be loaded. Retry before relying on the assessment.'
        : 'Confirm that the requirement inventory has been extracted.',
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

  const uploadAndExtract = async (files: File[], profile: DocumentProfileUpdate) => {
    setPipelineError(null)
    setPipelinePhase('uploading')
    let uploadCompleted = false
    try {
      await onUpload(files, profile)
      uploadCompleted = true
      if (profile.classification === 'REFERENCE') {
        onRefresh()
        await refreshProgress()
        return
      }
      setPipelinePhase('extracting')
      await api.extractRequirements(project.id)
      onRefresh()
      await refreshProgress()
      navigateStage('requirements', true)
    } catch (reason) {
      if (!uploadCompleted) throw reason
      setPipelineError(`The files were uploaded, but requirement extraction failed: ${errorMessage(reason, 'unknown error')}`)
    } finally {
      setPipelinePhase('idle')
    }
  }

  const analysisComplete = () => {
    setAnalysisRevision((current) => current + 1)
    onRefresh()
    void refreshProgress()
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
          Progress is visible, but the selected step could not be saved: {workflowError}
        </div>
      )}
      {pipelineError && <div className="inline-alert inline-alert--error" role="alert">{pipelineError}</div>}
      {readinessLoadState === 'unavailable' && (
        <div className="inline-alert" role="status">
          Current processing status could not be loaded. The records remain available, but completion indicators may be stale.
        </div>
      )}
      {workflow && (
        <p className="visually-hidden" aria-live="polite">
          Saved workflow step {workflow.stage.replaceAll('_', ' ').toLowerCase()}, status {workflow.status.replaceAll('_', ' ').toLowerCase()}.
        </p>
      )}

      {activeStage !== nextAction.stage && (
        <aside className="next-action-bar" aria-label="Recommended next action">
          <div><span>Recommended next</span><strong>{nextAction.description}</strong></div>
          <button className="button button--primary" type="button" onClick={() => navigateStage(nextAction.stage, true)}>
            {nextAction.label} <span aria-hidden="true">→</span>
          </button>
        </aside>
      )}

      <div id="workflow-content" className="workflow-content" tabIndex={-1}>
        {activeStage === 'solicitation-files' && (
          <>
            <header className="stage-heading">
              <div>
                <div className="section-kicker">Step 1</div>
                <h2>Upload the solicitation</h2>
                <p>Files are processed and their requirements are extracted automatically after upload.</p>
              </div>
            </header>
            <DocumentUpload
              state={pipelinePhase === 'idle' ? uploadState : 'uploading'}
              message={uploadMessage}
              isAnonymous={isAnonymous}
              busyLabel={pipelinePhase === 'extracting' ? 'Extracting requirements…' : undefined}
              onUpload={uploadAndExtract}
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

        {activeStage === 'requirements' && (
          <section className="requirements-stage" aria-labelledby="requirements-stage-title">
            <header className="stage-heading">
              <div>
                <div className="section-kicker">Step 2</div>
                <h2 id="requirements-stage-title">Requirements inventory</h2>
                <p>Every extracted requirement is listed immediately. Open an item only when you need to correct or exclude it.</p>
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

        {activeStage === 'proposal-compliance' && (
          <section className="proposal-compliance-stage" aria-labelledby="proposal-compliance-title">
            <header className="stage-heading">
              <div>
                <div className="section-kicker">Step 3</div>
                <h2 id="proposal-compliance-title">Assess proposal compliance</h2>
                <p>Upload the proposal to compare it against every active solicitation requirement and surface only gaps that need attention.</p>
              </div>
            </header>
            <ProposalWorkspace
              projectId={project.id}
              documents={documents}
              isAnonymous={isAnonymous}
              isAnalysisBusy={isAnalysisBusy}
              onDocumentsChanged={onRefresh}
              onAnalysisBusyChange={setIsAnalysisBusy}
              onAnalysisComplete={analysisComplete}
            />
            <CrosswalkWorkspace
              key={`crosswalk:${project.id}:${analysisRevision}`}
              projectId={project.id}
              proposalDocuments={proposalDocuments}
              isAnalysisBusy={isAnalysisBusy}
              onAnalysisBusyChange={setIsAnalysisBusy}
              onContinue={analysisComplete}
            />
            <ReportsWorkspace key={`reports:${project.id}:${analysisRevision}`} projectId={project.id} />
          </section>
        )}
      </div>
    </div>
  )
}
