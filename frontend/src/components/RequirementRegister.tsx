import { useEffect, useMemo, useState } from 'react'
import type { ProjectView, Requirement, RequirementCategory, SolicitationSection, ValidationStatus } from '../types'
import { categories, enumLabel, sections, statusLabel } from './RequirementEditor'

interface RequirementRegisterProps {
  requirements: Requirement[]
  view: ProjectView
  selectedId: string | null
  onSelect: (requirementId: string) => void
  initialStatus?: ValidationStatus | 'ALL'
  initialSection?: SolicitationSection | 'ALL'
  initialCategory?: RequirementCategory | 'ALL'
  onVisibleRequirementsChange?: (requirementIds: string[]) => void
}

type SortOption = 'SOURCE' | 'CONFIDENCE' | 'SECTION' | 'STATUS'

const pageSize = 10

function registerCopy(view: ProjectView) {
  if (view === 'section-l') return {
    kicker: 'Instructions to offerors',
    title: 'Section L proposal instructions',
    description: 'Review proposal content, format, delivery, and submission instructions. Verify each item before using it in the proposal outline.',
  }
  if (view === 'section-m') return {
    kicker: 'Evaluation criteria',
    title: 'Section M evaluation criteria',
    description: 'Review factors, subfactors, rating criteria, and evaluation language that should shape the proposal response.',
  }
  return {
    kicker: 'Requirement candidates',
    title: 'Requirement review queue',
    description: 'Verify candidate requirements against their source before assigning or crosswalking them.',
  }
}

function sortRequirements(items: Requirement[], sort: SortOption) {
  if (sort === 'CONFIDENCE') return [...items].sort((a, b) => b.confidence - a.confidence)
  if (sort === 'SECTION') return [...items].sort((a, b) => (
    a.section.localeCompare(b.section, undefined, { numeric: true }) ||
    a.source_locator.localeCompare(b.source_locator, undefined, { numeric: true })
  ))
  if (sort === 'STATUS') return [...items].sort((a, b) => (
    a.validation_status.localeCompare(b.validation_status) ||
    a.source_locator.localeCompare(b.source_locator, undefined, { numeric: true })
  ))
  return items
}

export function RequirementRegister({
  requirements,
  view,
  selectedId,
  onSelect,
  initialStatus = 'PENDING',
  initialSection = 'ALL',
  initialCategory = 'ALL',
  onVisibleRequirementsChange,
}: RequirementRegisterProps) {
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<SolicitationSection | 'ALL'>(initialSection)
  const [category, setCategory] = useState<RequirementCategory | 'ALL'>(initialCategory)
  const [status, setStatus] = useState<ValidationStatus | 'ALL'>(initialStatus)
  const [sort, setSort] = useState<SortOption>('SOURCE')
  const [page, setPage] = useState(1)
  const lockedSection = view === 'section-l' ? 'L' : view === 'section-m' ? 'M' : null
  const copy = registerCopy(view)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = requirements.filter((requirement) => {
      if (lockedSection && requirement.section !== lockedSection) return false
      if (!lockedSection && section !== 'ALL' && requirement.section !== section) return false
      if (category !== 'ALL' && requirement.category !== category) return false
      if (status !== 'ALL' && requirement.validation_status !== status) return false
      if (!query) return true
      return [
        requirement.requirement_text,
        requirement.source_text,
        requirement.source_locator,
        requirement.document_name,
        requirement.mandatory_term,
      ].some((value) => value?.toLowerCase().includes(query))
    })
    return sortRequirements(matches, sort)
  }, [category, lockedSection, requirements, search, section, sort, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const visibleIdsKey = filtered.map((requirement) => requirement.id).join('|')

  useEffect(() => {
    setPage(1)
  }, [category, search, section, sort, status])

  useEffect(() => {
    onVisibleRequirementsChange?.(visibleIdsKey ? visibleIdsKey.split('|') : [])
  }, [onVisibleRequirementsChange, visibleIdsKey])

  const clearFilters = () => {
    setSearch('')
    setSection('ALL')
    setCategory('ALL')
    setStatus('ALL')
    setSort('SOURCE')
    setPage(1)
  }

  const showAll = () => {
    setStatus('ALL')
    setPage(1)
  }

  return (
    <section className="register" aria-labelledby="register-title">
      <header className={`register-hero register-hero--${lockedSection?.toLowerCase() || 'all'}`}>
        <div>
          <div className="section-kicker">{copy.kicker}</div>
          <h3 id="register-title">{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        <strong>{filtered.length}<small>matching</small></strong>
      </header>

      {lockedSection && (
        <div className="register-guidance" role="note">
          <strong>{lockedSection === 'L' ? 'Proposal instruction check' : 'Evaluation coverage check'}</strong>
          <span>
            {lockedSection === 'L'
              ? 'Confirm the required content, format, delivery method, and response location in the source.'
              : 'Confirm the factor hierarchy, relative importance, rating language, and related proposal instruction.'}
          </span>
        </div>
      )}

      <div className="requirement-filters" role="search" aria-label="Filter requirements">
        <label className="search-field">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Requirement, source, or page"
          />
        </label>
        {!lockedSection && (
          <label>
            <span>Section</span>
            <select value={section} onChange={(event) => setSection(event.target.value as SolicitationSection | 'ALL')}>
              <option value="ALL">All sections</option>
              {sections.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as RequirementCategory | 'ALL')}>
            <option value="ALL">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}
          </select>
        </label>
        <label>
          <span>Review status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ValidationStatus | 'ALL')}>
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending review</option>
            <option value="VALIDATED">Verified</option>
            <option value="DISMISSED">Not a requirement</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
            <option value="SOURCE">Source order</option>
            <option value="CONFIDENCE">Confidence: high to low</option>
            <option value="SECTION">Section and source</option>
            <option value="STATUS">Review status</option>
          </select>
        </label>
        <button className="button button--secondary clear-filters" type="button" onClick={clearFilters}>Clear filters</button>
      </div>

      {filtered.length === 0 ? (
        <div className="state-card register-empty">
          <div className="state-card__icon" aria-hidden="true">§</div>
          <strong>{status === 'PENDING' ? 'No pending requirements' : 'No matching requirements'}</strong>
          <p>
            {requirements.length === 0
              ? 'Upload and process solicitation documents, then run requirement extraction.'
              : status === 'PENDING'
                ? 'This queue is complete. Show all requirements to review prior decisions.'
                : 'Adjust or clear the filters to broaden the results.'}
          </p>
          {requirements.length > 0 && status === 'PENDING' && (
            <button className="button button--secondary" type="button" onClick={showAll}>Show all requirements</button>
          )}
        </div>
      ) : (
        <>
          <ol className="requirement-list" start={(currentPage - 1) * pageSize + 1}>
            {pageItems.map((requirement) => {
              const duplicateSource = requirement.requirement_text.trim() === requirement.source_text.trim()
              return (
                <li key={requirement.id} className={selectedId === requirement.id ? 'requirement-card requirement-card--selected' : 'requirement-card'}>
                  <button id={`requirement-card-${requirement.id}`} type="button" onClick={() => onSelect(requirement.id)} aria-pressed={selectedId === requirement.id}>
                    <div className="requirement-card__meta">
                      <span className="section-chip">§ {requirement.section}</span>
                      <span>{enumLabel(requirement.category)}</span>
                      <span className={`review-status review-status--${requirement.validation_status.toLowerCase()}`}>
                        {statusLabel(requirement.validation_status)}
                      </span>
                      <span>{Math.round(requirement.confidence * 100)}% confidence</span>
                    </div>
                    <strong>{requirement.requirement_text}</strong>
                    <div className="requirement-card__source">
                      <span>{requirement.document_name || 'Source document'}</span>
                      <span>{requirement.source_locator || 'Locator unavailable'}</span>
                    </div>
                    {!duplicateSource && <blockquote>{requirement.source_text}</blockquote>}
                    <span className="review-link">Open review <span aria-hidden="true">→</span></span>
                  </button>
                </li>
              )
            })}
          </ol>
          <nav className="register-pagination" aria-label="Requirement result pages">
            <span>
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div>
              <button className="button button--secondary" type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous page</button>
              <span aria-current="page">Page {currentPage} of {pageCount}</span>
              <button className="button button--secondary" type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next page</button>
            </div>
          </nav>
        </>
      )}
    </section>
  )
}
