import { useEffect, useRef, useState } from 'react'
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

export function enumLabel(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function reviewStatus(review: ReviewDecision) {
  const stateStatus = review.new_state?.validation_status
  if (typeof stateStatus === 'string') return stateStatus
  return review.new_status || review.validation_status || review.action || 'Updated'
}

interface RequirementEditorProps {
  requirement: Requirement
  reviews: ReviewDecision[]
  isLoadingReviews: boolean
  isSaving: boolean
  saveError: string | null
  onSave: (update: RequirementUpdate) => Promise<void>
  onClose: () => void
}

export function RequirementEditor({
  requirement,
  reviews,
  isLoadingReviews,
  isSaving,
  saveError,
  onSave,
  onClose,
}: RequirementEditorProps) {
  const [requirementText, setRequirementText] = useState(requirement.requirement_text)
  const [section, setSection] = useState(requirement.section)
  const [category, setCategory] = useState(requirement.category)
  const [owner, setOwner] = useState(requirement.obligation_owner)
  const [applicability, setApplicability] = useState(requirement.applicability)
  const [reviewer, setReviewer] = useState(requirement.reviewer ?? '')
  const [reviewNote, setReviewNote] = useState(requirement.validation_status === 'DISMISSED' ? '' : requirement.review_note ?? '')
  const [dismissalReason, setDismissalReason] = useState(requirement.dismissal_reason ?? (requirement.validation_status === 'DISMISSED' ? requirement.review_note ?? '' : ''))
  const [localError, setLocalError] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setRequirementText(requirement.requirement_text)
    setSection(requirement.section)
    setCategory(requirement.category)
    setOwner(requirement.obligation_owner)
    setApplicability(requirement.applicability)
    setReviewer(requirement.reviewer ?? '')
    setReviewNote(requirement.validation_status === 'DISMISSED' ? '' : requirement.review_note ?? '')
    setDismissalReason(requirement.dismissal_reason ?? (requirement.validation_status === 'DISMISSED' ? requirement.review_note ?? '' : ''))
    setLocalError(null)
  }, [requirement.id, requirement.updated_at])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [requirement.id])

  const save = async (validationStatus: ValidationStatus) => {
    setLocalError(null)
    if (!requirementText.trim()) {
      setLocalError('Normalized requirement text is required.')
      return
    }
    if (!reviewer.trim()) {
      setLocalError('Reviewer name is required to save any review decision.')
      return
    }
    if (validationStatus === 'DISMISSED' && !dismissalReason.trim()) {
      setLocalError('A dismissal reason is required.')
      return
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

  return (
    <aside className="requirement-editor" aria-labelledby="requirement-editor-title">
      <div className="requirement-editor__heading">
        <div>
          <div className="section-kicker">Human adjudication</div>
          <h3 id="requirement-editor-title">Review requirement</h3>
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close requirement review" onClick={onClose}>×</button>
      </div>

      <section className="source-evidence" aria-labelledby="exact-source-title">
        <div className="source-evidence__heading">
          <strong id="exact-source-title">Immutable exact source</strong>
          <span>{requirement.document_name || 'Source document'}</span>
        </div>
        <blockquote>{requirement.source_text}</blockquote>
        <p>{requirement.source_locator || 'Locator unavailable'}</p>
      </section>

      <div className="evidence-metadata">
        <span>Confidence <strong>{Math.round(requirement.confidence * 100)}%</strong></span>
        <span>Rule <strong>{requirement.rule_version || 'Unspecified'}</strong></span>
        <span>Method <strong>{enumLabel(requirement.extraction_method || 'Unspecified')}</strong></span>
      </div>

      <form className="review-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Normalized requirement
          <textarea value={requirementText} onChange={(event) => setRequirementText(event.target.value)} rows={5} />
        </label>

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
            Obligation owner
            <select value={owner} onChange={(event) => setOwner(event.target.value as ObligationOwner)}>
              {owners.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
            </select>
          </label>
          <label>
            Applicability
            <select value={applicability} onChange={(event) => setApplicability(event.target.value as Applicability)}>
              {applicabilityOptions.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
            </select>
          </label>
        </div>

        <label>
          Reviewer
          <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} autoComplete="name" />
        </label>
        <label>
          Review note
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} />
        </label>
        <label>
          Dismissal reason
          <textarea value={dismissalReason} onChange={(event) => setDismissalReason(event.target.value)} rows={3} />
          <small>Required only when dismissing; persisted in the review decision audit note.</small>
        </label>

        {(localError || saveError) && <p className="inline-error" role="alert">{localError || saveError}</p>}
        <div className="review-actions">
          <button className="button button--secondary" type="button" disabled={isSaving} onClick={() => void save(requirement.validation_status)}>
            Save changes
          </button>
          <button className="button button--primary" type="button" disabled={isSaving} onClick={() => void save('VALIDATED')}>
            {isSaving ? 'Saving…' : 'Validate'}
          </button>
          <button className="button button--danger" type="button" disabled={isSaving} onClick={() => void save('DISMISSED')}>
            Dismiss
          </button>
        </div>
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
    </aside>
  )
}
