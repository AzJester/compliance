import { useState, type FormEvent } from 'react'
import type { ProjectCreate, Sensitivity } from '../types'

interface NewProjectFormProps {
  isSubmitting: boolean
  onCreate: (project: ProjectCreate) => Promise<void>
}

const initialProject: ProjectCreate = {
  name: '',
  solicitation_number: '',
  agency: '',
  due_at: '',
  sensitivity: 'PUBLIC',
}

export function NewProjectForm({ isSubmitting, onCreate }: NewProjectFormProps) {
  const [project, setProject] = useState(initialProject)
  const [error, setError] = useState<string | null>(null)
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const update = (field: keyof ProjectCreate, value: string) => {
    setProject((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!project.name.trim()) {
      setError('Project name is required.')
      return
    }

    const payload: ProjectCreate = {
      name: project.name.trim(),
      sensitivity: project.sensitivity,
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
      setProject(initialProject)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create project.')
    }
  }

  return (
    <form className="new-project" onSubmit={submit} aria-labelledby="new-project-title">
      <div className="section-kicker">Workspace setup</div>
      <h2 id="new-project-title">New project</h2>
      <p className="form-intro">Create a protected workspace for one solicitation package.</p>

      <label>
        Project name <span aria-hidden="true">*</span>
        <input
          name="name"
          value={project.name}
          onChange={(event) => update('name', event.target.value)}
          autoComplete="off"
          required
        />
      </label>

      <div className="field-row">
        <label>
          Solicitation number
          <input
            name="solicitation_number"
            value={project.solicitation_number}
            onChange={(event) => update('solicitation_number', event.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Sensitivity
          <select
            name="sensitivity"
            value={project.sensitivity}
            onChange={(event) => update('sensitivity', event.target.value as Sensitivity)}
          >
            <option value="PUBLIC">Public</option>
            <option value="CUI" disabled>CUI (not enabled in prototype)</option>
            <option value="ITAR" disabled>ITAR (not enabled in prototype)</option>
          </select>
          <small>Use public, synthetic, or otherwise approved non-sensitive data only.</small>
        </label>
      </div>

      <label>
        Agency
        <input
          name="agency"
          value={project.agency}
          onChange={(event) => update('agency', event.target.value)}
          autoComplete="organization"
        />
      </label>

      <label>
        Proposal due date
        <input
          type="datetime-local"
          name="due_at"
          value={project.due_at}
          onChange={(event) => update('due_at', event.target.value)}
        />
        <small className="timezone-note">Interpreted in {localTimeZone}</small>
      </label>

      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button button--primary button--full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating project…' : 'Create project'}
      </button>
    </form>
  )
}
