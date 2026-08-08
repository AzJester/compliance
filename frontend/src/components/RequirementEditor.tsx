import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Applicability,
  ObligationOwner,
  Requirement,
  RequirementCategory,
  RequirementUpdate,
  ReviewDecision,
  SolicitationSection,
  ValidationStatus,
} from '../types'

export const sections: SolicitationSection[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'UNKNOWN',
]

export const categories: RequirementCategory[] = [
  'GENERAL', 'SUBMISSION_INSTRUCTION', 'EVALUATION_FACTOR', 'CDRL', 'CLAUSE',
  'DELIVERABLE', 'SCHEDULE', 'STAFFING', 'SECURITY', 'DATA_RIGHTS', 'PRICING',
  'REPRESENTATION',
]

const owners: ObligationOwner[] = [
  'OFFEROR', 'CONTRACTOR', 'SUBCONTRACTOR', 'GOVERNMENT', 'INFORMATIONAL',
]
const applicabilityOptions: Applicability[] = [
  'SOLICITATION', 'PROPOSAL', 'POST_AWARD', 'INFORMATIONAL',
]

const reviewerStorageKey = 'compliance:last-reviewer'

export function enumLabel(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function statusLabel(status: ValidationStatus | string) {
  if (status === 'VALIDATED') return 'Verified'
  if (status === 'DISMISSED') return 'Not a requirement'
  if (status === 'PENDING') return 'Pending review'
  return enumLabel(status)
}

function rememberedReviewer() {
  try {
    return window.sessionStorage.getItem(reviewerStorageKey) ?? ''
  } catch {
    return ''
  }
}

function reviewStatus(review: ReviewDecision) {
  const stateStatus = review.new_state?.validation_status
  const status = typeof stateStatus === 'string'
    ? stateStatus
    : review.new_status || review.validation_status || review.action || 'Updated'
  return statusLabel(status)
}

interface RequirementEditorProps {
  requirement: Requirement
  reviews: ReviewDecision[]
  isLoadingReviews: boolean
  isSaving: boolean
  saveError: string | null
  onSave: (update: RequirementUpdate) => Promise<void>
  onClose: () => void
  position?: number
  total?: number
  hasPrevious?: boolean
  hasNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  onDirtyChange?: (isDirty: boolean) => void
}

type FieldErrors = {
  requirementText?: string
  reviewer?: string
  dismissalReason?: string
}

export function RequirementEditor({
  requirement,
  reviews,
  isLoadingReviews,
  isSaving,
  saveError,
  onSave,
  onClose,
  position,
  total,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  onDirtyChange,
}: RequirementEditorProps) {
  const [requirementText, setRequirementText] = useState(requirement.requirement_text)
  const [section, setSection] = useState(requirement.section)
  const [category, setCategory] = useState(requirement.category)
  const [owner, setOwner] = useState(requirement.obligation_owner)
  const [applicability, setApplicability] = useState(requirement.applicability)
  const [reviewer, setReviewer] = useState(requirement.reviewer ?? rememberedReviewer())
  const [reviewNote, setReviewNote] = useState(requirement.validation_status === 'DISMISSED' ? '' : requirement.review_note ?? '')
  const [dismissalReason, setDismissalReason] = useState(requirement.dismissal_reason ?? (requirement.validation_status === 'DISMISSED' ? requirement.review_note ?? '' : ''))
  const [dismissMode, setDismissMode] = useState(requirement.validation_status === 'DISMISSED')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const reviewerRef = useRef<HTMLInputElement>(null)
  const dismissalReasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setRequirementText(requirement.requirement_text)
    setSection(requirement.section)
    setCategory(requirement.category)
    setOwner(requirement.obligation_owner)
    setApplicability(requirement.applicability)
    setReviewer(requirement.reviewer ?? rememberedReviewer())
    setReviewNote(requirement.validation_status === 'DISMISSED' ? '' : requirement.review_note ?? '')
    setDismissalReason(requirement.dismissal_reason ?? (requirement.validation_status === 'DISMISSED' ? requirement.review_note ?? '' : ''))
    setDismissMode(requirement.validation_status === 'DISMISSED')
    setFieldErrors({})
  }, [requirement.id, requirement.updated_at])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [requirement.id])

  const isDirty = useMemo(() => (
    requirementText !== requirement.requirement_text ||
    section !== requirement.section ||
    category !== requirement.category ||
    owner !== requirement.obligation_owner ||
    applicability !== requirement.applicability ||
    reviewer !== (requirement.reviewer ?? rememberedReviewer()) ||
    reviewNote !== (requirement.validation_status === 'DISMISSED' ? '' : requirement.review_note ?? '') ||
    dismissalReason !== (requirement.dismissal_reason ?? (requirement.validation_status === 'DISMISSED' ? requirement.review_note ?? '' : ''))
  ), [applicability, category, dismissalReason, owner, requirement, requirementText, reviewNote, reviewer, section])

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (!isDirty) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [isDirty])

  const save = async (validationStatus: ValidationStatus) => {
    const nextErrors: FieldErrors = {}
    if (!requirementText.trim()) nextErrors.requirementText = 'Requirement text is required.'
    if (!reviewer.trim()) nextErrors.reviewer = 'Reviewer name is required.'
    if (validationStatus === 'DISMISSED' && !dismissalReason.trim()) {
      nextErrors.dismissalReason = 'Explain why this is not a requirement.'
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      queueMicrotask(() => {
        if (nextErrors.requirementText) document.getElementById('requirement-text')?.focus()
        else if (nextErrors.reviewer) reviewerRef.current?.focus()
        else dismissalReasonRef.current?.focus()
      })
      return
    }

    try {
      window.sessionStorage.setItem(reviewerStorageKey, reviewer.trim())
    } catch {
      // The review can still be saved when browser storage is unavailable.
    }
    await onSave({
      requirement_text: requirementText.trim(),
      section,
      category,
      obligation_owner: owner,
      applicability,
      validation_status: validationStatus,
      reviewer: reviewer.trim(),
      expected_updated_at: requirement.updated_at,
      review_note: validationStatus === 'DISMISSED'
        ? dismissalReason.trim()
        : reviewNote.trim() || null,
    })
  }

  const startDismissal = () => {
    if (!dismissMode) {
      setDismissMode(true)
      setFieldErrors((current) => ({
        ...current,
        dismissalReason: dismissalReason.trim() ? undefined : 'Explain why this is not a requirement.',
      }))
      queueMicrotask(() => dismissalReasonRef.current?.focus())
      return
    }
    void save('DISMISSED')
  }

  const duplicateEvidence = requirement.source_text.trim() === requirementText.trim()
  const hasFieldErrors = Boolean(
    fieldErrors.requirementText || fieldErrors.reviewer || fieldErrors.dismissalReason,
  )

  return (
    <aside className="requirement-editor" role="dialog" aria-labelledby="requirement-editor-title" aria-modal="true">
      <div className="requirement-editor__heading">
        <div>
          <div className="section-kicker">Human review</div>
          <h3 id="requirement-editor-title">Review requirement</h3>
          {position && total && <p className="review-position">Requirement {position} of {total} in this queue</p>}
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close requirement review" onClick={onClose}>×</button>
      </div>

      <div className="review-navigation" aria-label="Requirement navigation">
        <button type="button" className="button button--secondary" disabled={!hasPrevious || isSaving} onClick={onPrevious}>← Previous</button>
        <button type="button" className="button button--secondary" disabled={!hasNext || isSaving} onClick={onNext}>Next →</button>
      </div>

      <details className="source-evidence" open={!duplicateEvidence}>
        <summary>
          <strong>Source excerpt</strong>
          <span>{requirement.document_name || 'Source document'}</span>
        </summary>
        {duplicateEvidence && <p className="duplicate-evidence-note">The source excerpt matches the requirement text.</p>}
        <blockquote>{requirement.source_text}</blockquote>
        <p>{requirement.source_locator || 'Locator unavailable'}</p>
      </details>

      <details className="evidence-metadata">
        <summary>Detection details</summary>
        <div>
          <span>Confidence <strong>{Math.round(requirement.confidence * 100)}%</strong></span>
          <span>Rule <strong>{requirement.rule_version || 'Unspecified'}</strong></span>
          <span>Method <strong>{enumLabel(requirement.extraction_method || 'Unspecified')}</strong></span>
        </div>
      </details>

      <form className="review-form" onSubmit={(event) => event.preventDefault()} noValidate>
        <label htmlFor="requirement-text">
          Requirement text <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="requirement-text"
          value={requirementText}
          onChange={(event) => {
            setRequirementText(event.target.value)
            setFieldErrors((current) => ({ ...current, requirementText: undefined }))
          }}
          rows={5}
          required
          aria-invalid={Boolean(fieldErrors.requirementText)}
          aria-describedby={fieldErrors.requirementText ? 'requirement-text-error' : undefined}
        />
        {fieldErrors.requirementText && <small id="requirement-text-error" className="field-error">{fieldErrors.requirementText}</small>}

        <div className="review-form__grid">
          <label>
            Section
            <select value={section} onChange={(event) => setSection(event.target.value as SolicitationSection)}>
              {sections.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as RequirementCategory)}>
              {categories.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
            </select>
          </label>
          <label>
            Who must act
            <select value={owner} onChange={(event) => setOwner(event.target.value as ObligationOwner)}>
              {owners.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
            </select>
          </label>
          <label>
            When this applies
            <select value={applicability} onChange={(event) => setApplicability(event.target.value as Applicability)}>
              {applicabilityOptions.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
            </select>
          </label>
        </div>

        <label htmlFor="reviewer">
          Reviewer <span aria-hidden="true">*</span>
        </label>
        <input
          ref={reviewerRef}
          id="reviewer"
          value={reviewer}
          onChange={(event) => {
            setReviewer(event.target.value)
            setFieldErrors((current) => ({ ...current, reviewer: undefined }))
          }}
          autoComplete="name"
          required
          aria-invalid={Boolean(fieldErrors.reviewer)}
          aria-describedby={fieldErrors.reviewer ? 'reviewer-error' : 'reviewer-help'}
        />
        <small id="reviewer-help">Required for the review history. This label is self-reported on the public demo.</small>
        {fieldErrors.reviewer && <small id="reviewer-error" className="field-error">{fieldErrors.reviewer}</small>}

        <label>
          Review note
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} />
        </label>

        {dismissMode && (
          <div className="dismissal-panel">
            <label htmlFor="dismissal-reason">
              Why is this not a requirement? <span aria-hidden="true">*</span>
            </label>
            <textarea
              ref={dismissalReasonRef}
              id="dismissal-reason"
              value={dismissalReason}
              onChange={(event) => {
                setDismissalReason(event.target.value)
                setFieldErrors((current) => ({ ...current, dismissalReason: undefined }))
              }}
              rows={3}
              required
              aria-invalid={Boolean(fieldErrors.dismissalReason)}
              aria-describedby={fieldErrors.dismissalReason ? 'dismissal-reason-error' : 'dismissal-reason-help'}
            />
            <small id="dismissal-reason-help">The reason is preserved in the review history.</small>
            {fieldErrors.dismissalReason && <small id="dismissal-reason-error" className="field-error">{fieldErrors.dismissalReason}</small>}
          </div>
        )}

        {(hasFieldErrors || saveError) && (
          <p className="inline-error" role="alert">
            {saveError || 'Correct the highlighted fields before saving.'}
          </p>
        )}
      </form>

      <section className="review-history" aria-labelledby="review-history-title">
        <h4 id="review-history-title">Review history</h4>
        {isLoadingReviews ? (
          <p aria-busy="true">Loading decisions…</p>
        ) : reviews.length === 0 ? (
          <p>No prior review decisions.</p>
        ) : (
          <ol>
            {reviews.map((review) => (
              <li key={review.id}>
                <div>
                  <strong>{reviewStatus(review)}</strong>
                  <span>{review.reviewer || 'Unassigned reviewer'}</span>
                </div>
                {(review.note || review.review_note || review.dismissal_reason) && <p>{review.note || review.review_note || review.dismissal_reason}</p>}
                <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleString()}</time>
                {review.previous_state && review.new_state && (
                  <details className="review-history__changes">
                    <summary>View recorded before and after state</summary>
                    <div>
                      <section>
                        <strong>Before</strong>
                        <pre>{JSON.stringify(review.previous_state, null, 2)}</pre>
                      </section>
                      <section>
                        <strong>After</strong>
                        <pre>{JSON.stringify(review.new_state, null, 2)}</pre>
                      </section>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="review-actions" aria-label="Review actions">
        <button className="button button--secondary" type="button" disabled={isSaving} onClick={() => void save(requirement.validation_status)}>
          Save draft
        </button>
        <button className="button button--primary" type="button" disabled={isSaving} onClick={() => void save('VALIDATED')}>
          {isSaving ? 'Saving…' : 'Verify'}
        </button>
        <button className="button button--danger" type="button" disabled={isSaving} onClick={startDismissal}>
          {dismissMode ? 'Confirm not a requirement' : 'Not a requirement'}
        </button>
      </div>
    </aside>
  )
}
