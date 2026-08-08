import { useMemo, useState } from 'react'
import type { ProjectView, Requirement, RequirementCategory, SolicitationSection, ValidationStatus } from '../types'
import { categories, enumLabel, sections } from './RequirementEditor'

interface RequirementRegisterProps {
  requirements: Requirement[]
  view: ProjectView
  selectedId: string | null
  onSelect: (requirementId: string) => void
}

function registerCopy(view: ProjectView) {
  if (view === 'section-l') return {
    kicker: 'Instructions to offerors',
    title: 'Section L submission register',
    description: 'Proposal structure, content, format, delivery, and response instructions extracted from Section L.',
  }
  if (view === 'section-m') return {
    kicker: 'Evaluation criteria',
    title: 'Section M evaluation register',
    description: 'Factors, subfactors, rating criteria, and evaluation obligations extracted from Section M.',
  }
  return {
    kicker: 'Atomic obligations',
    title: 'All requirements',
    description: 'Every candidate obligation with exact, immutable solicitation provenance.',
  }
}

export function RequirementRegister({ requirements, view, selectedId, onSelect }: RequirementRegisterProps) {
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<SolicitationSection | 'ALL'>('ALL')
  const [category, setCategory] = useState<RequirementCategory | 'ALL'>('ALL')
  const [status, setStatus] = useState<ValidationStatus | 'ALL'>('ALL')
  const lockedSection = view === 'section-l' ? 'L' : view === 'section-m' ? 'M' : null
  const copy = registerCopy(view)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return requirements.filter((requirement) => {
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
  }, [category, lockedSection, requirements, search, section, status])

  return (
    <section className="register" aria-labelledby="register-title">
      <header className={`register-hero register-hero--${lockedSection?.toLowerCase() || 'all'}`}>
        <div>
          <div className="section-kicker">{copy.kicker}</div>
          <h3 id="register-title">{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        <strong>{filtered.length}<small>shown</small></strong>
      </header>

      <div className="requirement-filters" role="search" aria-label="Filter requirements">
        <label className="search-field">
          <span>Search</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Text, source, locator…" />
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
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ValidationStatus | 'ALL')}>
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="VALIDATED">Validated</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="state-card register-empty">
          <div className="state-card__icon" aria-hidden="true">§</div>
          <strong>No matching requirements</strong>
          <p>Adjust the filters or run extraction after documents have been processed.</p>
        </div>
      ) : (
        <ol className="requirement-list">
          {filtered.map((requirement) => (
            <li key={requirement.id} className={selectedId === requirement.id ? 'requirement-card requirement-card--selected' : 'requirement-card'}>
              <button id={`requirement-card-${requirement.id}`} type="button" onClick={() => onSelect(requirement.id)} aria-pressed={selectedId === requirement.id}>
                <div className="requirement-card__meta">
                  <span className="section-chip">§ {requirement.section}</span>
                  <span>{enumLabel(requirement.category)}</span>
                  <span className={`review-status review-status--${requirement.validation_status.toLowerCase()}`}>
                    {enumLabel(requirement.validation_status)}
                  </span>
                  <span>{Math.round(requirement.confidence * 100)}% confidence</span>
                </div>
                <strong>{requirement.requirement_text}</strong>
                <div className="requirement-card__source">
                  <span>{requirement.document_name || 'Source document'}</span>
                  <span>{requirement.source_locator || 'Locator unavailable'}</span>
                </div>
                <blockquote>{requirement.source_text}</blockquote>
                <span className="review-link">Review requirement <span aria-hidden="true">→</span></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
