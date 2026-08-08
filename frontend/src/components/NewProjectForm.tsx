import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ProjectCreate } from '../types'

interface NewProjectFormProps {
  isOpen: boolean
  isSubmitting: boolean
  onCancel: () => void
  onCreate: (project: ProjectCreate) => Promise<void>
}

const initialProject: ProjectCreate = {
  name: '',
  solicitation_number: '',
  agency: '',
  due_at: '',
  sensitivity: 'PUBLIC',
}

export function NewProjectForm({
  isOpen,
  isSubmitting,
  onCancel,
  onCreate,
}: NewProjectFormProps) {
  const [project, setProject] = useState(initialProject)
  const [step, setStep] = useState<1 | 2>(1)
  const [publicDataConfirmed, setPublicDataConfirmed] = useState(false)
  const [dueInputInvalid, setDueInputInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const dueInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => nameInputRef.current?.focus(), 0)
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onCancel()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, isSubmitting, onCancel])

  useEffect(() => {
    if (isOpen) return
    setProject(initialProject)
    setStep(1)
    setPublicDataConfirmed(false)
    setDueInputInvalid(false)
    setError(null)
  }, [isOpen])

  if (!isOpen) return null

  const update = (field: keyof ProjectCreate, value: string) => {
    setProject((current) => ({ ...current, [field]: value }))
  }

  const continueToDetails = () => {
    setError(null)
    if (!project.name.trim()) {
      setError('Enter a project name to continue.')
      nameInputRef.current?.focus()
      return
    }
    setStep(2)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step === 1) {
      continueToDetails()
      return
    }

    setError(null)
    if (dueInputInvalid || dueInputRef.current?.validity.badInput) {
      setError('Enter both a proposal due date and time, or clear the deadline field.')
      dueInputRef.current?.focus()
      return
    }
    if (!publicDataConfirmed) {
      setError('Confirm the PUBLIC-data boundary before creating this project.')
      return
    }

    const payload: ProjectCreate = {
      name: project.name.trim(),
      sensitivity: 'PUBLIC',
      ...(project.solicitation_number?.trim() && {
        solicitation_number: project.solicitation_number.trim(),
      }),
      ...(project.agency?.trim() && { agency: project.agency.trim() }),
      ...(project.due_at && {
        due_at: new Date(project.due_at).toISOString(),
        due_timezone: localTimeZone,
      }),
    }

    try {
      await onCreate(payload)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create project.')
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onCancel()
      }}
    >
      <section
        className="project-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="project-wizard__header">
          <div>
            <div className="section-kicker">New compliance workspace</div>
            <h1 id={titleId}>Create a project</h1>
            <p id={descriptionId}>Set up one solicitation package in two short steps.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close project setup"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            ×
          </button>
        </header>

        <ol className="wizard-progress" aria-label="Project setup progress">
          <li className={step === 1 ? 'wizard-progress__active' : 'wizard-progress__complete'}>
            <span aria-hidden="true">{step === 1 ? '1' : '✓'}</span>
            Project basics
          </li>
          <li className={step === 2 ? 'wizard-progress__active' : ''}>
            <span aria-hidden="true">2</span>
            Due date and data boundary
          </li>
        </ol>

        <form className="new-project" onSubmit={submit} noValidate>
          {step === 1 ? (
            <div className="wizard-step">
              <div className="wizard-step__intro">
                <h2>Identify the opportunity</h2>
                <p>You can add documents immediately after this project is created.</p>
              </div>

              <label>
                Project name <span aria-hidden="true">*</span>
                <input
                  ref={nameInputRef}
                  name="name"
                  value={project.name}
                  onChange={(event) => update('name', event.target.value)}
                  autoComplete="off"
                  required
                  aria-invalid={Boolean(error && !project.name.trim())}
                />
              </label>

              <label>
                Solicitation number
                <input
                  name="solicitation_number"
                  value={project.solicitation_number}
                  onChange={(event) => update('solicitation_number', event.target.value)}
                  autoComplete="off"
                  placeholder="For example: FA0000-26-R-0001"
                />
              </label>

              <label>
                Agency or customer
                <input
                  name="agency"
                  value={project.agency}
                  onChange={(event) => update('agency', event.target.value)}
                  autoComplete="organization"
                  placeholder="For example: Department of the Air Force"
                />
              </label>
            </div>
          ) : (
            <div className="wizard-step">
              <div className="wizard-step__intro">
                <h2>Set the deadline and confirm the boundary</h2>
                <p>This public demonstration cannot protect real procurement or proposal data.</p>
              </div>

              <label>
                Proposal due date and time
                <input
                  ref={dueInputRef}
                  type="datetime-local"
                  name="due_at"
                  value={project.due_at}
                  onChange={(event) => {
                    setDueInputInvalid(event.currentTarget.validity.badInput)
                    update('due_at', event.target.value)
                  }}
                  aria-invalid={dueInputInvalid || undefined}
                />
                <small className="timezone-note">Interpreted in {localTimeZone}</small>
              </label>

              <div className="classification-card" aria-label="Data classification">
                <span className="sensitivity sensitivity--public">PUBLIC</span>
                <div>
                  <strong>PUBLIC synthetic data only</strong>
                  <p>CUI, ITAR-controlled, classified, proprietary, and source-selection data are not allowed.</p>
                </div>
              </div>

              <label className="boundary-confirmation">
                <input
                  type="checkbox"
                  checked={publicDataConfirmed}
                  onChange={(event) => setPublicDataConfirmed(event.target.checked)}
                />
                <span>
                  I will use only synthetic PUBLIC data and understand that every visitor can view
                  or change this shared project.
                </span>
              </label>

              <dl className="project-review">
                <div><dt>Project</dt><dd>{project.name.trim()}</dd></div>
                <div><dt>Solicitation</dt><dd>{project.solicitation_number?.trim() || 'Not set'}</dd></div>
                <div><dt>Agency</dt><dd>{project.agency?.trim() || 'Not set'}</dd></div>
                <div>
                  <dt>Proposal due</dt>
                  <dd>{project.due_at ? `${project.due_at.replace('T', ' ')} (${localTimeZone})` : 'Not set'}</dd>
                </div>
              </dl>
            </div>
          )}

          {error && <p className="inline-error" role="alert">{error}</p>}

          <footer className="project-wizard__actions">
            {step === 1 ? (
              <>
                <button className="button button--quiet" type="button" onClick={onCancel}>Cancel</button>
                <button className="button button--primary" type="submit">Continue</button>
              </>
            ) : (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => { setStep(1); setError(null); setDueInputInvalid(false) }}
                  disabled={isSubmitting}
                >
                  Back
                </button>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={isSubmitting || !publicDataConfirmed}
                >
                  {isSubmitting ? 'Creating project…' : 'Create project'}
                </button>
              </>
            )}
          </footer>
        </form>
      </section>
    </div>
  )
}
