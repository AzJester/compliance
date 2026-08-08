import { useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import type {
  Project,
  ProjectDocument,
  SolicitationDetailCandidate,
  SolicitationDetailDecision,
  SolicitationDetailField,
  SolicitationDetailFieldKey,
  SolicitationDetailsAnalysis,
} from '../types'
import './solicitation-details-review.css'

interface SolicitationDetailsReviewProps {
  project: Project
  documents: ProjectDocument[]
  onProjectUpdated: (project: Project) => void
  onProgressChanged?: () => void
  onEditManually?: () => void
}

type LoadState = 'loading' | 'idle' | 'analyzing' | 'applying'

const fieldOrder: SolicitationDetailFieldKey[] = [
  'title',
  'solicitation_number',
  'agency',
  'due_at',
  'naics_code',
  'psc_code',
  'set_aside',
  'contract_type',
  'points_of_contact',
]

const analyzableRoles = new Set([
  'BASE_SOLICITATION',
  'AMENDMENT',
])

function confidencePercent(value: number) {
  return Math.round((value <= 1 ? value * 100 : value))
}

function analyzedDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function normalizedEntries(candidate: SolicitationDetailCandidate) {
  const preferredKeys = candidate.field_key === 'due_at'
    ? ['due_at', 'due_timezone', 'timezone', 'normalized_utc', 'utc']
    : ['display', 'value', 'name', 'email', 'phone']
  const entries = Object.entries(candidate.normalized_value ?? {})
    .filter(([, value]) => ['string', 'number'].includes(typeof value) && String(value).trim())
  return [...entries].sort(([left], [right]) => {
    const leftIndex = preferredKeys.indexOf(left)
    const rightIndex = preferredKeys.indexOf(right)
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
  })
}

function normalizedLabel(key: string) {
  const labels: Record<string, string> = {
    due_at: 'Normalized UTC',
    due_timezone: 'IANA timezone',
    normalized_utc: 'Normalized UTC',
    utc: 'Normalized UTC',
  }
  return labels[key] ?? key.replaceAll('_', ' ')
}

function contactLabel(contact: Record<string, unknown>) {
  const preferred = ['name', 'title', 'email', 'phone']
  const values = [...preferred, ...Object.keys(contact).filter((key) => !preferred.includes(key))]
    .flatMap((key) => {
      const value = contact[key]
      return ['string', 'number'].includes(typeof value) && String(value).trim() ? [String(value)] : []
    })
  return [...new Set(values)].join(' · ') || 'Saved contact'
}

function latestAppliedCandidateIds(
  decisions: SolicitationDetailDecision[],
  fieldKey: SolicitationDetailFieldKey,
) {
  const fieldDecisions = decisions.filter((decision) => decision.field_key === fieldKey)
  if (fieldDecisions.length === 0) return []
  const latest = fieldDecisions.reduce((current, decision) => (
    new Date(decision.applied_at).getTime() > new Date(current).getTime()
      ? decision.applied_at
      : current
  ), fieldDecisions[0].applied_at)
  return fieldDecisions
    .filter((decision) => decision.applied_at === latest)
    .map((decision) => decision.candidate_id)
}

function defaultSelections(analysis: SolicitationDetailsAnalysis) {
  return Object.fromEntries(analysis.fields.map((field) => {
    if (field.conflict || field.status === 'CONFLICT' || field.status === 'NEEDS_INPUT') {
      return [field.field_key, []]
    }
    const recommendedIds = new Set(field.recommended_candidate_ids)
    const recommended = field.candidates.filter((candidate) => (
      recommendedIds.has(candidate.id) && candidate.applicable && !candidate.needs_input
    ))
    if (field.repeatable) return [field.field_key, recommended.map((candidate) => candidate.id)]
    const selected = recommended[0]
      ?? field.candidates.find((candidate) => candidate.applicable && !candidate.needs_input)
    return [field.field_key, selected ? [selected.id] : []]
  })) as Partial<Record<SolicitationDetailFieldKey, string[]>>
}

export function SolicitationDetailsReview({
  project,
  documents,
  onProjectUpdated,
  onProgressChanged,
  onEditManually,
}: SolicitationDetailsReviewProps) {
  const [analysis, setAnalysis] = useState<SolicitationDetailsAnalysis | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selections, setSelections] = useState<Partial<Record<SolicitationDetailFieldKey, string[]>>>({})
  const [approvedFields, setApprovedFields] = useState<Set<SolicitationDetailFieldKey>>(new Set())
  const [reviewer, setReviewer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const hasAnalyzableDocuments = documents.some((document) => analyzableRoles.has(document.classification ?? ''))

  const acceptAnalysis = (next: SolicitationDetailsAnalysis) => {
    setAnalysis(next)
    setSelections(defaultSelections(next))
    setApprovedFields(new Set())
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoadState('loading')
      setError(null)
      try {
        const current = await api.getSolicitationDetails(project.id)
        if (!active) return
        acceptAnalysis(current)
        setLoadState('idle')
      } catch (reason) {
        if (!active) return
        if (reason instanceof ApiError && reason.status === 404) {
          if (!hasAnalyzableDocuments) {
            setAnalysis(null)
            setLoadState('idle')
            return
          }
          setLoadState('analyzing')
          try {
            const detected = await api.analyzeSolicitationDetails(project.id)
            if (!active) return
            acceptAnalysis(detected)
            setMessage('Solicitation details detected. Review each source before approving any change.')
          } catch (analyzeError) {
            if (active) setError(analyzeError instanceof Error ? analyzeError.message : 'Unable to analyze solicitation details.')
          } finally {
            if (active) setLoadState('idle')
          }
          return
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load detected solicitation details.')
        setLoadState('idle')
      }
    }
    void load()
    return () => { active = false }
    // A document upload remounts or changes this detector so the first eligible package is analyzed.
  }, [hasAnalyzableDocuments, project.id])

  const fields = useMemo(() => {
    if (!analysis) return []
    const byKey = new Map(analysis.fields.map((field) => [field.field_key, field]))
    return fieldOrder.flatMap((key) => {
      const field = byKey.get(key)
      return field ? [field] : []
    })
  }, [analysis])

  const detectedCount = fields.filter((field) => field.candidates.length > 0).length
  const conflictCount = fields.filter((field) => field.conflict || field.status === 'CONFLICT').length
  const approvedCount = approvedFields.size
  const latestDecision = useMemo(() => {
    if (!analysis?.decisions.length) return null
    return [...analysis.decisions].sort((left, right) => (
      new Date(right.applied_at).getTime() - new Date(left.applied_at).getTime()
    ))[0]
  }, [analysis])

  const analyze = async () => {
    setLoadState('analyzing')
    setError(null)
    setMessage(null)
    try {
      const detected = await api.analyzeSolicitationDetails(project.id)
      acceptAnalysis(detected)
      setMessage(`Analysis complete. ${detected.fields.filter((field) => field.candidates.length > 0).length} fields have source-backed candidates; nothing was applied.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to analyze solicitation details.')
    } finally {
      setLoadState('idle')
    }
  }

  const selectCandidate = (field: SolicitationDetailField, candidateId: string, checked: boolean) => {
    setSelections((current) => {
      const nextIds = field.repeatable
        ? checked
          ? [...new Set([...(current[field.field_key] ?? []), candidateId])]
          : (current[field.field_key] ?? []).filter((id) => id !== candidateId)
        : checked ? [candidateId] : []
      return { ...current, [field.field_key]: nextIds }
    })
    setApprovedFields((current) => {
      const next = new Set(current)
      next.delete(field.field_key)
      return next
    })
    setMessage(null)
  }

  const selectedCandidates = (field: SolicitationDetailField) => {
    const ids = new Set(selections[field.field_key] ?? [])
    return field.candidates.filter((candidate) => ids.has(candidate.id))
  }

  const canApproveField = (field: SolicitationDetailField) => {
    const selected = selectedCandidates(field)
    return selected.length > 0 && selected.every((candidate) => candidate.applicable && !candidate.needs_input)
  }

  const toggleApproval = (field: SolicitationDetailField, approved: boolean) => {
    setApprovedFields((current) => {
      const next = new Set(current)
      if (approved) next.add(field.field_key)
      else next.delete(field.field_key)
      return next
    })
    setMessage(null)
  }

  const applyApproved = async () => {
    if (!analysis) return
    setError(null)
    setMessage(null)
    if (analysis.stale) {
      setError('This analysis is stale. Run analysis again before applying any details.')
      return
    }
    if (!reviewer.trim()) {
      setError('Enter a reviewer name before applying approved details.')
      return
    }
    const approvals = fields.filter((field) => approvedFields.has(field.field_key)).map((field) => ({
      field_key: field.field_key,
      candidate_ids: selections[field.field_key] ?? [],
    }))
    if (approvals.length === 0) {
      setError('Approve at least one detected field before applying details.')
      return
    }
    const invalid = fields.find((field) => (
      approvedFields.has(field.field_key) && !canApproveField(field)
    ))
    if (invalid) {
      setError(`${invalid.label} needs an applicable candidate before it can be approved.`)
      return
    }

    setLoadState('applying')
    try {
      const result = await api.applySolicitationDetails(project.id, {
        reviewer: reviewer.trim(),
        expected_project_updated_at: analysis.project_updated_at,
        expected_profile_updated_at: analysis.profile_updated_at,
        run_id: analysis.run_id,
        approvals,
      })
      onProjectUpdated(result.project)
      acceptAnalysis(result.analysis)
      setMessage(`${result.applied_fields.length} approved ${result.applied_fields.length === 1 ? 'detail was' : 'details were'} applied atomically. Unapproved candidates were left unchanged.`)
      onProgressChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approved details could not be applied.')
    } finally {
      setLoadState('idle')
    }
  }

  const isBusy = loadState !== 'idle'

  return (
    <section className="product-panel solicitation-details" aria-labelledby="solicitation-details-title">
      <header className="product-panel__header solicitation-details__header">
        <div>
          <span className="product-eyebrow">Source-backed project setup</span>
          <h2 id="solicitation-details-title">Solicitation details detected</h2>
          <p>Compare each candidate with its exact source, select the right value, and approve only what you have verified.</p>
        </div>
        <button
          className="button button--secondary solicitation-details__analyze"
          type="button"
          onClick={() => void analyze()}
          disabled={isBusy || !hasAnalyzableDocuments}
        >
          {loadState === 'analyzing' ? 'Analyzing package…' : analysis ? 'Reanalyze package' : 'Analyze package'}
        </button>
      </header>

      <div className="solicitation-details__assurance" role="note">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Nothing changes until you approve.</strong>
          <p>Detection is advisory. Every applied field requires a selected source candidate, your approval, and a reviewer label.</p>
        </div>
      </div>
      <div className="solicitation-details__public-boundary" role="note">
        <strong>PUBLIC workspace only.</strong> Do not upload proprietary, CUI, ITAR-controlled, classified, customer, or source-selection material.
      </div>

      {analysis?.stale && (
        <div className="solicitation-details__stale" role="alert">
          <div><strong>Analysis is out of date</strong><span>The source package or project changed after this run. Reanalyze before applying details.</span></div>
          <button className="button button--secondary" type="button" onClick={() => void analyze()} disabled={isBusy}>Reanalyze now</button>
        </div>
      )}

      {error && <p className="product-error solicitation-details__message" role="alert">{error}</p>}
      {message && <p className="product-success solicitation-details__message" role="status">{message}</p>}

      {loadState === 'loading' || (loadState === 'analyzing' && !analysis) ? (
        <div className="solicitation-details__loading" aria-busy="true">
          <span aria-hidden="true" />
          <strong>{loadState === 'analyzing' ? 'Analyzing the solicitation package…' : 'Loading detected details…'}</strong>
          <p>Source files remain unchanged. No project details are applied during analysis.</p>
        </div>
      ) : !analysis ? (
        <div className="solicitation-details__empty">
          <div aria-hidden="true">RFP</div>
          <h3>{hasAnalyzableDocuments ? 'Ready to detect solicitation details' : 'Classify a solicitation source first'}</h3>
          <p>
            {hasAnalyzableDocuments
              ? 'Analyze the package to detect project details with exact source evidence.'
              : 'Upload or classify a base solicitation or amendment. Attachments, reference files, and unclassified files are never analyzed automatically.'}
          </p>
          {hasAnalyzableDocuments && <button className="button button--primary" type="button" onClick={() => void analyze()}>Analyze package</button>}
        </div>
      ) : (
        <>
          <div className="solicitation-details__summary" aria-label="Detection summary">
            <div><strong>{detectedCount}</strong><span>Fields detected</span></div>
            <div className={conflictCount ? 'has-attention' : ''}><strong>{conflictCount}</strong><span>Conflicts</span></div>
            <div><strong>{approvedCount}</strong><span>Approved to apply</span></div>
            <p>Analyzed {analyzedDate(analysis.analyzed_at)} <span>Rule {analysis.rule_version}</span></p>
          </div>

          <section className="solicitation-details__current" aria-labelledby="current-approved-profile-title">
            <header>
              <div>
                <h3 id="current-approved-profile-title">Current approved profile</h3>
                <p>Saved extended details are shown separately from unapproved detection candidates.</p>
              </div>
              {latestDecision && (
                <span>Last approved by {latestDecision.reviewer} (self-reported) · {analyzedDate(latestDecision.applied_at)}</span>
              )}
            </header>
            <dl>
              <div><dt>NAICS</dt><dd>{analysis.profile.naics_code || 'Not set'}</dd></div>
              <div><dt>PSC</dt><dd>{analysis.profile.psc_code || 'Not set'}</dd></div>
              <div><dt>Set-aside</dt><dd>{analysis.profile.set_aside || 'Not set'}</dd></div>
              <div><dt>Contract type</dt><dd>{analysis.profile.contract_type || 'Not set'}</dd></div>
              <div className="solicitation-details__current-contacts">
                <dt>Points of contact</dt>
                <dd>{analysis.profile.points_of_contact.length > 0
                  ? analysis.profile.points_of_contact.map((contact, index) => <span key={`${contactLabel(contact)}:${index}`}>{contactLabel(contact)}</span>)
                  : 'Not set'}</dd>
              </div>
            </dl>
          </section>

          <div className="solicitation-details__fields">
            {fields.map((field) => (
              <DetailFieldCard
                key={field.field_key}
                field={field}
                selectedIds={selections[field.field_key] ?? []}
                approved={approvedFields.has(field.field_key)}
                previouslyApplied={analysis.decisions.some((decision) => decision.field_key === field.field_key)}
                appliedCandidateIds={latestAppliedCandidateIds(analysis.decisions, field.field_key)}
                onSelect={(candidateId, checked) => selectCandidate(field, candidateId, checked)}
                onApprove={(approved) => toggleApproval(field, approved)}
              />
            ))}
          </div>

          <footer className="solicitation-details__apply">
            <div className="solicitation-details__reviewer">
              <label htmlFor="solicitation-details-reviewer">Reviewer name (self-reported) <span aria-hidden="true">*</span></label>
              <input
                id="solicitation-details-reviewer"
                value={reviewer}
                onChange={(event) => setReviewer(event.target.value)}
                disabled={loadState === 'applying'}
                autoComplete="off"
                required
              />
              <small>This anonymous deployment cannot verify reviewer identity.</small>
            </div>
            <div className="solicitation-details__apply-copy">
              <strong>{approvedCount ? `${approvedCount} ${approvedCount === 1 ? 'field' : 'fields'} ready to apply` : 'No fields approved yet'}</strong>
              <span>All approved changes are validated and saved together, or none are saved.</span>
            </div>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void applyApproved()}
              disabled={loadState === 'applying' || analysis.stale || approvedCount === 0}
            >
              {loadState === 'applying' ? 'Applying approved details…' : `Apply ${approvedCount || ''} approved ${approvedCount === 1 ? 'detail' : 'details'}`.replace('  ', ' ')}
            </button>
          </footer>

          <div className="solicitation-details__manual">
            <div>
              <strong>Detection is optional.</strong>
              <span>Leave false positives unapproved. Title, solicitation number, agency, and deadline can be corrected manually; extended profile fields change only through approved source candidates.</span>
            </div>
            {onEditManually && <button className="button button--quiet" type="button" onClick={onEditManually}>Edit core project details</button>}
          </div>
        </>
      )}
    </section>
  )
}

interface DetailFieldCardProps {
  field: SolicitationDetailField
  selectedIds: string[]
  approved: boolean
  previouslyApplied: boolean
  appliedCandidateIds: string[]
  onSelect: (candidateId: string, checked: boolean) => void
  onApprove: (approved: boolean) => void
}

function DetailFieldCard({
  field,
  selectedIds,
  approved,
  previouslyApplied,
  appliedCandidateIds,
  onSelect,
  onApprove,
}: DetailFieldCardProps) {
  const selected = new Set(selectedIds)
  const applied = new Set(appliedCandidateIds)
  const hasConflict = field.conflict || field.status === 'CONFLICT'
  const selectedCandidates = field.candidates.filter((candidate) => selected.has(candidate.id))
  const canApprove = selectedCandidates.length > 0 && selectedCandidates.every((candidate) => (
    candidate.applicable && !candidate.needs_input
  ))
  const statusLabel = field.status === 'NOT_FOUND'
    ? 'Not found'
    : field.status === 'NEEDS_INPUT'
      ? 'Needs input'
      : hasConflict
        ? 'Conflict'
        : 'Candidate found'

  return (
    <article className={`solicitation-detail-field solicitation-detail-field--${field.status.toLowerCase()}`} aria-labelledby={`detail-field-${field.field_key}`}>
      <header>
        <div>
          <span className="solicitation-detail-field__sequence" aria-hidden="true">{fieldOrder.indexOf(field.field_key) + 1}</span>
          <div>
            <h3 id={`detail-field-${field.field_key}`}>{field.label}</h3>
            <p>{field.repeatable ? 'Select every verified contact.' : 'Select one verified candidate.'}</p>
          </div>
        </div>
        <div className="solicitation-detail-field__badges">
          {previouslyApplied && <span className="detail-badge detail-badge--applied">Previously applied</span>}
          <span className={`detail-badge detail-badge--${field.status.toLowerCase()}`}>{statusLabel}</span>
        </div>
      </header>

      {hasConflict && (
        <div className="solicitation-detail-field__conflict" role="note">
          <strong>Sources disagree.</strong> Compare the base solicitation and amendment evidence, then explicitly choose the controlling value. No candidate is preselected.
        </div>
      )}

      {field.candidates.length === 0 ? (
        <div className="solicitation-detail-field__not-found">
          No source-backed candidate was detected. Leave this field unchanged or enter it manually in Project Setup.
        </div>
      ) : (
        <fieldset className="solicitation-detail-field__candidates">
          <legend className="visually-hidden">Candidates for {field.label}</legend>
          {field.candidates.map((candidate) => {
            const candidateSelected = selected.has(candidate.id)
            const candidateApplied = applied.has(candidate.id)
            const blocked = !candidate.applicable || Boolean(candidate.needs_input)
            const inputType = field.repeatable ? 'checkbox' : 'radio'
            return (
              <label key={candidate.id} className={`detail-candidate${candidateSelected ? ' detail-candidate--selected' : ''}${blocked ? ' detail-candidate--blocked' : ''}`}>
                <div className="detail-candidate__choice">
                  <input
                    type={inputType}
                    name={`solicitation-detail-${field.field_key}`}
                    checked={candidateSelected}
                    disabled={blocked}
                    onChange={(event) => onSelect(candidate.id, event.target.checked)}
                    aria-describedby={`candidate-source-${candidate.id}`}
                  />
                  <div>
                    <strong>{candidate.value}</strong>
                    <div className="detail-candidate__badges">
                      <span className={`confidence confidence--${candidate.confidence_level.toLowerCase()}`}>
                        {candidate.confidence_level.toLowerCase()} confidence · {confidencePercent(candidate.confidence)}%
                      </span>
                      {candidate.is_amendment && <span className="amendment-badge">Amendment source</span>}
                      {field.recommended_candidate_ids.includes(candidate.id) && !hasConflict && !blocked && <span className="recommended-badge">Recommended</span>}
                      {candidateApplied && <span className="applied-candidate-badge">Applied</span>}
                    </div>
                  </div>
                </div>

                {normalizedEntries(candidate).length > 0 && (
                  <dl className="detail-candidate__normalized">
                    {normalizedEntries(candidate).map(([key, value]) => (
                      <div key={key}><dt>{normalizedLabel(key)}</dt><dd>{String(value)}</dd></div>
                    ))}
                  </dl>
                )}

                {blocked && (
                  <div className="detail-candidate__blocked-reason" role="note">
                    <strong>{field.field_key === 'due_at' ? 'Timezone confirmation required' : 'Candidate needs more information'}</strong>
                    <span>{field.field_key === 'due_at'
                      ? 'The source does not provide an explicit, defensible timezone. This date cannot be applied automatically; enter it manually after confirmation.'
                      : 'This candidate is incomplete and cannot be applied automatically.'}</span>
                  </div>
                )}

                <div id={`candidate-source-${candidate.id}`} className="detail-source">
                  <div className="detail-source__heading">
                    <strong>Exact source evidence</strong>
                    <span>{candidate.document_classification.replaceAll('_', ' ')}</span>
                  </div>
                  <blockquote>{candidate.excerpt}</blockquote>
                  <dl>
                    <div><dt>Document</dt><dd>{candidate.document_name}</dd></div>
                    <div><dt>Location</dt><dd>{candidate.page_number != null ? `Page ${candidate.page_number} · ` : ''}{candidate.source_locator}</dd></div>
                    <div><dt>SHA-256</dt><dd><code>{candidate.document_sha256}</code></dd></div>
                    <div><dt>Why detected</dt><dd>{candidate.detection_rationale}</dd></div>
                  </dl>
                </div>
              </label>
            )
          })}
        </fieldset>
      )}

      <footer>
        <label className={`detail-approval${approved ? ' detail-approval--approved' : ''}`}>
          <input
            type="checkbox"
            checked={approved}
            disabled={!canApprove}
            onChange={(event) => onApprove(event.target.checked)}
          />
          <span><strong>Approve selected {field.repeatable ? 'values' : 'value'}</strong><small>I verified this selection against the source evidence.</small></span>
        </label>
        {!canApprove && field.candidates.length > 0 && <span className="detail-approval__hint">Select an applicable candidate to approve this field.</span>}
      </footer>
    </article>
  )
}
