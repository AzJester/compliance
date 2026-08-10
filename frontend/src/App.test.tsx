import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { Project, ProjectDocument } from './types'

const project: Project = {
  id: 'project-1',
  name: 'Sentinel Modernization',
  solicitation_number: 'FA0000-26-R-0001',
  agency: 'Department of the Air Force',
  due_at: '2026-09-15T19:00:00Z',
  sensitivity: 'PUBLIC',
  created_at: '2026-08-07T20:00:00Z',
  updated_at: '2026-08-07T20:00:00Z',
}

const secondProject: Project = {
  ...project,
  id: 'project-2',
  name: 'Program Bravo',
  solicitation_number: 'N0000-26-R-0002',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function createProjectThroughWizard(
  user: UserEvent,
  options: { dueAt?: string } = {},
) {
  await user.click(screen.getByRole('button', { name: /^new project$/i }))
  expect(screen.getByRole('dialog', { name: /create a project/i })).toBeInTheDocument()
  await user.type(screen.getByLabelText(/project name/i), project.name)
  await user.type(screen.getByLabelText(/solicitation number/i), project.solicitation_number!)
  await user.type(screen.getByLabelText(/agency or customer/i), project.agency!)
  await user.click(screen.getByRole('button', { name: /^continue$/i }))
  if (options.dueAt) {
    fireEvent.change(screen.getByLabelText(/proposal due date/i), {
      target: { value: options.dueAt },
    })
    expect(screen.getByText((content) => (
      content.includes(options.dueAt!.replace('T', ' '))
      && content.includes(Intl.DateTimeFormat().resolvedOptions().timeZone)
    ))).toBeInTheDocument()
  }
  await user.click(screen.getByRole('checkbox', {
    name: /I will use only synthetic PUBLIC data.*every visitor can view or change/i,
  }))
  await user.click(screen.getByRole('button', { name: /^create project$/i }))
}

async function openSolicitationFiles(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^Solicitation /i }))
  expect(screen.getByRole('heading', { name: /import documents/i })).toBeInTheDocument()
}

function documentUploadInput() {
  const input = document.getElementById('document-upload-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('Document upload input is missing.')
  return input
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  window.sessionStorage.clear()
})

describe('App', () => {
  it('provides keyboard navigation across the guided workflow and keeps the URL in sync', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project])
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    const solicitationStage = screen.getByRole('button', { name: /^Solicitation /i })
    solicitationStage.focus()
    await user.keyboard('{ArrowRight}')
    const requirementsStage = screen.getByRole('button', { name: /^Requirements /i })
    expect(requirementsStage).toHaveFocus()
    expect(requirementsStage).toHaveAttribute('aria-current', 'step')
    expect(window.location.search).toContain('stage=requirements')

    await user.keyboard('{End}')
    expect(screen.getByRole('button', { name: /^Proposal compliance /i })).toHaveFocus()
    expect(screen.getByRole('heading', { name: /assess proposal compliance/i })).toBeInTheDocument()
    await user.keyboard('{Home}')
    expect(solicitationStage).toHaveFocus()
    expect(solicitationStage).toHaveAttribute('aria-current', 'step')

    await user.click(screen.getByRole('link', { name: /skip to workspace/i }))
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('opens a project and workflow stage from URL state', async () => {
    window.history.replaceState(null, '', '/?project=project-2&stage=reports')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project, secondProject])
      if (url === `/api/projects/${secondProject.id}`) return jsonResponse(secondProject)
      if (url === `/api/projects/${secondProject.id}/documents`) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    }))

    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: secondProject.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Proposal compliance /i })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: /assess proposal compliance/i })).toBeInTheDocument()
  })

  it('filters the project switcher and exposes plain-language help', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project, secondProject])
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: /search projects/i }), 'Bravo')
    expect(screen.queryByRole('button', { name: new RegExp(project.name, 'i') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(secondProject.name, 'i') })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^help$/i }))
    const help = screen.getByRole('dialog', { name: /help and glossary/i })
    expect(help).toHaveTextContent(/extracted requirement/i)
    expect(help).toHaveTextContent(/section L/i)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /help and glossary/i })).not.toBeInTheDocument()
  })

  it('shows a recoverable error when a selected project cannot be loaded', async () => {
    let projectReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project])
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      if (url === `/api/projects/${project.id}`) {
        projectReads += 1
        return projectReads === 1
          ? jsonResponse({ detail: 'Project no longer exists.' }, 404)
          : jsonResponse(project)
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(await screen.findByRole('heading', { name: /unable to open project/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Project no longer exists.')
    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    expect(projectReads).toBe(2)
  })

  it('creates a project with the two-step PUBLIC-data wizard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects' && method === 'GET') return jsonResponse([])
      if (url === '/api/projects' && method === 'POST') return jsonResponse(project, 201)
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Service online')
    expect(screen.getByLabelText(/data security notice/i)).toHaveTextContent('PUBLIC-data boundary')
    await createProjectThroughWizard(user, { dueAt: '2026-09-15T12:00' })

    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/projects' && init?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    const createBody = JSON.parse(String(createCall?.[1]?.body))
    expect(createBody).toMatchObject({
      name: project.name,
      solicitation_number: project.solicitation_number,
      agency: project.agency,
      sensitivity: 'PUBLIC',
      due_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(createBody.due_at).toBe(new Date('2026-09-15T12:00').toISOString())
    expect(window.location.search).toContain('project=project-1')
    expect(window.location.search).toContain('stage=solicitation-files')
  })

  it('warns anonymous visitors and requires PUBLIC-data acknowledgement before upload', async () => {
    const uploaded: ProjectDocument = {
      id: 'document-public',
      name: 'synthetic-package.pdf',
      content_type: 'application/pdf',
      size_bytes: 1024,
      sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      status: 'STORED',
      extraction_count: 0,
      classification: 'BASE_SOLICITATION',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/health') return jsonResponse({ status: 'ok', access_mode: 'anonymous' })
      if (url === '/api/projects' && method === 'GET') return jsonResponse([])
      if (url === '/api/projects' && method === 'POST') return jsonResponse(project, 201)
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents` && method === 'POST') return jsonResponse([uploaded], 201)
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(await screen.findByRole('heading', { name: /analyze a synthetic solicitation/i })).toBeInTheDocument()
    const warning = screen.getByLabelText(/shared public demo warning/i)
    expect(warning).toHaveTextContent(/public demo: anyone can view or change data/i)
    expect(warning).toHaveTextContent(/synthetic PUBLIC data only/i)
    expect(warning).toHaveTextContent(/retained on shared storage/i)
    expect(warning).toHaveTextContent(/no private workspace.*user identity.*authorization.*audit assurance/i)
    expect(warning).toHaveTextContent(/anonymous/i)
    expect(screen.queryByText(/upload securely|opening secure workspace|protected project workspace/i)).not.toBeInTheDocument()

    await createProjectThroughWizard(user)
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    await openSolicitationFiles(user)

    const file = new File(['synthetic data'], uploaded.name, { type: uploaded.content_type! })
    await user.upload(documentUploadInput(), file)
    const uploadButton = screen.getByRole('button', { name: /upload 1 file to shared storage/i })
    expect(uploadButton).toBeDisabled()
    expect(fetchMock.mock.calls.some(
      ([input, init]) => String(input).endsWith('/documents') && init?.method === 'POST',
    )).toBe(false)

    const acknowledgement = screen.getByRole('checkbox', {
      name: /only synthetic PUBLIC data.*anyone can view or change uploads retained on shared storage/i,
    })
    await user.click(acknowledgement)
    expect(uploadButton).toBeEnabled()
    await user.click(uploadButton)

    expect(await screen.findByText(uploaded.name)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(
      ([input, init]) => String(input).endsWith('/documents') && init?.method === 'POST',
    )).toBe(true)
  })

  it('uploads selected files and renders the returned manifest record', async () => {
    const uploaded: ProjectDocument = {
      id: 'document-1',
      name: 'package.pdf',
      content_type: 'application/pdf',
      size_bytes: 2048,
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'STORED',
      extraction_count: 14,
      source_archive: null,
      error: null,
      classification: 'BASE_SOLICITATION',
    }
    let documentReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project])
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents` && method === 'POST') {
        expect(init?.body).toBeInstanceOf(FormData)
        expect((init?.body as FormData).getAll('files')).toHaveLength(1)
        expect((init?.body as FormData).get('classification')).toBe('BASE_SOLICITATION')
        return jsonResponse({ documents: [uploaded] }, 201)
      }
      if (url === `/api/projects/${project.id}/documents`) {
        documentReads += 1
        return jsonResponse(documentReads > 1 ? [uploaded] : [])
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    await openSolicitationFiles(user)
    const file = new File(['rfp content'], uploaded.name, { type: uploaded.content_type! })
    await user.upload(documentUploadInput(), file)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))

    const table = await screen.findByRole('table')
    expect(within(table).getByText(uploaded.name)).toBeInTheDocument()
    expect(within(table).getByTitle(uploaded.sha256)).toHaveAttribute('title', uploaded.sha256)
    expect(within(table).getByText('Stored')).toBeInTheDocument()
    expect(screen.getByText(/1 file was added as base solicitation/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^refresh$/i }))
    await waitFor(() => expect(documentReads).toBeGreaterThan(1))
  })

  it('isolates late upload results when the user switches projects', async () => {
    const oldUpload = deferred<Response>()
    const nextProject = deferred<Response>()
    const nextDocuments = deferred<Response>()
    const staleDocument: ProjectDocument = {
      id: 'document-a',
      name: 'alpha-late.pdf',
      content_type: 'application/pdf',
      size_bytes: 1024,
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'STORED',
      extraction_count: 10,
    }
    const bravoDocument: ProjectDocument = {
      ...staleDocument,
      id: 'document-b',
      name: 'bravo-current.pdf',
      sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects') return jsonResponse([project, secondProject])
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents` && method === 'POST') return oldUpload.promise
      if (url === `/api/projects/${project.id}/documents`) return jsonResponse([])
      if (url === `/api/projects/${secondProject.id}`) return nextProject.promise
      if (url === `/api/projects/${secondProject.id}/documents`) return nextDocuments.promise
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    await openSolicitationFiles(user)

    await user.upload(documentUploadInput(), new File(['alpha'], staleDocument.name, { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${project.id}/documents`,
      expect.objectContaining({ method: 'POST' }),
    ))

    await user.click(screen.getByRole('button', { name: new RegExp(secondProject.name, 'i') }))
    expect(screen.queryByRole('heading', { level: 1, name: project.name })).not.toBeInTheDocument()
    expect(document.getElementById('document-upload-input')).not.toBeInTheDocument()

    await act(async () => {
      nextProject.resolve(jsonResponse(secondProject))
      nextDocuments.resolve(jsonResponse([bravoDocument]))
    })
    expect(await screen.findByRole('heading', { level: 1, name: secondProject.name })).toBeInTheDocument()
    await openSolicitationFiles(user)
    expect(screen.getByText(bravoDocument.name)).toBeInTheDocument()

    await act(async () => { oldUpload.resolve(jsonResponse({ documents: [staleDocument] }, 201)) })
    expect(screen.queryByText(staleDocument.name)).not.toBeInTheDocument()
    expect(screen.getByText(bravoDocument.name)).toBeInTheDocument()
  })

  it('does not let an older initial manifest overwrite a new upload', async () => {
    const initialManifest = deferred<Response>()
    const uploaded: ProjectDocument = {
      id: 'document-new',
      name: 'newly-uploaded.pdf',
      content_type: 'application/pdf',
      size_bytes: 4096,
      sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      status: 'STORED',
      extraction_count: 0,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/health') return jsonResponse({ status: 'ok' })
      if (url === '/api/projects' && method === 'GET') return jsonResponse([])
      if (url === '/api/projects' && method === 'POST') return jsonResponse(project, 201)
      if (url === `/api/projects/${project.id}`) return jsonResponse(project)
      if (url === `/api/projects/${project.id}/documents` && method === 'POST') return jsonResponse({ documents: [uploaded] }, 201)
      if (url === `/api/projects/${project.id}/documents`) return initialManifest.promise
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    await createProjectThroughWizard(user)
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()
    await openSolicitationFiles(user)

    await user.upload(documentUploadInput(), new File(['new'], uploaded.name, { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))
    expect(await screen.findByText(uploaded.name)).toBeInTheDocument()

    await act(async () => { initialManifest.resolve(jsonResponse([])) })
    expect(screen.getByText(uploaded.name)).toBeInTheDocument()
  })
})
