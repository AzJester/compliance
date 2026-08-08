import type { CDRL } from '../types'

interface CdrlRegisterProps {
  cdrls: CDRL[]
  onReviewRequirement: (requirementId: string) => void
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

export function CdrlRegister({ cdrls, onReviewRequirement }: CdrlRegisterProps) {
  return (
    <section className="register cdrl-register" aria-labelledby="cdrl-register-title">
      <header className="register-hero register-hero--cdrl">
        <div>
          <div className="section-kicker">DD Form 1423</div>
          <h3 id="cdrl-register-title">Contract Data Requirements List</h3>
          <p>Every extracted delivery record, including schedule, DID authority, Block 16 tailoring, and exact provenance.</p>
        </div>
        <strong>{cdrls.length}<small>records</small></strong>
      </header>

      {cdrls.length === 0 ? (
        <div className="state-card register-empty">
          <div className="state-card__icon" aria-hidden="true">1423</div>
          <strong>No CDRLs extracted</strong>
          <p>Run requirement extraction after the source documents reach an extracted status.</p>
        </div>
      ) : (
        <div className="cdrl-list">
          {cdrls.map((cdrl) => {
            const linkedRequirementId = cdrl.requirement_id || cdrl.linked_requirement_id
            const itemNumber = cdrlValue(cdrl, 'item_number', 'data_item_number', 'block_1')
            const title = cdrlValue(cdrl, 'title', 'data_item_title', 'block_2')
            const did = cdrlValue(cdrl, 'did_number', 'data_acquisition_document', 'block_4')
            const frequency = cdrlValue(cdrl, 'frequency', 'block_10')
            const first = cdrlValue(cdrl, 'first_submission', 'first_submission_date', 'block_12')
            const subsequent = cdrlValue(cdrl, 'subsequent_submission', 'subsequent_submission_date', 'block_13')
            const remarks = cdrlValue(cdrl, 'remarks', 'block_16')
            return (
              <article className="cdrl-card" key={cdrl.id}>
                <header>
                  <div>
                    <span>Data item {itemNumber}</span>
                    <h4>{title}</h4>
                  </div>
                  {cdrl.incomplete || (cdrl.incomplete_fields && cdrl.incomplete_fields.length > 0) ? (
                    <span className="review-status review-status--pending">
                      {cdrl.source_truncated
                        ? `Source capped · ${cdrl.incomplete_fields?.length ?? 0} fields missing`
                        : `Extraction incomplete · ${cdrl.incomplete_fields?.length ?? 0}`}
                    </span>
                  ) : (
                    <span className="review-status review-status--neutral">Extraction fields captured</span>
                  )}
                  <span className={`review-status review-status--${cdrl.validation_status?.toLowerCase() || 'pending'}`}>
                    {cdrl.validation_status ? `Review ${cdrl.validation_status.toLowerCase()}` : 'Needs human review'}
                  </span>
                </header>
                <dl className="cdrl-key-fields">
                  <div><dt>DID / authority</dt><dd>{did}</dd></div>
                  <div><dt>Frequency</dt><dd>{frequency}</dd></div>
                  <div><dt>First submission</dt><dd>{first}</dd></div>
                  <div><dt>Subsequent submissions</dt><dd>{subsequent}</dd></div>
                </dl>
                <section className="block-sixteen" aria-label="Block 16 remarks">
                  <strong>Block 16 · Remarks / tailoring</strong>
                  <p>{remarks}</p>
                </section>
                <div className="cdrl-provenance">
                  <span>{cdrl.document_name || 'Source document'}</span>
                  <span>{cdrl.source_locator || 'Locator unavailable'}</span>
                  <p>{cdrl.source_text}</p>
                </div>
                <details>
                  <summary>View full DD Form 1423 field inventory</summary>
                  <dl className="all-blocks">
                    {blockDefinitions.map(({ key, label }) => (
                      <div key={key} className={cdrl[key] ? undefined : 'all-blocks__missing'}>
                        <dt>{label}</dt>
                        <dd>{cdrl[key] ? String(cdrl[key]) : 'Not captured'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {(cdrl.incomplete_fields?.length ?? 0) > 0 && (
                  <section className="missing-fields" aria-label="Missing CDRL fields">
                    <strong>Missing fields requiring review</strong>
                    <ul>
                      {cdrl.incomplete_fields?.map((field) => (
                        <li key={field}>{missingFieldLabel(field)}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {linkedRequirementId && (
                  <button
                    className="button button--secondary cdrl-review-button"
                    id={`cdrl-review-${linkedRequirementId}`}
                    type="button"
                    onClick={() => onReviewRequirement(linkedRequirementId)}
                  >
                    Review linked requirement
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
