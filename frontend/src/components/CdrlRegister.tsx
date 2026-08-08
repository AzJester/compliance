import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type {
  CDRL,
  CDRLAdjudication,
  CDRLAdjudicationStatus,
} from '../types'

interface CdrlRegisterProps {
  projectId: string
  cdrls: CDRL[]
  onReviewRequirement: (requirementId: string) => void
  onAdjudicationChanged?: () => void | Promise<void>
  hasRequirements?: boolean
  extractionAttempted?: boolean
  isExtracting?: boolean
}

function adjudicationLabel(adjudication?: CDRLAdjudication) {
  if (!adjudication) return 'Pending review'
  if (!adjudication.fresh && adjudication.status !== 'PENDING') return 'Re-review required'
  if (adjudication.status === 'WAIVED') return adjudication.effective_ready ? 'Waived' : 'Waiver blocked'
  if (adjudication.status === 'REVIEWED') return adjudication.effective_ready ? 'Reviewed' : 'Reviewed — incomplete'
  return 'Pending review'
}

function cdrlValue(cdrl: CDRL, ...keys: (keyof CDRL)[]): string {
  for (const key of keys) {
    const value = cdrl[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number') return String(value)
  }
  return 'Not captured'
}

const blockDefinitions: { key: keyof CDRL; field: string; label: string }[] = [
  { key: 'block_a', field: 'block_a_contract_line_item_number', label: 'Block A — Contract line item number' },
  { key: 'block_b', field: 'block_b_exhibit', label: 'Block B — Exhibit' },
  { key: 'block_c', field: 'block_c_category', label: 'Block C — Category' },
  { key: 'block_d', field: 'block_d_system_item', label: 'Block D — System / item' },
  { key: 'block_e', field: 'block_e_contract_pr_number', label: 'Block E — Contract / PR number' },
  { key: 'block_f', field: 'block_f_contractor', label: 'Block F — Contractor' },
  { key: 'block_1', field: 'block_1_data_item_number', label: 'Block 1 — Data item number' },
  { key: 'block_2', field: 'block_2_title', label: 'Block 2 — Title of data item' },
  { key: 'block_3', field: 'block_3_subtitle', label: 'Block 3 — Subtitle' },
  { key: 'block_4', field: 'block_4_authority', label: 'Block 4 — Authority' },
  { key: 'block_5', field: 'block_5_contract_reference', label: 'Block 5 — Contract reference' },
  { key: 'block_6', field: 'block_6_requiring_office', label: 'Block 6 — Requiring office' },
  { key: 'block_7', field: 'block_7_dd250_requirement', label: 'Block 7 — DD 250 requirement' },
  { key: 'block_8', field: 'block_8_approval_code', label: 'Block 8 — Approval code' },
  { key: 'block_9', field: 'block_9_distribution_statement', label: 'Block 9 — Distribution statement required' },
  { key: 'block_10', field: 'block_10_frequency', label: 'Block 10 — Frequency' },
  { key: 'block_11', field: 'block_11_as_of_date', label: 'Block 11 — As-of date' },
  { key: 'block_12', field: 'block_12_first_submission', label: 'Block 12 — First submission' },
  { key: 'block_13', field: 'block_13_subsequent_submission', label: 'Block 13 — Subsequent submissions' },
  { key: 'block_14', field: 'block_14_distribution', label: 'Block 14 — Distribution' },
  { key: 'block_15', field: 'block_15_total', label: 'Block 15 — Total' },
  { key: 'block_16', field: 'block_16_remarks', label: 'Block 16 — Remarks / tailoring' },
  { key: 'block_17', field: 'block_17_price_group', label: 'Block 17 — Price group' },
  { key: 'block_18', field: 'block_18_estimated_total_price', label: 'Block 18 — Estimated total price' },
]

function missingFieldLabel(field: string) {
  return blockDefinitions.find((block) => block.field === field)?.label ?? field
}

function completeness(cdrl: CDRL) {
  if (typeof cdrl.completeness === 'number') {
    return cdrl.completeness <= 1 ? Math.round(cdrl.completeness * 100) : Math.round(cdrl.completeness)
  }
  const captured = blockDefinitions.filter(({ key }) => Boolean(cdrl[key])).length
  return Math.round((captured / blockDefinitions.length) * 100)
}

export function CdrlRegister({
  projectId,
  cdrls,
  onReviewRequirement,
  onAdjudicationChanged,
  hasRequirements = false,
  extractionAttempted = false,
  isExtracting = false,
}: CdrlRegisterProps) {
  const [selectedCdrlId, setSelectedCdrlId] = useState<string | null>(null)
  const [adjudications, setAdjudications] = useState<CDRLAdjudication[]>([])
  const [isLoadingAdjudications, setIsLoadingAdjudications] = useState(false)
  const [adjudicationError, setAdjudicationError] = useState<string | null>(null)
  const selectedCdrl = useMemo(
    () => cdrls.find((cdrl) => cdrl.id === selectedCdrlId) ?? null,
    [cdrls, selectedCdrlId],
  )
  const selectedAdjudication = useMemo(
    () => adjudications.find((item) => item.cdrl_id === selectedCdrlId),
    [adjudications, selectedCdrlId],
  )

  useEffect(() => {
    if (cdrls.length === 0) {
      setAdjudications([])
      setAdjudicationError(null)
      return
    }
    let active = true
    setIsLoadingAdjudications(true)
    setAdjudicationError(null)
    void api.listCdrlAdjudications(projectId)
      .then((items) => { if (active) setAdjudications(items) })
      .catch((reason: unknown) => {
        if (active) setAdjudicationError(reason instanceof Error ? reason.message : 'Could not load CDRL readiness reviews.')
      })
      .finally(() => { if (active) setIsLoadingAdjudications(false) })
    return () => { active = false }
  }, [cdrls, projectId])

  const saveAdjudication = async (
    cdrlId: string,
    status: CDRLAdjudicationStatus,
    reviewer: string,
    waiverReason: string,
  ) => {
    const current = adjudications.find((item) => item.cdrl_id === cdrlId)
    const updated = await api.updateCdrlAdjudication(projectId, cdrlId, {
      status,
      reviewer: reviewer.trim() || null,
      waiver_reason: status === 'WAIVED' ? waiverReason.trim() || null : null,
      expected_updated_at: current?.updated_at || null,
    })
    setAdjudications((items) => {
      const found = items.some((item) => item.cdrl_id === updated.cdrl_id)
      return found
        ? items.map((item) => item.cdrl_id === updated.cdrl_id ? updated : item)
        : [...items, updated]
    })
    await onAdjudicationChanged?.()
  }

  const emptyTitle = isExtracting
    ? 'Checking for CDRLs'
    : extractionAttempted || hasRequirements
      ? 'No CDRLs detected'
      : 'CDRL register is empty'
  const emptyCopy = isExtracting
    ? 'The register will update when extraction finishes.'
    : extractionAttempted || hasRequirements
      ? 'Requirement extraction completed without finding a DD Form 1423 delivery record. Confirm the source package includes all exhibits and attachments.'
      : 'Upload and process the solicitation package, then run requirement extraction to populate this register.'

  return (
    <section className="register cdrl-register" aria-labelledby="cdrl-register-title">
      <header className="register-hero register-hero--cdrl">
        <div>
          <div className="section-kicker">DD Form 1423</div>
          <h3 id="cdrl-register-title">Contract Data Requirements List</h3>
          <p>Scan delivery items at a glance, then open the complete field inventory and exact source when needed.</p>
        </div>
        <strong>{cdrls.length}<small>records</small></strong>
      </header>

      {cdrls.length === 0 ? (
        <div className="state-card register-empty" aria-busy={isExtracting || undefined}>
          <div className="state-card__icon" aria-hidden="true">1423</div>
          <strong>{emptyTitle}</strong>
          <p>{emptyCopy}</p>
        </div>
      ) : (
        <>
          {adjudicationError && <p className="product-error" role="alert">{adjudicationError}</p>}
          {isLoadingAdjudications && <p className="cdrl-adjudication-loading" role="status">Loading CDRL readiness reviews…</p>}
          <div className="cdrl-table-wrap">
            <table className="cdrl-table">
              <caption className="visually-hidden">Extracted contract data requirements</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Title</th>
                  <th scope="col">DID / authority</th>
                  <th scope="col">Frequency</th>
                  <th scope="col">First submission</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Completeness</th>
                  <th scope="col">Review</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {cdrls.map((cdrl) => {
                  const itemNumber = cdrlValue(cdrl, 'item_number', 'data_item_number', 'block_1')
                  const title = cdrlValue(cdrl, 'title', 'data_item_title', 'block_2')
                  const adjudication = adjudications.find((item) => item.cdrl_id === cdrl.id)
                  return (
                    <tr key={cdrl.id} className={selectedCdrlId === cdrl.id ? 'cdrl-table__selected' : undefined}>
                      <th scope="row">{itemNumber}</th>
                      <td>{title}</td>
                      <td>{cdrlValue(cdrl, 'did_number', 'data_acquisition_document', 'block_4')}</td>
                      <td>{cdrlValue(cdrl, 'frequency', 'block_10')}</td>
                      <td>{cdrlValue(cdrl, 'first_submission', 'first_submission_date', 'block_12')}</td>
                      <td>{cdrlValue(cdrl, 'block_8')}</td>
                      <td>
                        <span className={cdrl.incomplete ? 'cdrl-completeness cdrl-completeness--warning' : 'cdrl-completeness'}>
                          {completeness(cdrl)}%
                        </span>
                      </td>
                      <td>
                        <span className={`cdrl-readiness-status${adjudication?.effective_ready ? ' cdrl-readiness-status--ready' : ''}`}>
                          {adjudicationLabel(adjudication)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="button button--secondary cdrl-detail-button"
                          type="button"
                          aria-expanded={selectedCdrlId === cdrl.id}
                          onClick={() => setSelectedCdrlId((current) => current === cdrl.id ? null : cdrl.id)}
                        >
                          {selectedCdrlId === cdrl.id ? 'Hide details' : 'View details'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {selectedCdrl && (() => {
            const linkedRequirementId = selectedCdrl.requirement_id || selectedCdrl.linked_requirement_id
            const itemNumber = cdrlValue(selectedCdrl, 'item_number', 'data_item_number', 'block_1')
            const title = cdrlValue(selectedCdrl, 'title', 'data_item_title', 'block_2')
            const remarks = cdrlValue(selectedCdrl, 'remarks', 'block_16')
            return (
              <article className="cdrl-detail" aria-labelledby={`cdrl-detail-${selectedCdrl.id}`}>
                <header>
                  <div>
                    <span>Data item {itemNumber}</span>
                    <h4 id={`cdrl-detail-${selectedCdrl.id}`}>{title}</h4>
                  </div>
                  <button className="icon-button" type="button" aria-label="Close CDRL details" onClick={() => setSelectedCdrlId(null)}>×</button>
                </header>

                <dl className="cdrl-key-fields">
                  <div><dt>DID / authority</dt><dd>{cdrlValue(selectedCdrl, 'did_number', 'data_acquisition_document', 'block_4')}</dd></div>
                  <div><dt>Frequency</dt><dd>{cdrlValue(selectedCdrl, 'frequency', 'block_10')}</dd></div>
                  <div><dt>First submission</dt><dd>{cdrlValue(selectedCdrl, 'first_submission', 'first_submission_date', 'block_12')}</dd></div>
                  <div><dt>Subsequent submissions</dt><dd>{cdrlValue(selectedCdrl, 'subsequent_submission', 'subsequent_submission_date', 'block_13')}</dd></div>
                </dl>

                <section className="block-sixteen" aria-label="Block 16 remarks">
                  <strong>Block 16 · Remarks / tailoring</strong>
                  <p>{remarks}</p>
                </section>

                <details className="cdrl-provenance">
                  <summary>View exact source</summary>
                  <div>
                    <span>{selectedCdrl.document_name || 'Source document'}</span>
                    <span>{selectedCdrl.source_locator || 'Locator unavailable'}</span>
                    <p>{selectedCdrl.source_text}</p>
                  </div>
                </details>

                <details>
                  <summary>View full DD Form 1423 field inventory</summary>
                  <dl className="all-blocks">
                    {blockDefinitions.map(({ key, label }) => (
                      <div key={key} className={selectedCdrl[key] ? undefined : 'all-blocks__missing'}>
                        <dt>{label}</dt>
                        <dd>{selectedCdrl[key] ? String(selectedCdrl[key]) : 'Not captured'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>

                {(selectedCdrl.incomplete_fields?.length ?? 0) > 0 && (
                  <section className="missing-fields" aria-label="Missing CDRL fields">
                    <strong>Missing fields requiring review</strong>
                    <ul>
                      {selectedCdrl.incomplete_fields?.map((field) => (
                        <li key={field}>{missingFieldLabel(field)}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <CdrlAdjudicationEditor
                  cdrl={selectedCdrl}
                  adjudication={selectedAdjudication}
                  isLoading={isLoadingAdjudications}
                  onSave={saveAdjudication}
                />

                {linkedRequirementId && (
                  <button
                    className="button button--primary cdrl-review-button"
                    id={`cdrl-review-${linkedRequirementId}`}
                    type="button"
                    onClick={() => onReviewRequirement(linkedRequirementId)}
                  >
                    Review linked requirement
                  </button>
                )}
              </article>
            )
          })()}
        </>
      )}
    </section>
  )
}

function CdrlAdjudicationEditor({
  cdrl,
  adjudication,
  isLoading,
  onSave,
}: {
  cdrl: CDRL
  adjudication?: CDRLAdjudication
  isLoading: boolean
  onSave: (
    cdrlId: string,
    status: CDRLAdjudicationStatus,
    reviewer: string,
    waiverReason: string,
  ) => Promise<void>
}) {
  const [status, setStatus] = useState<CDRLAdjudicationStatus>('PENDING')
  const [reviewer, setReviewer] = useState('')
  const [waiverReason, setWaiverReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    setStatus(adjudication?.status ?? 'PENDING')
    setReviewer(adjudication?.reviewer ?? '')
    setWaiverReason(adjudication?.waiver_reason ?? '')
    setError(null)
    setAnnouncement('')
  }, [adjudication, cdrl.id])

  const submit = async () => {
    if (status !== 'PENDING' && !reviewer.trim()) {
      setError('Enter a reviewer label before completing this CDRL review.')
      return
    }
    if (status === 'WAIVED' && !waiverReason.trim()) {
      setError('Explain why this CDRL completeness requirement is being waived.')
      return
    }
    setError(null)
    setAnnouncement('')
    setIsSaving(true)
    try {
      await onSave(cdrl.id, status, reviewer, waiverReason)
      setAnnouncement(status === 'PENDING' ? 'CDRL review reset to pending.' : 'CDRL readiness review saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the CDRL readiness review.')
    } finally {
      setIsSaving(false)
    }
  }

  const missingFields = adjudication?.missing_fields ?? cdrl.incomplete_fields ?? []

  return (
    <section className="cdrl-adjudication" aria-label="CDRL readiness review">
      <div className="cdrl-adjudication__heading">
        <div>
          <strong>Readiness review</strong>
          <p>Readiness remains blocked until a human confirms a complete record or records an explicit waiver.</p>
        </div>
        <span className={`cdrl-readiness-status${adjudication?.effective_ready ? ' cdrl-readiness-status--ready' : ''}`}>
          {adjudicationLabel(adjudication)}
        </span>
      </div>

      {adjudication && !adjudication.fresh && adjudication.status !== 'PENDING' && (
        <p className="cdrl-adjudication__warning">The source changed after this decision. Review and save it again.</p>
      )}
      {missingFields.length > 0 && status === 'REVIEWED' && (
        <p className="cdrl-adjudication__warning">This record is still incomplete. A reviewed decision will remain blocked unless the missing fields are resolved or explicitly waived.</p>
      )}

      <div className="cdrl-adjudication__form">
        <label>
          Decision
          <select value={status} onChange={(event) => setStatus(event.target.value as CDRLAdjudicationStatus)} disabled={isLoading || isSaving}>
            <option value="PENDING">Pending review</option>
            <option value="REVIEWED">Reviewed for completeness</option>
            <option value="WAIVED">Explicitly waived</option>
          </select>
        </label>
        <label>
          Reviewer label {status !== 'PENDING' && <span aria-hidden="true">*</span>}
          <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} disabled={isLoading || isSaving} />
          <small>Self-reported on the anonymous public demo.</small>
        </label>
        {status === 'WAIVED' && (
          <label className="cdrl-adjudication__reason">
            Waiver reason <span aria-hidden="true">*</span>
            <textarea rows={3} value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)} disabled={isLoading || isSaving} />
          </label>
        )}
      </div>
      {error && <p className="product-error" role="alert">{error}</p>}
      {announcement && <p className="product-success" role="status">{announcement}</p>}
      <button className="button button--primary" type="button" disabled={isLoading || isSaving} onClick={() => void submit()}>
        {isSaving ? 'Saving review…' : 'Save CDRL review'}
      </button>
    </section>
  )
}
