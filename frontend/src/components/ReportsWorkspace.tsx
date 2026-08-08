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
}

const actionStatuses: ActionStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']

function title(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function compact(value: string, length = 90) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

export function ReportsWorkspace({ projectId }: ReportsWorkspaceProps) {
  const [readiness, setReadiness] = useState<ReadinessSummary | null>(null)
  const [actions, setActions] = useState<ProjectAction[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [findings, setFindings] = useState<CrosswalkFinding[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showActionForm, setShowActionForm] = useState(false)
  const [showCompletedActions, setShowCompletedActions] = useState(false)

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

  return (
    <div className="reports-workspace">
      <section className="product-panel" aria-labelledby="readiness-title">
        <header className="product-panel__header">
          <div>
            <span className="product-eyebrow">Submission readiness</span>
            <h2 id="readiness-title">Readiness and unresolved gaps</h2>
            <p>Human verification—not automated matching—determines whether proposal coverage is ready.</p>
          </div>
          {readiness && (
            <div className={`readiness-score${readiness.ready ? ' readiness-score--ready' : ''}`}>
              <strong>{Math.round(readiness.readiness_percent)}%</strong><span>{readiness.ready ? 'Ready' : 'In progress'}</span>
            </div>
          )}
        </header>

        {isLoading ? <div className="product-state" aria-busy="true">Calculating readiness…</div> : error ? <p className="product-error reports-message" role="alert">{error}</p> : readiness && (
          <>
            <div className="readiness-metrics">
              <article><span>Requirements verified</span><strong>{readiness.requirements_validated}/{readiness.requirements_total}</strong></article>
              <article><span>CDRLs ready</span><strong>{readiness.cdrls_ready}/{readiness.cdrls_total}</strong></article>
              <article className={readiness.cdrls_incomplete > 0 ? 'metric-warning' : undefined}><span>CDRLs incomplete</span><strong>{readiness.cdrls_incomplete}</strong></article>
              <article className={readiness.cdrls_unreviewed > 0 || readiness.cdrls_stale > 0 ? 'metric-danger' : undefined}><span>CDRL review needed</span><strong>{readiness.cdrls_unreviewed + readiness.cdrls_stale}</strong></article>
              <article><span>Crosswalk verified</span><strong>{readiness.crosswalk_verified}/{readiness.crosswalk_total}</strong></article>
              <article className="metric-good"><span>Covered</span><strong>{readiness.covered}</strong></article>
              <article className="metric-warning"><span>Partial</span><strong>{readiness.partial}</strong></article>
              <article className="metric-danger"><span>Missing</span><strong>{readiness.missing}</strong></article>
              <article className="metric-danger"><span>Conflicts</span><strong>{readiness.conflict}</strong></article>
              <article><span>Unverified</span><strong>{readiness.unverified}</strong></article>
              <article><span>Open actions</span><strong>{readiness.actions_open}</strong></article>
            </div>
            <div className="readiness-next-action"><div><strong>Recommended next action</strong><p>{readiness.next_action ?? 'Review the current registers and download the compliance workbook.'}</p></div><button className="button button--secondary" type="button" onClick={() => void load()}>Refresh readiness</button></div>
            {readiness.blocking_reasons.length > 0 && <section className="readiness-blockers" aria-labelledby="readiness-blockers-title"><h3 id="readiness-blockers-title">Blocking issues</h3><ul>{readiness.blocking_reasons.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></section>}
          </>
        )}
      </section>

      <section className="product-panel" aria-labelledby="actions-title">
        <header className="product-panel__header compact-product-header">
          <div><span className="product-eyebrow">Resolution ownership</span><h2 id="actions-title">Action register</h2><p>Assign gaps, deadlines, and resolution work without losing the related compliance context.</p></div>
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

      <section className="product-panel" aria-labelledby="exports-title">
        <header className="product-panel__header compact-product-header"><div><span className="product-eyebrow">Current outputs</span><h2 id="exports-title">Download compliance records</h2><p>Export current registers for proposal reviews, working sessions, and archival.</p></div></header>
        <div className="export-grid">
          <a className="export-card export-card--primary" href={api.workbookUrl(projectId)}><strong>Compliance workbook</strong><span>One XLSX with Requirements, Section L, Section M, CDRLs, Crosswalk, and Readiness sheets.</span><b>Download XLSX →</b></a>
          {['requirements', 'section-l', 'section-m', 'cdrls', 'crosswalk', 'readiness'].map((register) => <div className="export-card" key={register}><strong>{title(register)}</strong><span>Machine-readable and spreadsheet-friendly current register.</span><div><a href={api.exportUrl(projectId, register, 'csv')}>CSV</a><a href={api.exportUrl(projectId, register, 'json')}>JSON</a></div></div>)}
        </div>
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
