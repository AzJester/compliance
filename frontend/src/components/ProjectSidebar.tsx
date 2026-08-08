import { useMemo, useState } from 'react'
import type { Project } from '../types'

interface ProjectSidebarProps {
  projects: Project[]
  selectedId: string | null
  isLoading: boolean
  isOpen: boolean
  isCollapsed: boolean
  onSelect: (projectId: string) => void
  onCreateRequest: () => void
  onClose: () => void
  onToggleCollapsed: () => void
}

export function ProjectSidebar({
  projects,
  selectedId,
  isLoading,
  isOpen,
  isCollapsed,
  onSelect,
  onCreateRequest,
  onClose,
  onToggleCollapsed,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('')
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return projects
    return projects.filter((project) => (
      project.name.toLocaleLowerCase().includes(normalized) ||
      project.solicitation_number?.toLocaleLowerCase().includes(normalized) ||
      project.agency?.toLocaleLowerCase().includes(normalized)
    ))
  }, [projects, query])

  const selectProject = (projectId: string) => {
    onSelect(projectId)
    onClose()
  }

  return (
    <>
      <button
        type="button"
        className={`sidebar-scrim${isOpen ? ' sidebar-scrim--visible' : ''}`}
        aria-label="Close project menu"
        aria-hidden={!isOpen}
        disabled={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />
      <aside
        className={`sidebar${isOpen ? ' sidebar--open' : ''}${isCollapsed ? ' sidebar--collapsed' : ''}`}
        aria-label="Project navigation"
      >
        <div className="sidebar__toolbar">
          <div className="sidebar__title">
            <span className="section-kicker">Solicitations</span>
            <strong>Project switcher</strong>
          </div>
          <button
            className="icon-button sidebar__mobile-close"
            type="button"
            aria-label="Close project menu"
            onClick={onClose}
          >
            ×
          </button>
          <button
            className="icon-button sidebar__collapse"
            type="button"
            aria-label={isCollapsed ? 'Expand project sidebar' : 'Collapse project sidebar'}
            aria-expanded={!isCollapsed}
            onClick={onToggleCollapsed}
          >
            {isCollapsed ? '›' : '‹'}
          </button>
        </div>

        <button
          className="button button--primary sidebar__new-project"
          type="button"
          onClick={onCreateRequest}
        >
          <span aria-hidden="true">+</span>
          <span className="sidebar__label">New project</span>
        </button>

        {!isCollapsed && (
          <section className="project-list" aria-labelledby="project-list-title">
            <div className="project-list__heading">
              <h2 id="project-list-title">Projects</h2>
              <span className="count-badge" aria-label={`${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}>
                {projects.length}
              </span>
            </div>

            {projects.length > 0 && (
              <label className="project-search">
                <span className="visually-hidden">Search projects</span>
                <span className="project-search__icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label="Clear project search">×</button>
                )}
              </label>
            )}

            {isLoading ? (
              <div className="skeleton-list" aria-label="Loading projects" aria-busy="true">
                <span /><span /><span />
              </div>
            ) : projects.length === 0 ? (
              <div className="sidebar-empty">
                <span aria-hidden="true">+</span>
                <p>No projects yet</p>
                <small>Create one to begin a guided compliance review.</small>
              </div>
            ) : visibleProjects.length === 0 ? (
              <div className="sidebar-empty sidebar-empty--search">
                <p>No matching projects</p>
                <button className="text-button" type="button" onClick={() => setQuery('')}>Clear search</button>
              </div>
            ) : (
              <nav aria-label="Available projects">
                <ul className="project-list__items">
                  {visibleProjects.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        className="project-link"
                        aria-current={selectedId === project.id ? 'page' : undefined}
                        onClick={() => selectProject(project.id)}
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
        )}

        {isCollapsed && !isLoading && (
          <nav className="collapsed-projects" aria-label="Available projects">
            <ul>
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="collapsed-project"
                    aria-label={`${project.name}${project.solicitation_number ? `, ${project.solicitation_number}` : ''}`}
                    aria-current={selectedId === project.id ? 'page' : undefined}
                    title={project.name}
                    onClick={() => selectProject(project.id)}
                  >
                    {project.name.slice(0, 2).toUpperCase()}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </>
  )
}
