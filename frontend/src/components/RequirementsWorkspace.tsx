import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type {
  CDRL,
  ExtractionSummary,
  ProjectView,
  Requirement,
  RequirementCategory,
  RequirementUpdate,
  ReviewDecision,
  SolicitationSection,
  ValidationStatus,
} from '../types'
import { CdrlRegister } from './CdrlRegister'
import { RequirementEditor, statusLabel } from './RequirementEditor'
import { RequirementRegister } from './RequirementRegister'
import './review-workspace.css'

interface RequirementsWorkspaceProps {
  projectId: string
  view: ProjectView
  onProgressChanged?: () => void | Promise<void>
}

type FilterPreset = {
  key: number
  label: string
  status: ValidationStatus | 'ALL'
  section: SolicitationSection | 'ALL'
  category: RequirementCategory | 'ALL'
}

const pendingPreset: FilterPreset = {
  key: 0,
  label: 'Pending review',
  status: 'PENDING',
  section: 'ALL',
  category: 'ALL',
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function RequirementsWorkspace({ projectId, view, onProgressChanged }: RequirementsWorkspaceProps) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [cdrls, setCdrls] = useState<CDRL[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [extractionSummary, setExtractionSummary] = useState<ExtractionSummary | null>(null)
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewDecision[]>([])
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)
  const [reviewRefresh, setReviewRefresh] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [dataProjectId, setDataProjectId] = useState(projectId)
  const [filterPreset, setFilterPreset] = useState<FilterPreset>(pendingPreset)
  const [reviewQueueIds, setReviewQueueIds] = useState<string[]>([])
  const [editorDirty, setEditorDirty] = useState(false)
  const mountedRef = useRef(true)
  const projectRef = useRef(projectId)
  const dataRequestRef = useRef(0)
  const reviewRequestRef = useRef(0)
  const selectedRequirementRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const loadingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    projectRef.current = projectId
    dataRequestRef.current += 1
    reviewRequestRef.current += 1
    hasLoadedRef.current = false
    loadingRef.current = false
    selectedRequirementRef.current = null
    savingRef.current = false
    setDataProjectId(projectId)
    setRequirements([])
    setCdrls([])
    setIsLoading(false)
    setLoadError(null)
    setIsExtracting(false)
    setExtractionError(null)
    setExtractionSummary(null)
    setSelectedRequirementId(null)
    setReviews([])
    setIsLoadingReviews(false)
    setIsSaving(false)
    setSaveError(null)
    setAnnouncement('')
    setFilterPreset(pendingPreset)
    setReviewQueueIds([])
    setEditorDirty(false)
    return () => {
      mountedRef.current = false
      dataRequestRef.current += 1
      reviewRequestRef.current += 1
      loadingRef.current = false
    }
  }, [projectId])

  useEffect(() => {
    reviewRequestRef.current += 1
    selectedRequirementRef.current = null
    setSelectedRequirementId(null)
    setReviews([])
    setIsLoadingReviews(false)
    setSaveError(null)
    setEditorDirty(false)
    setReviewQueueIds([])
    setFilterPreset((current) => ({ ...pendingPreset, key: current.key + 1 }))
  }, [view])

  const isCurrent = useCallback((requestProject: string) => (
    mountedRef.current && projectRef.current === requestProject
  ), [])

  const loadData = useCallback(async () => {
    if (loadingRef.current) return
    const requestProject = projectId
    const requestId = ++dataRequestRef.current
    loadingRef.current = true
    setIsLoading(true)
    setLoadError(null)
    try {
      const [nextRequirements, nextCdrls] = await Promise.all([
        api.listRequirements(requestProject),
        api.listCdrls(requestProject),
      ])
      if (!isCurrent(requestProject) || dataRequestRef.current !== requestId) return
      setRequirements(nextRequirements)
      setCdrls(nextCdrls)
      hasLoadedRef.current = true
    } catch (error) {
      if (!isCurrent(requestProject) || dataRequestRef.current !== requestId) return
      setLoadError(message(error, 'Unable to load requirements.'))
    } finally {
      if (isCurrent(requestProject) && dataRequestRef.current === requestId) {
        loadingRef.current = false
        setIsLoading(false)
      }
    }
  }, [isCurrent, projectId])

  useEffect(() => {
    if (view !== 'documents' && !hasLoadedRef.current) void loadData()
  }, [loadData, view])

  useEffect(() => {
    if (!selectedRequirementId) {
      setReviews([])
      setIsLoadingReviews(false)
      return
    }
    const requestProject = projectId
    const requirementId = selectedRequirementId
    const requestId = ++reviewRequestRef.current
    setIsLoadingReviews(true)
    setSaveError(null)
    void api.listRequirementReviews(requestProject, requirementId)
      .then((nextReviews) => {
        if (
          !isCurrent(requestProject) ||
          reviewRequestRef.current !== requestId ||
          selectedRequirementRef.current !== requirementId
        ) return
        setReviews(nextReviews)
      })
      .catch((error) => {
        if (!isCurrent(requestProject) || reviewRequestRef.current !== requestId) return
        setSaveError(message(error, 'Unable to load review history.'))
      })
      .finally(() => {
        if (isCurrent(requestProject) && reviewRequestRef.current === requestId) {
          setIsLoadingReviews(false)
        }
      })
  }, [isCurrent, projectId, reviewRefresh, selectedRequirementId])

  const extract = async () => {
    const requestProject = projectId
    const requestId = ++dataRequestRef.current
    loadingRef.current = true
    setIsExtracting(true)
    setExtractionError(null)
    setExtractionSummary(null)
    setLoadError(null)
    setAnnouncement(requirements.length > 0 ? 'Refreshing requirement candidates.' : 'Finding requirement candidates.')
    try {
      const summary = await api.extractRequirements(requestProject)
      if (!isCurrent(requestProject) || dataRequestRef.current !== requestId) return
      setExtractionSummary(summary)
      const [nextRequirements, nextCdrls] = await Promise.all([
        api.listRequirements(requestProject),
        api.listCdrls(requestProject),
      ])
      if (!isCurrent(requestProject) || dataRequestRef.current !== requestId) return
      setRequirements(nextRequirements)
      setCdrls(nextCdrls)
      hasLoadedRef.current = true
      setFilterPreset((current) => ({ ...pendingPreset, key: current.key + 1 }))
      const createdCopy = summary.requirements_created === 0 && summary.cdrls_created === 0
        ? 'No new records were created.'
        : `${summary.requirements_created} requirement candidates and ${summary.cdrls_created} CDRL records were created.`
      setAnnouncement(`Extraction complete. ${createdCopy}`)
      void onProgressChanged?.()
      const currentSelection = selectedRequirementRef.current
      const nextSelection = currentSelection && nextRequirements.some((item) => item.id === currentSelection)
        ? currentSelection
        : null
      selectedRequirementRef.current = nextSelection
      setSelectedRequirementId(nextSelection)
    } catch (error) {
      if (!isCurrent(requestProject) || dataRequestRef.current !== requestId) return
      setExtractionError(message(error, 'Requirement extraction failed.'))
    } finally {
      if (isCurrent(requestProject) && dataRequestRef.current === requestId) {
        loadingRef.current = false
        setIsExtracting(false)
        setIsLoading(false)
      }
    }
  }

  const saveRequirement = async (update: RequirementUpdate) => {
    const requirementId = selectedRequirementRef.current
    if (!requirementId || savingRef.current) return
    const requestProject = projectId
    savingRef.current = true
    setIsSaving(true)
    setSaveError(null)
    setAnnouncement('Saving requirement review.')
    try {
      const updated = await api.updateRequirement(requestProject, requirementId, update)
      if (!isCurrent(requestProject)) return
      setRequirements((current) => current.map((item) => item.id === updated.id ? updated : item))
      setCdrls((current) => current.map((cdrl) => (
        cdrl.requirement_id === updated.id || cdrl.linked_requirement_id === updated.id
          ? {
              ...cdrl,
              validation_status: updated.validation_status,
              reviewer: updated.reviewer,
              reviewed_at: updated.updated_at,
            }
          : cdrl
      )))
      setAnnouncement(`Requirement review saved as ${statusLabel(updated.validation_status).toLowerCase()}.`)
      void onProgressChanged?.()
      setEditorDirty(false)
      if (selectedRequirementRef.current === requirementId) {
        if (
          (view === 'section-l' && updated.section !== 'L') ||
          (view === 'section-m' && updated.section !== 'M')
        ) {
          selectedRequirementRef.current = null
          setSelectedRequirementId(null)
        } else {
          setReviewRefresh((current) => current + 1)
        }
      }
    } catch (error) {
      if (!isCurrent(requestProject) || selectedRequirementRef.current !== requirementId) return
      if (error instanceof ApiError && error.status === 409) {
        await loadData()
        if (!isCurrent(requestProject) || selectedRequirementRef.current !== requirementId) return
      }
      setSaveError(message(error, 'Unable to save the review decision.'))
    } finally {
      savingRef.current = false
      if (isCurrent(requestProject)) setIsSaving(false)
    }
  }

  const canLeaveEditor = useCallback(() => (
    !editorDirty || window.confirm('Discard your unsaved review changes?')
  ), [editorDirty])

  const selectRequirement = useCallback((requirementId: string) => {
    if (requirementId === selectedRequirementRef.current) return
    if (!canLeaveEditor()) return
    selectedRequirementRef.current = requirementId
    setSelectedRequirementId(requirementId)
    setSaveError(null)
    setEditorDirty(false)
  }, [canLeaveEditor])

  const selectedRequirement = requirements.find((item) => item.id === selectedRequirementId) ?? null

  const closeRequirementEditor = () => {
    if (!canLeaveEditor()) return
    const requirementId = selectedRequirementId
    selectedRequirementRef.current = null
    setSelectedRequirementId(null)
    setEditorDirty(false)
    if (!requirementId) return
    const originId = view === 'cdrls'
      ? `cdrl-review-${requirementId}`
      : `requirement-card-${requirementId}`
    queueMicrotask(() => document.getElementById(originId)?.focus())
  }

  const updateReviewQueue = useCallback((nextIds: string[]) => {
    setReviewQueueIds((current) => current.join('|') === nextIds.join('|') ? current : nextIds)
  }, [])

  const navigationIds = useMemo(() => {
    if (reviewQueueIds.length > 0) return reviewQueueIds
    if (view === 'cdrls') {
      return cdrls.flatMap((cdrl) => cdrl.requirement_id || cdrl.linked_requirement_id || []).filter((id, index, all) => all.indexOf(id) === index)
    }
    return requirements
      .filter((item) => view === 'section-l' ? item.section === 'L' : view === 'section-m' ? item.section === 'M' : true)
      .map((item) => item.id)
  }, [cdrls, requirements, reviewQueueIds, view])

  const selectedQueueIndex = selectedRequirementId ? navigationIds.indexOf(selectedRequirementId) : -1
  const navigateRequirement = (direction: -1 | 1) => {
    if (selectedQueueIndex < 0) return
    const nextId = navigationIds[selectedQueueIndex + direction]
    if (nextId) selectRequirement(nextId)
  }

  const counts = useMemo(() => ({
    total: requirements.length,
    pending: requirements.filter((item) => item.validation_status === 'PENDING').length,
    validated: requirements.filter((item) => item.validation_status === 'VALIDATED').length,
    dismissed: requirements.filter((item) => item.validation_status === 'DISMISSED').length,
    sectionL: requirements.filter((item) => item.section === 'L').length,
    sectionM: requirements.filter((item) => item.section === 'M').length,
    cdrls: cdrls.length,
  }), [cdrls.length, requirements])

  const applyFilterPreset = (
    label: string,
    status: ValidationStatus | 'ALL' = 'ALL',
    section: SolicitationSection | 'ALL' = 'ALL',
    category: RequirementCategory | 'ALL' = 'ALL',
  ) => {
    setFilterPreset((current) => ({ key: current.key + 1, label, status, section, category }))
    setAnnouncement(`${label} filter applied.`)
  }

  if (view === 'documents') return null

  if (dataProjectId !== projectId) {
    return (
      <div className="requirements-loading" aria-busy="true" aria-label="Switching requirement project">
        <span /><span /><span /><p>Switching compliance registers…</p>
      </div>
    )
  }

  const hasExistingRecords = requirements.length > 0 || cdrls.length > 0

  return (
    <div className="requirements-workspace">
      <div className="requirements-toolbar">
        <div>
          <div className="section-kicker">Compliance baseline</div>
          <h2>Requirement review workspace</h2>
          <p>Find requirement candidates, verify them against the source, and preserve each human decision.</p>
        </div>
        <button className="button button--primary extract-button" type="button" onClick={() => void extract()} disabled={isExtracting}>
          <span aria-hidden="true">⌁</span>
          {isExtracting
            ? 'Finding requirements…'
            : hasExistingRecords
              ? 'Re-run extraction'
              : 'Find requirements'}
        </button>
      </div>

      {(extractionError || loadError) && (
        <div className="requirements-alert requirements-alert--error" role="alert">
          <div><strong>Requirements unavailable</strong><span>{extractionError || loadError}</span></div>
          {loadError && <button className="button button--secondary" type="button" onClick={() => void loadData()}>Retry</button>}
        </div>
      )}

      {extractionSummary && (
        <section className="extraction-result" aria-labelledby="extraction-result-title" role="region">
          <div>
            <strong id="extraction-result-title">Extraction complete</strong>
            <span>
              {extractionSummary.documents_analyzed === 0
                ? 'No processed documents were available'
                : `${extractionSummary.documents_analyzed} documents analyzed`}
            </span>
          </div>
          <dl>
            <div><dt>New requirements</dt><dd>{extractionSummary.requirements_created}</dd></div>
            <div><dt>Existing requirements</dt><dd>{extractionSummary.requirements_reused}</dd></div>
            <div><dt>New CDRLs</dt><dd>{extractionSummary.cdrls_created}</dd></div>
            <div><dt>Existing CDRLs</dt><dd>{extractionSummary.cdrls_reused}</dd></div>
            <div><dt>Total requirements</dt><dd>{extractionSummary.total_requirements}</dd></div>
            <div><dt>Pending review</dt><dd>{extractionSummary.pending_requirements}</dd></div>
          </dl>
        </section>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      {extractionSummary?.documents_analyzed === 0 && (
        <div className="requirements-alert requirements-alert--warning" role="status">
          <div>
            <strong>No processed documents were available</strong>
            <span>Return to Solicitation Files and process document text before trying again.</span>
          </div>
        </div>
      )}

      <section className="requirement-summary" aria-label="Requirement review summary">
        <button type="button" aria-pressed={filterPreset.label === 'All requirements'} onClick={() => applyFilterPreset('All requirements')}>
          <span>Total</span><strong>{counts.total}</strong>
        </button>
        <button type="button" aria-pressed={filterPreset.label === 'Pending review'} onClick={() => applyFilterPreset('Pending review', 'PENDING')}>
          <span>Pending review</span><strong>{counts.pending}</strong>
        </button>
        <button type="button" aria-pressed={filterPreset.label === 'Verified'} onClick={() => applyFilterPreset('Verified', 'VALIDATED')}>
          <span>Verified</span><strong>{counts.validated}</strong>
        </button>
        <button type="button" aria-pressed={filterPreset.label === 'Not a requirement'} onClick={() => applyFilterPreset('Not a requirement', 'DISMISSED')}>
          <span>Not a requirement</span><strong>{counts.dismissed}</strong>
        </button>
        <button type="button" disabled={view !== 'requirements'} aria-pressed={filterPreset.label === 'Section L'} onClick={() => applyFilterPreset('Section L', 'ALL', 'L')}>
          <span>Section L</span><strong>{counts.sectionL}</strong>
        </button>
        <button type="button" disabled={view !== 'requirements'} aria-pressed={filterPreset.label === 'Section M'} onClick={() => applyFilterPreset('Section M', 'ALL', 'M')}>
          <span>Section M</span><strong>{counts.sectionM}</strong>
        </button>
        <button type="button" disabled={view !== 'requirements'} aria-pressed={filterPreset.label === 'CDRL requirements'} onClick={() => applyFilterPreset('CDRL requirements', 'ALL', 'ALL', 'CDRL')}>
          <span>CDRLs</span><strong>{counts.cdrls}</strong>
        </button>
      </section>

      {isLoading && !hasLoadedRef.current ? (
        <div className="requirements-loading" aria-busy="true" aria-label="Loading requirements">
          <span /><span /><span /><p>Loading compliance registers…</p>
        </div>
      ) : (
        <div className={selectedRequirement ? 'review-layout review-layout--open' : 'review-layout'}>
          <div className="review-layout__register">
            {view === 'cdrls' ? (
              <CdrlRegister
                projectId={projectId}
                cdrls={cdrls}
                onReviewRequirement={selectRequirement}
                onAdjudicationChanged={onProgressChanged}
                hasRequirements={requirements.length > 0}
                extractionAttempted={extractionSummary !== null}
                isExtracting={isExtracting}
              />
            ) : (
              <RequirementRegister
                key={`${view}-${filterPreset.key}`}
                requirements={requirements}
                view={view}
                selectedId={selectedRequirementId}
                onSelect={selectRequirement}
                initialStatus={filterPreset.status}
                initialSection={filterPreset.section}
                initialCategory={filterPreset.category}
                onVisibleRequirementsChange={updateReviewQueue}
              />
            )}
          </div>
          {selectedRequirement && (
            <RequirementEditor
              requirement={selectedRequirement}
              reviews={reviews}
              isLoadingReviews={isLoadingReviews}
              isSaving={isSaving}
              saveError={saveError}
              onSave={saveRequirement}
              onClose={closeRequirementEditor}
              position={selectedQueueIndex >= 0 ? selectedQueueIndex + 1 : undefined}
              total={navigationIds.length}
              hasPrevious={selectedQueueIndex > 0}
              hasNext={selectedQueueIndex >= 0 && selectedQueueIndex < navigationIds.length - 1}
              onPrevious={() => navigateRequirement(-1)}
              onNext={() => navigateRequirement(1)}
              onDirtyChange={setEditorDirty}
            />
          )}
        </div>
      )}
    </div>
  )
}
