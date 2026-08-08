import { type KeyboardEvent } from 'react'

export type WorkflowStageId =
  | 'setup'
  | 'solicitation-files'
  | 'verify-package'
  | 'requirements'
  | 'proposal-response'
  | 'crosswalk'
  | 'reports'

export interface WorkflowStage {
  id: WorkflowStageId
  label: string
  shortLabel?: string
  status: 'complete' | 'attention' | 'ready' | 'waiting'
  statusLabel: string
  statusDetail?: string
}

interface WorkflowRailProps {
  stages: WorkflowStage[]
  activeStage: WorkflowStageId
  onChange: (stage: WorkflowStageId) => void
}

export function WorkflowRail({ stages, activeStage, onChange }: WorkflowRailProps) {
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % stages.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + stages.length) % stages.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = stages.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = stages[nextIndex]
    onChange(next.id)
    queueMicrotask(() => document.getElementById(`workflow-stage-${next.id}`)?.focus())
  }

  return (
    <nav className="workflow-rail" aria-label="Project workflow">
      <ol>
        {stages.map((stage, index) => (
          <li key={stage.id} className={`workflow-rail__${stage.status}`}>
            <button
              id={`workflow-stage-${stage.id}`}
              type="button"
              aria-label={`${stage.shortLabel || stage.label} ${stage.statusLabel}${stage.statusDetail ? `: ${stage.statusDetail}` : ''}`}
              aria-current={activeStage === stage.id ? 'step' : undefined}
              onClick={() => onChange(stage.id)}
              onKeyDown={(event) => navigate(event, index)}
            >
              <span className="workflow-rail__number" aria-hidden="true">
                {stage.status === 'complete' ? '✓' : index + 1}
              </span>
              <span className="workflow-rail__copy">
                <strong>{stage.shortLabel || stage.label}</strong>
                <small title={stage.statusDetail}>{stage.statusLabel}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
