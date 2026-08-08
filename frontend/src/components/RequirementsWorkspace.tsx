import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type {
  CDRL,
  ExtractionSummary,
  ProjectView,
  Requirement,
  RequirementUpdate,
  ReviewDecision,
} from '../types'
import { CdrlRegister } from './CdrlRegister'
import { RequirementEditor } from './RequirementEditor'
import { RequirementRegister } from './RequirementRegister'

interface RequirementsWorkspaceProps {
  projectId: string
  view: ProjectView
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function RequirementsWorkspace({ projectId, view }: RequirementsWorkspaceProps) {
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
          selectedRequirementId !== requirementId
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
    setAnnouncement('Extracting requirements.')
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
      setAnnouncement(
        `Extraction complete: ${summary.requirements_created} requirements and ${summary.cdrls_created} CDRL records created.`,
      )
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
      setAnnouncement(`Requirement review saved as ${updated.validation_status.toLowerCase()}.`)
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

  const selectRequirement = (requirementId: string) => {
    selectedRequirementRef.current = requirementId
    setSelectedRequirementId(requirementId)
    setSaveError(null)
  }

  const selectedRequirement = requirements.find((item) => item.id === selectedRequirementId) ?? null
  const closeRequirementEditor = () => {
    const requirementId = selectedRequirementId
    selectedRequirementRef.current = null
    setSelectedRequirementId(null)
    if (!requirementId) return
    const originId = view === 'cdrls'
      ? `cdrl-review-${requirementId}`
      : `requirement-card-${requirementId}`
    queueMicrotask(() => document.getElementById(originId)?.focus())
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

  if (view === 'documents') return null

  if (dataProjectId !== projectId) {
    return (
      <div className="requirements-loading" aria-busy="true" aria-label="Switching requirement project">
        <span /><span /><span /><p>Switching compliance registers…</p>
      </div>
    )
  }

  return (
    <div className="requirements-workspace">
      <div className="requirements-toolbar">
        <div>
          <div className="section-kicker">Compliance baseline</div>
          <h2>Requirement review workspace</h2>
          <p>Extract, classify, validate, and preserve every decision with exact source evidence.</p>
        </div>
        <button className="button button--primary extract-button" type="button" onClick={() => void extract()} disabled={isExtracting}>
          <span aria-hidden="true">⌁</span>
          {isExtracting ? 'Extracting requirements…' : 'Extract requirements'}
        </button>
      </div>

      {(extractionError || loadError) && (
        <div className="requirements-alert requirements-alert--error" role="alert">
          <div><strong>Requirements unavailable</strong><span>{extractionError || loadError}</span></div>
          {loadError && <button className="button button--secondary" type="button" onClick={() => void loadData()}>Retry</button>}
        </div>
      )}

      {extractionSummary && (
        <section
          className="extraction-result"
          aria-labelledby="extraction-result-title"
          role="region"
        >
          <div>
            <strong id="extraction-result-title">Extraction complete</strong>
            <span>{extractionSummary.documents_analyzed} documents analyzed</span>
          </div>
          <dl>
            <div><dt>Requirements created</dt><dd>{extractionSummary.requirements_created}</dd></div>
            <div><dt>Requirements reused</dt><dd>{extractionSummary.requirements_reused}</dd></div>
            <div><dt>CDRLs created</dt><dd>{extractionSummary.cdrls_created}</dd></div>
            <div><dt>CDRLs reused</dt><dd>{extractionSummary.cdrls_reused}</dd></div>
            <div><dt>Total requirements</dt><dd>{extractionSummary.total_requirements}</dd></div>
            <div><dt>Pending review</dt><dd>{extractionSummary.pending_requirements}</dd></div>
          </dl>
        </section>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {extractionSummary?.documents_analyzed === 0 && (
        <div className="requirements-alert requirements-alert--warning" role="status">
          <div>
            <strong>No extracted documents were available</strong>
            <span>Complete document text extraction before running requirement extraction again.</span>
          </div>
        </div>
      )}

      <section className="requirement-summary" aria-label="Requirement review summary">
        <article><span>Total</span><strong>{counts.total}</strong></article>
        <article><span>Pending</span><strong>{counts.pending}</strong></article>
        <article><span>Validated</span><strong>{counts.validated}</strong></article>
        <article><span>Dismissed</span><strong>{counts.dismissed}</strong></article>
        <article><span>Section L</span><strong>{counts.sectionL}</strong></article>
        <article><span>Section M</span><strong>{counts.sectionM}</strong></article>
        <article><span>CDRLs</span><strong>{counts.cdrls}</strong></article>
      </section>

      {isLoading && !hasLoadedRef.current ? (
        <div className="requirements-loading" aria-busy="true" aria-label="Loading requirements">
          <span /><span /><span /><p>Loading compliance registers…</p>
        </div>
      ) : (
        <div className={selectedRequirement ? 'review-layout review-layout--open' : 'review-layout'}>
          <div className="review-layout__register">
            {view === 'cdrls' ? (
              <CdrlRegister cdrls={cdrls} onReviewRequirement={selectRequirement} />
            ) : (
              <RequirementRegister
                key={view}
                requirements={requirements}
                view={view}
                selectedId={selectedRequirementId}
                onSelect={selectRequirement}
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
            />
          )}
        </div>
      )}
    </div>
  )
}
