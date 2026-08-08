import type { Project, ProjectCreate } from '../types'
import { NewProjectForm } from './NewProjectForm'

interface ProjectSidebarProps {
  projects: Project[]
  selectedId: string | null
  isLoading: boolean
  isCreating: boolean
  onSelect: (projectId: string) => void
  onCreate: (project: ProjectCreate) => Promise<void>
}

export function ProjectSidebar({
  projects,
  selectedId,
  isLoading,
  isCreating,
  onSelect,
  onCreate,
}: ProjectSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Project navigation">
      <section className="project-list" aria-labelledby="project-list-title">
        <div className="project-list__heading">
          <div>
            <div className="section-kicker">Solicitations</div>
            <h2 id="project-list-title">Projects</h2>
          </div>
          <span className="count-badge" aria-label={`${projects.length} projects`}>
            {projects.length}
          </span>
        </div>

        {isLoading ? (
          <div className="skeleton-list" aria-label="Loading projects" aria-busy="true">
            <span /><span /><span />
          </div>
        ) : projects.length === 0 ? (
          <div className="sidebar-empty">
            <span aria-hidden="true">＋</span>
            <p>No projects yet</p>
            <small>Create one below to begin intake.</small>
          </div>
        ) : (
          <nav aria-label="Available projects">
            <ul className="project-list__items">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="project-link"
                    aria-current={selectedId === project.id ? 'page' : undefined}
                    onClick={() => onSelect(project.id)}
                  >
                    <span className="project-link__monogram" aria-hidden="true">
                      {project.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="project-link__copy">
                      <strong>{project.name}</strong>
                      <small>{project.solicitation_number || 'Solicitation pending'}</small>
                    </span>
                    <span className={`sensitivity sensitivity--${project.sensitivity.toLowerCase()}`}>
                      {project.sensitivity}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      <NewProjectForm isSubmitting={isCreating} onCreate={onCreate} />
    </aside>
  )
}
