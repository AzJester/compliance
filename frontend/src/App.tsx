import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'
import { ProjectOverview } from './components/ProjectOverview'
import { ProjectSidebar } from './components/ProjectSidebar'
import { SecurityBanner } from './components/SecurityBanner'
import type {
  HealthState,
  Project,
  ProjectCreate,
  ProjectDocument,
  UploadState,
} from './types'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function App() {
  const [health, setHealth] = useState<HealthState>('checking')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const selectionEpochRef = useRef(0)
  const documentRequestRef = useRef(0)
  const [selectionRetry, setSelectionRetry] = useState(0)

  const transitionToProject = useCallback((projectId: string) => {
    if (selectedIdRef.current === projectId) return
    selectedIdRef.current = projectId
    selectionEpochRef.current += 1
    documentRequestRef.current += 1
    setSelectedId(projectId)
    setSelectedProject(null)
    setDocuments([])
    setProjectError(null)
    setDocumentError(null)
    setUploadState('idle')
    setUploadMessage(null)
    setIsLoadingDocuments(true)
  }, [])

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null
    selectionEpochRef.current += 1
    documentRequestRef.current += 1
    setSelectedId(null)
    setSelectedProject(null)
    setDocuments([])
    setProjectError(null)
    setDocumentError(null)
    setUploadState('idle')
    setUploadMessage(null)
    setIsLoadingDocuments(false)
  }, [])

  const retrySelection = useCallback(() => {
    if (!selectedIdRef.current) return
    selectionEpochRef.current += 1
    documentRequestRef.current += 1
    setSelectedProject(null)
    setDocuments([])
    setProjectError(null)
    setDocumentError(null)
    setUploadState('idle')
    setUploadMessage(null)
    setIsLoadingDocuments(true)
    setSelectionRetry((current) => current + 1)
  }, [])

  useEffect(() => {
    let active = true

    const initialize = async () => {
      const [healthResult, projectResult] = await Promise.allSettled([
        api.health(),
        api.listProjects(),
      ])
      if (!active) return

      setHealth(healthResult.status === 'fulfilled' ? 'online' : 'offline')
      if (projectResult.status === 'fulfilled') {
        setProjects(projectResult.value)
        if (selectedIdRef.current === null && projectResult.value[0]) {
          transitionToProject(projectResult.value[0].id)
        }
      } else {
        setWorkspaceError(errorMessage(projectResult.reason, 'Unable to load projects.'))
      }
      setIsLoadingProjects(false)
    }

    void initialize()
    return () => { active = false }
  }, [transitionToProject])

  const loadDocuments = useCallback(async (projectId: string) => {
    const requestId = ++documentRequestRef.current
    const selectionEpoch = selectionEpochRef.current
    setIsLoadingDocuments(true)
    setDocumentError(null)
    try {
      const nextDocuments = await api.listDocuments(projectId)
      if (
        selectedIdRef.current !== projectId ||
        selectionEpochRef.current !== selectionEpoch ||
        documentRequestRef.current !== requestId
      ) return
      setDocuments(nextDocuments)
    } catch (error) {
      if (
        selectedIdRef.current !== projectId ||
        selectionEpochRef.current !== selectionEpoch ||
        documentRequestRef.current !== requestId
      ) return
      setDocumentError(errorMessage(error, 'Unable to load the document manifest.'))
    } finally {
      if (
        selectedIdRef.current === projectId &&
        selectionEpochRef.current === selectionEpoch &&
        documentRequestRef.current === requestId
      ) setIsLoadingDocuments(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setSelectedProject(null)
      setDocuments([])
      return
    }

    const projectId = selectedId
    const selectionEpoch = selectionEpochRef.current
    const documentRequestId = ++documentRequestRef.current
    let active = true
    setProjectError(null)
    setDocumentError(null)
    setIsLoadingDocuments(true)

    void api.getProject(projectId)
      .then((project) => {
        if (
          !active ||
          selectedIdRef.current !== projectId ||
          selectionEpochRef.current !== selectionEpoch
        ) return
        setSelectedProject(project)
        setProjects((current) => current.map((item) => item.id === project.id ? project : item))
      })
      .catch((error) => {
        if (
          !active ||
          selectedIdRef.current !== projectId ||
          selectionEpochRef.current !== selectionEpoch
        ) return
        setSelectedProject(null)
        setProjectError(errorMessage(error, 'Unable to open the selected project.'))
      })

    void api.listDocuments(projectId)
      .then((nextDocuments) => {
        if (
          !active ||
          selectedIdRef.current !== projectId ||
          selectionEpochRef.current !== selectionEpoch ||
          documentRequestRef.current !== documentRequestId
        ) return
        setDocuments(nextDocuments)
      })
      .catch((error) => {
        if (
          !active ||
          selectedIdRef.current !== projectId ||
          selectionEpochRef.current !== selectionEpoch ||
          documentRequestRef.current !== documentRequestId
        ) return
        setDocumentError(errorMessage(error, 'Unable to load the document manifest.'))
      })
      .finally(() => {
        if (
          active &&
          selectedIdRef.current === projectId &&
          selectionEpochRef.current === selectionEpoch &&
          documentRequestRef.current === documentRequestId
        ) setIsLoadingDocuments(false)
      })

    return () => { active = false }
  }, [selectedId, selectionRetry])

  const createProject = async (payload: ProjectCreate) => {
    setIsCreating(true)
    setWorkspaceError(null)
    try {
      const project = await api.createProject(payload)
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
      transitionToProject(project.id)
      setSelectedProject(project)
    } catch (error) {
      const message = errorMessage(error, 'Unable to create project.')
      setWorkspaceError(message)
      throw new Error(message)
    } finally {
      setIsCreating(false)
    }
  }

  const uploadDocuments = async (files: File[]) => {
    if (!selectedId || selectedProject?.id !== selectedId) return
    const projectId = selectedId
    const selectionEpoch = selectionEpochRef.current
    setUploadState('uploading')
    setUploadMessage(null)
    try {
      const uploaded = await api.uploadDocuments(projectId, files)
      if (
        selectedIdRef.current !== projectId ||
        selectionEpochRef.current !== selectionEpoch
      ) return
      if (uploaded.length > 0) {
        documentRequestRef.current += 1
        setDocuments((current) => {
          const uploadedIds = new Set(uploaded.map((document) => document.id))
          return [...uploaded, ...current.filter((document) => !uploadedIds.has(document.id))]
        })
        setIsLoadingDocuments(false)
      } else {
        await loadDocuments(projectId)
      }
      if (
        selectedIdRef.current !== projectId ||
        selectionEpochRef.current !== selectionEpoch
      ) return
      setUploadState('success')
      setUploadMessage(`${files.length} ${files.length === 1 ? 'file was' : 'files were'} added to the manifest.`)
    } catch (error) {
      if (
        selectedIdRef.current !== projectId ||
        selectionEpochRef.current !== selectionEpoch
      ) return
      const message = errorMessage(error, 'Upload failed. Your files were not added.')
      setUploadState('error')
      setUploadMessage(message)
      throw error
    }
  }

  const activeProject = selectedProject?.id === selectedId ? selectedProject : null

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      <header className="topbar">
        <div className="brand" aria-label="RFP Compliance Workspace">
          <span className="brand__mark" aria-hidden="true">RC</span>
          <span><strong>RFP Compliance</strong><small>Secure intake workspace</small></span>
        </div>
        <div className={`health health--${health}`} role="status">
          <span aria-hidden="true" />
          {health === 'checking' ? 'Checking local service' : health === 'online' ? 'Local service online' : 'Local service unavailable'}
        </div>
      </header>

      <SecurityBanner />

      {workspaceError && (
        <div className="global-error" role="alert">
          <strong>Workspace notice:</strong> {workspaceError}
          <button type="button" aria-label="Dismiss workspace notice" onClick={() => setWorkspaceError(null)}>×</button>
        </div>
      )}

      <div className="workspace">
        <ProjectSidebar
          projects={projects}
          selectedId={selectedId}
          isLoading={isLoadingProjects}
          isCreating={isCreating}
          onSelect={transitionToProject}
          onCreate={createProject}
        />

        <main id="main-content" className="main-content">
          {activeProject ? (
            <ProjectOverview
              key={activeProject.id}
              project={activeProject}
              documents={documents}
              isLoadingDocuments={isLoadingDocuments}
              documentError={documentError}
              uploadState={uploadState}
              uploadMessage={uploadMessage}
              onUpload={uploadDocuments}
              onRefresh={() => void loadDocuments(activeProject.id)}
            />
          ) : projectError && selectedId ? (
            <section className="project-load-error" aria-labelledby="project-load-error-title">
              <div className="project-load-error__mark" aria-hidden="true">!</div>
              <div className="section-kicker">Project unavailable</div>
              <h1 id="project-load-error-title">Unable to open project</h1>
              <p role="alert">{projectError}</p>
              <div className="project-load-error__actions">
                <button className="button button--primary" type="button" onClick={retrySelection}>
                  Retry
                </button>
                <button className="button button--secondary" type="button" onClick={clearSelection}>
                  Back to project list
                </button>
              </div>
            </section>
          ) : isLoadingProjects || selectedId ? (
            <div className="workspace-loading" aria-busy="true">
              <span /><span /><span />
              <p>Opening secure workspace…</p>
            </div>
          ) : (
            <section className="welcome-state">
              <div className="welcome-state__mark" aria-hidden="true">RFP</div>
              <div className="section-kicker">Ready for intake</div>
              <h1>Build a defensible compliance record</h1>
              <p>Create a project to register a solicitation package, preserve source integrity, and prepare every requirement for traceable review.</p>
              <ol>
                <li><span>1</span>Create a protected project workspace</li>
                <li><span>2</span>Import the RFP, amendments, and attachments</li>
                <li><span>3</span>Validate the document manifest before extraction</li>
              </ol>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
