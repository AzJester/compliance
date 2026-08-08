import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { IntakeVerification, ProjectDocument } from '../types'
import './product-workflow.css'

interface PackageVerificationProps {
  projectId: string
  documents: ProjectDocument[]
  onVerified?: () => void
}

export function PackageVerification({ projectId, documents, onVerified }: PackageVerificationProps) {
  const [checks, setChecks] = useState<IntakeVerification[]>([])
  const [reviewer, setReviewer] = useState('')
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    void api.initializeIntakeVerifications(projectId)
      .then((records) => {
        if (!active) return
        setChecks(records)
        const latestReviewed = [...records].reverse().find((record) => record.reviewer)
        setReviewer(latestReviewed?.reviewer || '')
        setNote(latestReviewed?.note || '')
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load package verification.')
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [documents, projectId])

  const completeCount = useMemo(
    () => checks.filter((check) => check.status === 'VERIFIED' || check.status === 'NOT_APPLICABLE').length,
    [checks],
  )
  const totalCount = checks.length
  const isComplete = totalCount > 0 && completeCount === totalCount

  const save = async () => {
    setError(null)
    setSavedMessage(null)
    if (!reviewer.trim()) {
      setError('Enter a reviewer label before recording package verification.')
      return
    }
    setIsSaving(true)
    try {
      const records = await Promise.all(checks.map((check) => api.updateIntakeVerification(
        projectId,
        check.id,
        { status: check.status, reviewer: reviewer.trim(), note: note.trim() || null },
      )))
      setChecks(records)
      setSavedMessage(isComplete ? 'Solicitation package marked verified.' : 'Verification progress saved.')
      if (isComplete) onVerified?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save package verification.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="product-panel" aria-labelledby="package-verification-title">
      <header className="product-panel__header">
        <div>
          <span className="product-eyebrow">Workflow gate</span>
          <h2 id="package-verification-title">Verify solicitation package</h2>
          <p>Resolve intake issues before relying on the requirements register.</p>
        </div>
        <div className={`completion-ring${isComplete ? ' completion-ring--complete' : ''}`} aria-label={`${completeCount} of ${totalCount} checks complete`}>
          <strong>{completeCount}/{totalCount}</strong>
          <span>complete</span>
        </div>
      </header>

      {isLoading ? (
        <div className="product-state" aria-busy="true">Loading package checks…</div>
      ) : (
        <div className="verification-layout">
          <fieldset className="verification-checklist">
            <legend>Verification checklist</legend>
            {checks.map((check) => (
              <label key={check.id} className={`verification-check verification-check--${check.status.toLowerCase()}`}>
                <span>{check.label}</span>
                <select
                  aria-label={`Status for ${check.label}`}
                  value={check.status}
                  onChange={(event) => setChecks((current) => current.map((item) => item.id === check.id
                    ? { ...item, status: event.target.value as IntakeVerification['status'] }
                    : item))}
                >
                  <option value="PENDING">Pending review</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="ISSUE">Issue found</option>
                  <option value="NOT_APPLICABLE">Not applicable</option>
                </select>
              </label>
            ))}
          </fieldset>

          <div className="verification-decision">
            <h3>Record verification</h3>
            <label>
              Reviewer label <span aria-hidden="true">*</span>
              <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} required />
              <small>Anonymous-mode labels are not identity verified.</small>
            </label>
            <label>
              Verification note
              <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {error && <p className="product-error" role="alert">{error}</p>}
            {savedMessage && <p className="product-success" role="status">{savedMessage}</p>}
            <button className="button button--primary product-primary-action" type="button" onClick={() => void save()} disabled={isSaving}>
              {isSaving ? 'Saving…' : isComplete ? 'Mark package verified' : 'Save verification progress'}
            </button>
            {documents.length > 0 && <p className="verification-history">{documents.length} source document{documents.length === 1 ? '' : 's'} in the current package</p>}
          </div>
        </div>
      )}
    </section>
  )
}
