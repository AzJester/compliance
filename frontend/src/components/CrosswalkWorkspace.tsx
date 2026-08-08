import { useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { api } from '../api/client'
import type {
  CrosswalkFinding,
  CrosswalkStatus,
  CrosswalkUpdate,
  DocumentText,
  ProjectDocument,
} from '../types'
import './product-workflow.css'

interface CrosswalkWorkspaceProps {
  projectId: string
  proposalDocuments: ProjectDocument[]
  onContinue?: () => void
}

const statuses: CrosswalkStatus[] = ['COVERED', 'PARTIAL', 'MISSING', 'CONFLICT', 'N_A']

function label(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function CrosswalkWorkspace({ projectId, proposalDocuments, onContinue }: CrosswalkWorkspaceProps) {
  const [findings, setFindings] = useState<CrosswalkFinding[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<CrosswalkStatus | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const next = await api.listCrosswalk(projectId)
      setFindings(next)
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load crosswalk findings.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setIsGenerating(true)
    setError(null)
    setAnnouncement('Analyzing proposal coverage.')
    try {
      const summary = await api.generateCrosswalk(projectId)
      await load()
      setAnnouncement(`Crosswalk updated for ${summary.requirements_analyzed} requirements.`)
      onContinue?.()
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Unable to generate the crosswalk.')
    } finally {
      setIsGenerating(false)
    }
  }

  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [
    status,
    findings.filter((finding) => finding.status === status).length,
  ])) as Record<CrosswalkStatus, number>, [findings])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return findings.filter((finding) => (
      (statusFilter === 'ALL' || finding.status === statusFilter)
      && (!query || finding.requirement_text.toLowerCase().includes(query) || finding.owner?.toLowerCase().includes(query))
    ))
  }, [findings, search, statusFilter])

  useEffect(() => {
    if (selectedId && !visible.some((finding) => finding.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null)
    }
  }, [selectedId, visible])

  const selected = findings.find((finding) => finding.id === selectedId) ?? null
  const selectedIndex = selected ? visible.findIndex((finding) => finding.id === selected.id) : -1

  const save = async (update: CrosswalkUpdate) => {
    if (!selected) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await api.updateCrosswalkFinding(projectId, selected.id, {
        ...update,
        expected_updated_at: selected.updated_at,
      })
      setFindings((current) => current.map((finding) => finding.id === updated.id ? updated : finding))
      setAnnouncement(`Finding saved as ${label(updated.status)}${updated.human_verified ? ' and human verified' : ''}.`)
      onContinue?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the finding.')
    } finally {
      setIsSaving(false)
    }
  }

  const moveSelection = (offset: number) => {
    if (!visible.length) return
    const next = visible[(Math.max(0, selectedIndex) + offset + visible.length) % visible.length]
    setSelectedId(next.id)
  }

  return (
    <section className="product-panel crosswalk-panel" aria-labelledby="crosswalk-title">
      <header className="product-panel__header crosswalk-header">
        <div>
          <span className="product-eyebrow">Requirement-to-response evidence</span>
          <h2 id="crosswalk-title">Proposal compliance crosswalk</h2>
          <p>Automated findings are candidates. Only a human-verified evidence decision contributes to readiness.</p>
        </div>
        <button className="button button--primary" type="button" disabled={isGenerating || proposalDocuments.length === 0} onClick={() => void generate()}>
          {isGenerating ? 'Analyzing response…' : findings.length ? 'Reanalyze response' : 'Generate crosswalk'}
        </button>
      </header>

      {proposalDocuments.length === 0 && (
        <div className="crosswalk-blocker" role="status">
          <strong>Proposal response required</strong>
          <span>Upload and classify at least one synthetic proposal volume before generating findings.</span>
        </div>
      )}
      {error && <p className="product-error crosswalk-message" role="alert">{error}</p>}
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      <div className="crosswalk-summary" aria-label="Crosswalk finding summary">
        {statuses.map((status) => (
          <button key={status} type="button" className={`crosswalk-summary__${status.toLowerCase()}${statusFilter === status ? ' is-active' : ''}`} onClick={() => setStatusFilter(statusFilter === status ? 'ALL' : status)}>
            <span>{label(status)}</span><strong>{counts[status]}</strong>
          </button>
        ))}
        <div><span>Human verified</span><strong>{findings.filter((finding) => finding.human_verified).length}/{findings.length}</strong></div>
      </div>

      {isLoading ? (
        <div className="product-state" aria-busy="true">Loading crosswalk findings…</div>
      ) : findings.length === 0 ? (
        <div className="product-empty crosswalk-empty">
          <strong>No crosswalk findings yet</strong>
          <p>After validating requirements and uploading proposal volumes, generate conservative candidate matches for human review.</p>
        </div>
      ) : (
        <div className={`crosswalk-layout${selected ? ' crosswalk-layout--open' : ''}`}>
          <div className="crosswalk-register">
            <div className="crosswalk-filters" role="search" aria-label="Filter crosswalk findings">
              <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Requirement or owner" /></label>
              <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CrosswalkStatus | 'ALL')}><option value="ALL">All findings</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
              <button className="button button--secondary" type="button" onClick={() => { setSearch(''); setStatusFilter('ALL') }}>Clear filters</button>
            </div>
            <p className="crosswalk-results" role="status">Showing {visible.length} of {findings.length} findings</p>
            <ol className="crosswalk-list">
              {visible.map((finding) => (
                <li key={finding.id}>
                  <button type="button" aria-pressed={selectedId === finding.id} onClick={() => setSelectedId(finding.id)}>
                    <div className="crosswalk-card__meta">
                      <span className={`finding-status finding-status--${finding.status.toLowerCase()}`}>{label(finding.status)}</span>
                      <span>Section {finding.requirement_section}</span>
                      <span>{Math.round(finding.score * 100)}% candidate score</span>
                      {finding.human_verified && <span className="human-verified">✓ Human verified</span>}
                      {finding.stale && <span className="stale-finding">Needs re-review</span>}
                    </div>
                    <strong>{finding.requirement_text}</strong>
                    <span>{finding.evidence[0]?.excerpt || 'No proposal evidence found.'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {selected && (
            <CrosswalkFindingEditor
              finding={selected}
              projectId={projectId}
              proposalDocuments={proposalDocuments}
              position={selectedIndex + 1}
              total={visible.length}
              isSaving={isSaving}
              onPrevious={() => moveSelection(-1)}
              onNext={() => moveSelection(1)}
              onClose={() => setSelectedId(null)}
              onSave={save}
              onEvidenceChanged={async () => {
                await load()
                onContinue?.()
              }}
            />
          )}
        </div>
      )}
    </section>
  )
}

interface CrosswalkFindingEditorProps {
  finding: CrosswalkFinding
  projectId: string
  proposalDocuments: ProjectDocument[]
  position: number
  total: number
  isSaving: boolean
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
  onSave: (update: CrosswalkUpdate) => Promise<void>
  onEvidenceChanged: () => Promise<void>
}

function CrosswalkFindingEditor({
  finding,
  projectId,
  proposalDocuments,
  position,
  total,
  isSaving,
  onPrevious,
  onNext,
  onClose,
  onSave,
  onEvidenceChanged,
}: CrosswalkFindingEditorProps) {
  const [status, setStatus] = useState(finding.status)
  const [reviewer, setReviewer] = useState(finding.reviewer ?? '')
  const [owner, setOwner] = useState(finding.owner ?? '')
  const [dueAt, setDueAt] = useState(finding.due_at?.slice(0, 10) ?? '')
  const [notes, setNotes] = useState(finding.notes ?? '')
  const [verified, setVerified] = useState(finding.human_verified)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showEvidencePicker, setShowEvidencePicker] = useState(false)
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null)

  useEffect(() => {
    setStatus(finding.status); setReviewer(finding.reviewer ?? ''); setOwner(finding.owner ?? '')
    setDueAt(finding.due_at?.slice(0, 10) ?? ''); setNotes(finding.notes ?? ''); setVerified(finding.human_verified); setLocalError(null); setShowEvidencePicker(false)
  }, [finding])

  const submit = async () => {
    if (verified && !reviewer.trim()) { setLocalError('A reviewer label is required for human verification.'); return }
    if (verified && ['COVERED', 'PARTIAL', 'CONFLICT'].includes(status) && finding.evidence.length === 0) {
      setLocalError('Add proposal evidence before verifying this finding status.')
      return
    }
    setLocalError(null)
    await onSave({
      status,
      reviewer: reviewer.trim() || null,
      owner: owner.trim() || null,
      due_at: dueAt ? new Date(`${dueAt}T12:00:00Z`).toISOString() : null,
      notes: notes.trim() || null,
      human_verified: verified,
    })
  }

  const removeEvidence = async (evidenceId: string) => {
    if (!window.confirm('Remove this manually cited proposal passage? The finding will require re-review.')) return
    setDeletingEvidenceId(evidenceId)
    setLocalError(null)
    try {
      await api.deleteCrosswalkEvidence(projectId, finding.id, evidenceId)
      await onEvidenceChanged()
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Could not remove the manual evidence passage.')
    } finally {
      setDeletingEvidenceId(null)
    }
  }

  return (
    <aside className="crosswalk-editor" aria-labelledby="crosswalk-editor-title">
      <header>
        <div><span>Finding {position} of {total}</span><h3 id="crosswalk-editor-title">Review response coverage</h3></div>
        <button type="button" aria-label="Close crosswalk finding" onClick={onClose}>×</button>
      </header>
      <div className="crosswalk-editor__body">
        <section className="crosswalk-requirement"><strong>Solicitation requirement</strong><p>{finding.requirement_text}</p><span>Section {finding.requirement_section}</span></section>
        <section className="crosswalk-evidence">
          <div className="crosswalk-evidence__heading">
            <strong>Proposal evidence</strong>
            <button className="button button--quiet button--small" type="button" onClick={() => setShowEvidencePicker((current) => !current)}>
              {showEvidencePicker ? 'Close source picker' : 'Add source passage'}
            </button>
          </div>
          {finding.evidence.length ? finding.evidence.map((evidence) => (
            <blockquote key={evidence.id}>
              <div className="crosswalk-evidence__citation">
                <span>{evidence.document_name} · {evidence.source_locator}{evidence.is_manual ? ' · Manually cited' : ''}</span>
                {evidence.is_manual && (
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    disabled={deletingEvidenceId === evidence.id}
                    aria-label={`Remove manual evidence from ${evidence.document_name || 'proposal document'}`}
                    onClick={() => void removeEvidence(evidence.id)}
                  >
                    {deletingEvidenceId === evidence.id ? 'Removing…' : 'Remove citation'}
                  </button>
                )}
              </div>
              {evidence.excerpt}
            </blockquote>
          )) : <p>No candidate evidence was found.</p>}
          {showEvidencePicker && (
            <EvidencePicker
              projectId={projectId}
              findingId={finding.id}
              documents={proposalDocuments}
              onAdded={async () => {
                await onEvidenceChanged()
                setShowEvidencePicker(false)
              }}
            />
          )}
        </section>
        <div className="crosswalk-editor__grid">
          <label>Finding<select value={status} onChange={(event) => setStatus(event.target.value as CrosswalkStatus)}>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label>Reviewer label (self-reported)<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></label>
          <label>Resolution owner<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
          <label>Due date<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        </div>
        <label className="crosswalk-notes">Resolution note<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label className="human-verification"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /><span>I verified this finding against the cited proposal evidence.</span></label>
        {localError && <p className="product-error" role="alert">{localError}</p>}
      </div>
      <footer>
        <div><button className="button button--secondary" type="button" onClick={onPrevious}>← Previous</button><button className="button button--secondary" type="button" onClick={onNext}>Next →</button></div>
        <button className="button button--primary" type="button" disabled={isSaving} onClick={() => void submit()}>{isSaving ? 'Saving…' : 'Save finding'}</button>
      </footer>
    </aside>
  )
}

interface EvidencePickerProps {
  projectId: string
  findingId: string
  documents: ProjectDocument[]
  onAdded: () => Promise<void>
}

function EvidencePicker({ projectId, findingId, documents, onAdded }: EvidencePickerProps) {
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? '')
  const [source, setSource] = useState<DocumentText | null>(null)
  const [start, setStart] = useState(0)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId) return
    let active = true
    setIsLoading(true)
    setError(null)
    setSelection(null)
    void api.getDocumentText(projectId, documentId, start)
      .then((result) => { if (active) setSource(result) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load proposal text.')
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [documentId, projectId, start])

  const captureSelection = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget
    setSelection(input.selectionEnd > input.selectionStart
      ? { start: input.selectionStart, end: input.selectionEnd }
      : null)
  }

  const addEvidence = async () => {
    if (!source || !selection || selection.end - selection.start > 8_000) return
    setIsSaving(true)
    setError(null)
    try {
      await api.addCrosswalkEvidence(projectId, findingId, {
        document_id: documentId,
        source_start: source.start + selection.start,
        source_end: source.start + selection.end,
      })
      await onAdded()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the selected evidence.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="evidence-picker" aria-label="Add proposal evidence">
      <label>
        Proposal volume
        <select value={documentId} onChange={(event) => { setDocumentId(event.target.value); setStart(0) }}>
          {documents.map((document) => (
            <option key={document.id} value={document.id}>{document.volume_name || document.name}</option>
          ))}
        </select>
      </label>
      <p>Select the exact response passage below. The saved citation records its document and character range.</p>
      {error && <p className="product-error" role="alert">{error}</p>}
      {isLoading ? <p role="status">Loading proposal text…</p> : source && (
        <>
          <textarea
            aria-label="Proposal source text"
            readOnly
            rows={12}
            value={source.text}
            onSelect={captureSelection}
          />
          <div className="evidence-picker__controls">
            <button className="button button--quiet button--small" type="button" disabled={source.start === 0 || isLoading} onClick={() => setStart(Math.max(0, source.start - 20_000))}>Previous text</button>
            <span>Characters {source.start.toLocaleString()}–{source.end.toLocaleString()} of {source.total_characters.toLocaleString()}</span>
            <button className="button button--quiet button--small" type="button" disabled={!source.truncated || isLoading} onClick={() => setStart(source.end)}>Next text</button>
          </div>
        </>
      )}
      <button className="button button--primary button--small" type="button" disabled={!selection || selection.end - selection.start > 8_000 || isSaving} onClick={() => void addEvidence()}>
        {isSaving
          ? 'Adding passage…'
          : selection && selection.end - selection.start > 8_000
            ? 'Selection is too long (8,000 character maximum)'
            : selection
              ? `Add selected passage (${selection.end - selection.start} characters)`
              : 'Select a passage to add'}
      </button>
    </div>
  )
}
