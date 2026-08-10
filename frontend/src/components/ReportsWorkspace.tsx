import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type {
  ActionStatus,
  CrosswalkFinding,
  ProjectAction,
  ProjectActionCreate,
  ReadinessSummary,
  Requirement,
} from '../types'
import './product-workflow.css'

interface ReportsWorkspaceProps {
  projectId: string
  isAnonymous?: boolean
}

const actionStatuses: ActionStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']

function title(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function compact(value: string, length = 90) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function formatCoveragePercent(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatCount(value: number | undefined) {
  return (value ?? 0).toLocaleString()
}

type ReportKind = 'compliance' | 'gaps'

function saveDownloadedFile(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

export function ReportsWorkspace({ projectId, isAnonymous = false }: ReportsWorkspaceProps) {
  const [readiness, setReadiness] = useState<ReadinessSummary | null>(null)
  const [actions, setActions] = useState<ProjectAction[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [findings, setFindings] = useState<CrosswalkFinding[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showActionForm, setShowActionForm] = useState(false)
  const [showCompletedActions, setShowCompletedActions] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState<ReportKind | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [nextReadiness, nextActions, nextRequirements, nextFindings] = await Promise.all([
        api.getReadiness(projectId),
        api.listActions(projectId),
        api.listRequirements(projectId),
        api.listCrosswalk(projectId),
      ])
      setReadiness(nextReadiness)
      setActions(nextActions)
      setRequirements(nextRequirements)
      setFindings(nextFindings)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load readiness information.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openActions = useMemo(() => actions.filter((action) => action.status !== 'DONE'), [actions])
  const completedActions = actions.length - openActions.length
  const gapStatusCounts = useMemo(() => findings.reduce(
    (counts, finding) => {
      if (finding.status === 'PARTIAL') counts.partial += 1
      if (finding.status === 'MISSING') counts.missing += 1
      if (finding.status === 'CONFLICT') counts.conflict += 1
      return counts
    },
    { partial: 0, missing: 0, conflict: 0 },
  ), [findings])
  const gapCount = gapStatusCounts.partial + gapStatusCounts.missing + gapStatusCounts.conflict
  const hasSavedAssessment = findings.length > 0
  const hasCompleteAssessment = Boolean(
    readiness
    && readiness.requirements_total > 0
    && readiness.crosswalk_total === readiness.requirements_total,
  )
  const hasStaleFindings = findings.some((finding) => finding.stale)
  const visibleActions = showCompletedActions ? actions : openActions
  const requirementsById = useMemo(
    () => new Map(requirements.map((requirement) => [requirement.id, requirement])),
    [requirements],
  )
  const findingsById = useMemo(
    () => new Map(findings.map((finding) => [finding.id, finding])),
    [findings],
  )

  const createAction = async (action: ProjectActionCreate) => {
    const created = await api.createAction(projectId, action)
    setActions((current) => [...current, created])
    setShowActionForm(false)
    void load()
  }

  const updateStatus = async (action: ProjectAction, status: ActionStatus) => {
    setError(null)
    try {
      const updated = await api.updateAction(projectId, action.id, { status })
      setActions((current) => current.map((item) => item.id === updated.id ? updated : item))
      void load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the action status.')
    }
  }

  const downloadReport = async (kind: ReportKind) => {
    if (
      !hasSavedAssessment
      || downloadingReport
      || isLoading
      || (kind === 'gaps' && (!hasCompleteAssessment || hasStaleFindings))
    ) return
    setDownloadingReport(kind)
    setDownloadError(null)
    setDownloadMessage(null)
    try {
      const file = kind === 'compliance'
        ? await api.downloadComplianceReport(projectId)
        : await api.downloadGapReport(projectId)
      saveDownloadedFile(file.blob, file.filename)
      setDownloadMessage(kind === 'compliance'
        ? 'Compliance assessment report downloaded.'
        : 'Requirements gap report downloaded.')
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : 'Unable to create the report.')
    } finally {
      setDownloadingReport(null)
    }
  }

  return (
    <div className="reports-workspace">
      <section className="product-panel" aria-labelledby="readiness-title">
        <header className="product-panel__header">
          <div>
            <span className="product-eyebrow">Automated proposal assessment</span>
            <h2 id="readiness-title">Coverage summary</h2>
            <p>This is an evidence-backed screening result, not a legal or contracting-officer determination. Reviewer confirmation is optional and intended for exceptions.</p>
          </div>
          {readiness && (
            <div className={`readiness-score${readiness.ready ? ' readiness-score--ready' : ''}`}>
              <strong>{formatCoveragePercent(readiness.readiness_percent)}%</strong><span>{readiness.ready ? 'No gaps found' : readiness.crosswalk_total > 0 ? 'Attention needed' : 'Not analyzed'}</span>
            </div>
          )}
        </header>

        {isLoading ? <div className="product-state" aria-busy="true">Calculating proposal coverage…</div> : error ? <p className="product-error reports-message" role="alert">{error}</p> : readiness && (
          <>
            <div className="readiness-metrics">
              <article><span>Requirements found</span><strong>{readiness.requirements_total}</strong></article>
              <article><span>Requirements assessed</span><strong>{readiness.crosswalk_total}/{readiness.requirements_total}</strong></article>
              <article className="metric-good"><span>Covered</span><strong>{readiness.covered}</strong></article>
              <article><span>Not applicable</span><strong>{readiness.n_a}</strong></article>
              <article className="metric-warning"><span>Partial</span><strong>{readiness.partial}</strong></article>
              <article className="metric-danger"><span>Missing</span><strong>{readiness.missing}</strong></article>
              <article className="metric-danger"><span>Conflicts</span><strong>{readiness.conflict}</strong></article>
              <article><span>Reviewer-confirmed (optional)</span><strong>{readiness.crosswalk_verified}</strong></article>
            </div>
            <div className="readiness-next-action"><div><strong>Assessment status</strong><p>{readiness.next_action ?? 'Review the coverage results and download the current records.'}</p></div><button className="button button--secondary" type="button" onClick={() => void load()}>Refresh assessment</button></div>
            {readiness.blocking_reasons.length > 0 && <section className="readiness-blockers" aria-labelledby="readiness-blockers-title"><h3 id="readiness-blockers-title">Items needing attention</h3><ul>{readiness.blocking_reasons.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></section>}
          </>
        )}
      </section>

      <section className="product-panel" aria-labelledby="actions-title">
        <header className="product-panel__header compact-product-header">
          <div><span className="product-eyebrow">Optional remediation</span><h2 id="actions-title">Action register</h2><p>Assign real gaps and resolution work without turning every extracted requirement into a task.</p></div>
          <div className="action-header-controls">
            {completedActions > 0 && (
              <button className="button button--quiet" type="button" aria-pressed={showCompletedActions} onClick={() => setShowCompletedActions((current) => !current)}>
                {showCompletedActions ? 'Hide completed' : `Show completed (${completedActions})`}
              </button>
            )}
            <button className="button button--primary" type="button" onClick={() => setShowActionForm((current) => !current)}>{showActionForm ? 'Close form' : 'Add action'}</button>
          </div>
        </header>
        {showActionForm && <ActionForm requirements={requirements} findings={findings} onCreate={createAction} />}
        <div className="action-register">
          {visibleActions.length === 0 ? <div className="product-empty"><strong>No open actions</strong><p>Create an action when a requirement, CDRL, or crosswalk finding needs an owner.</p></div> : <ul>{visibleActions.map((action) => {
            const requirement = action.requirement_id ? requirementsById.get(action.requirement_id) : undefined
            const finding = action.finding_id ? findingsById.get(action.finding_id) : undefined
            return <li key={action.id}><div><strong>{action.title}</strong><span>{action.description || 'No description'}{action.owner ? ` · Owner: ${action.owner}` : ''}{action.due_at ? ` · Due ${new Date(action.due_at).toLocaleDateString()}` : ''}</span>{requirement && <span className="action-context">Requirement · {compact(requirement.requirement_text)}</span>}{finding && <span className="action-context">Crosswalk finding · {title(finding.status)} · {compact(finding.requirement_text)}</span>}</div><select aria-label={`Status for ${action.title}`} value={action.status} onChange={(event) => void updateStatus(action, event.target.value as ActionStatus)}>{actionStatuses.map((status) => <option key={status} value={status}>{title(status)}</option>)}</select></li>
          })}</ul>}
        </div>
      </section>

      <section className="product-panel" aria-labelledby="reports-title">
        <header className="product-panel__header compact-product-header">
          <div>
            <span className="product-eyebrow">Shareable deliverables</span>
            <h2 id="reports-title">Create reports</h2>
            <p>Create a current compliance assessment for decision-makers or a focused gap list for the proposal team.</p>
          </div>
        </header>

        {isAnonymous && (
          <aside className="report-boundary" aria-label="Public demo report warning">
            <strong>Synthetic PUBLIC data only.</strong>
            <span>Reports downloaded from this anonymous site must not contain proprietary, customer, CUI, ITAR-controlled, or classified content.</span>
          </aside>
        )}

        {!isLoading && readiness && !hasSavedAssessment && (
          <div className="report-assessment-notice" id="report-availability-note" role="status">
            <strong>Analyze the proposal before creating reports.</strong>
            <span>No requirements have been assessed yet, so zero gaps does not mean the proposal is compliant.</span>
          </div>
        )}
        {hasSavedAssessment && hasStaleFindings && (
          <div className="report-assessment-notice report-assessment-notice--warning" id="report-availability-note" role="status">
            <strong>The saved assessment is out of date.</strong>
            <span>Reanalyze before sharing. The DOCX will flag the saved state; the gap CSV requires a fresh assessment.</span>
          </div>
        )}
        {hasSavedAssessment && !hasStaleFindings && !hasCompleteAssessment && (
          <div className="report-assessment-notice report-assessment-notice--warning" id="report-availability-note" role="status">
            <strong>The saved assessment is incomplete or contains invalid results.</strong>
            <span>Reanalyze before exporting the gap CSV. The DOCX will document the currently saved state.</span>
          </div>
        )}
        {downloadError && <p className="product-error report-download-message" role="alert">Report creation failed: {downloadError}</p>}
        {downloadMessage && <p className="product-success report-download-message" role="status">{downloadMessage}</p>}

        <div className="report-grid">
          <article className="report-card report-card--primary">
            <header>
              <div>
                <span className="report-card__format">DOCX</span>
                <h3>Compliance assessment report</h3>
              </div>
              <span className="report-card__audience">Leadership and review teams</span>
            </header>
            <p>A formatted, human-readable report with the project summary, coverage results, priority gaps, requirement-level findings and evidence, and the action register.</p>
            {hasSavedAssessment ? (
              <div className="report-card__snapshot" aria-label="Current compliance report snapshot">
                <span><strong>{formatCount(readiness?.crosswalk_total)}</strong> assessed</span>
                <span><strong>{formatCount(readiness?.covered)}</strong> covered</span>
                <span><strong>{formatCount(gapCount)}</strong> gaps</span>
              </div>
            ) : (
              <div className="report-card__snapshot report-card__snapshot--empty">Proposal analysis required</div>
            )}
            <button
              className="button button--primary report-download"
              type="button"
              disabled={isLoading || !hasSavedAssessment || downloadingReport !== null}
              aria-describedby={!isLoading && readiness && (!hasSavedAssessment || hasStaleFindings || !hasCompleteAssessment) ? 'report-availability-note' : undefined}
              onClick={() => void downloadReport('compliance')}
            >
              {downloadingReport === 'compliance' ? 'Creating DOCX...' : 'Create and download DOCX'}
            </button>
            <small>Built from the latest saved project and proposal assessment when you download it.</small>
          </article>

          <article className="report-card report-card--gaps">
            <header>
              <div>
                <span className="report-card__format">CSV</span>
                <h3>Requirements gap report</h3>
              </div>
              <span className="report-card__audience">Proposal owners and writers</span>
            </header>
            <p>A focused working report of partial, missing, and conflicting requirements with scores, solicitation sources, proposal evidence, notes, owners, and due dates.</p>
            {hasSavedAssessment ? (
              <div className="report-card__snapshot" aria-label="Current gap report snapshot">
                <span><strong>{formatCount(gapStatusCounts.partial)}</strong> partial</span>
                <span><strong>{formatCount(gapStatusCounts.missing)}</strong> missing</span>
                <span><strong>{formatCount(gapStatusCounts.conflict)}</strong> conflicts</span>
              </div>
            ) : (
              <div className="report-card__snapshot report-card__snapshot--empty">Proposal analysis required</div>
            )}
            <button
              className="button button--secondary report-download"
              type="button"
              disabled={isLoading || !hasCompleteAssessment || hasStaleFindings || downloadingReport !== null}
              aria-describedby={!isLoading && readiness && (!hasSavedAssessment || hasStaleFindings || !hasCompleteAssessment) ? 'report-availability-note' : undefined}
              onClick={() => void downloadReport('gaps')}
            >
              {downloadingReport === 'gaps' ? 'Creating CSV...' : 'Create and download CSV'}
            </button>
            <small>Includes only findings that need attention; covered and not-applicable items are excluded.</small>
          </article>
        </div>

        <details className="raw-exports">
          <summary>
            <span><strong>Raw data exports</strong><small>Workbook, CSV, and JSON records for deeper analysis or archival.</small></span>
          </summary>
          <div className="export-grid">
            <a className="export-card export-card--primary" href={api.workbookUrl(projectId)} download>
              <strong>Compliance workbook</strong>
              <span>One XLSX with Requirements, Section L, Section M, CDRLs, Crosswalk, and Readiness sheets.</span>
              <b>Download XLSX</b>
            </a>
            {['requirements', 'section-l', 'section-m', 'cdrls', 'crosswalk', 'readiness'].map((register) => (
              <div className="export-card" key={register}>
                <strong>{title(register)}</strong>
                <span>Machine-readable and spreadsheet-friendly current register.</span>
                <div>
                  <a href={api.exportUrl(projectId, register, 'csv')} download aria-label={`Download ${title(register)} as CSV`}>CSV</a>
                  <a href={api.exportUrl(projectId, register, 'json')} download aria-label={`Download ${title(register)} as JSON`}>JSON</a>
                </div>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  )
}

function ActionForm({
  requirements,
  findings,
  onCreate,
}: {
  requirements: Requirement[]
  findings: CrosswalkFinding[]
  onCreate: (action: ProjectActionCreate) => Promise<void>
}) {
  const [titleValue, setTitleValue] = useState('')
  const [description, setDescription] = useState('')
  const [owner, setOwner] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [context, setContext] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!titleValue.trim()) { setError('Action title is required.'); return }
    setIsSaving(true); setError(null)
    try {
      await onCreate({
        title: titleValue.trim(),
        description: description.trim() || null,
        owner: owner.trim() || null,
        due_at: dueAt ? new Date(`${dueAt}T12:00:00Z`).toISOString() : null,
        status: 'TODO',
        requirement_id: context.startsWith('requirement:') ? context.slice('requirement:'.length) : null,
        finding_id: context.startsWith('finding:') ? context.slice('finding:'.length) : null,
      })
    }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to create action.') }
    finally { setIsSaving(false) }
  }
  return <div className="action-form"><label>Action title<input value={titleValue} onChange={(event) => setTitleValue(event.target.value)} /></label><label>Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label><label>Due date<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label className="action-form__context">Related compliance item<select value={context} onChange={(event) => setContext(event.target.value)}><option value="">No linked item</option>{requirements.length > 0 && <optgroup label="Requirements">{requirements.map((requirement) => <option key={requirement.id} value={`requirement:${requirement.id}`}>Section {requirement.section} · {compact(requirement.requirement_text)}</option>)}</optgroup>}{findings.length > 0 && <optgroup label="Crosswalk findings">{findings.map((finding) => <option key={finding.id} value={`finding:${finding.id}`}>{title(finding.status)} · {compact(finding.requirement_text)}</option>)}</optgroup>}</select><small>Optional. Keeps the corrective action connected to its requirement or finding.</small></label>{error && <p className="product-error" role="alert">{error}</p>}<button className="button button--primary" type="button" disabled={isSaving} onClick={() => void submit()}>{isSaving ? 'Saving…' : 'Create action'}</button></div>
}
