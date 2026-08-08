import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { Project, ProjectDocument } from './types'

const project: Project = {
  id: 'project-1',
  name: 'Sentinel Modernization',
  solicitation_number: 'FA0000-26-R-0001',
  agency: 'Department of the Air Force',
  due_at: '2026-09-15T19:00:00Z',
  sensitivity: 'CUI',
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
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

  it('creates a project and opens its workspace', async () => {
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
    await user.type(screen.getByLabelText(/project name/i), project.name)
    await user.type(screen.getByLabelText(/solicitation number/i), project.solicitation_number!)
    await user.type(screen.getByLabelText(/^agency$/i), project.agency!)
    fireEvent.change(screen.getByLabelText(/proposal due date/i), {
      target: { value: '2026-09-15T12:00' },
    })
    await user.click(screen.getByRole('button', { name: /create project/i }))

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
      sensitivity: 'CUI',
      due_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(createBody.due_at).toBe(new Date('2026-09-15T12:00').toISOString())
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
    const file = new File(['rfp content'], uploaded.name, { type: uploaded.content_type! })
    await user.upload(screen.getByLabelText(/choose documents/i), file)
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))

    const table = await screen.findByRole('table')
    expect(within(table).getByText(uploaded.name)).toBeInTheDocument()
    expect(within(table).getByText('0123456789ab')).toBeInTheDocument()
    expect(within(table).getByText('Stored')).toBeInTheDocument()
    expect(screen.getByText(/1 file was added to the manifest/i)).toBeInTheDocument()

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

    await user.upload(
      screen.getByLabelText(/choose documents/i),
      new File(['alpha'], staleDocument.name, { type: 'application/pdf' }),
    )
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${project.id}/documents`,
      expect.objectContaining({ method: 'POST' }),
    ))

    await user.click(screen.getByRole('button', { name: new RegExp(secondProject.name, 'i') }))
    expect(screen.queryByRole('heading', { level: 1, name: project.name })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/choose documents/i)).not.toBeInTheDocument()

    await act(async () => {
      nextProject.resolve(jsonResponse(secondProject))
      nextDocuments.resolve(jsonResponse([bravoDocument]))
    })
    expect(await screen.findByRole('heading', { level: 1, name: secondProject.name })).toBeInTheDocument()
    expect(screen.getByText(bravoDocument.name)).toBeInTheDocument()

    await act(async () => {
      oldUpload.resolve(jsonResponse({ documents: [staleDocument] }, 201))
    })
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
      if (url === `/api/projects/${project.id}/documents` && method === 'POST') {
        return jsonResponse({ documents: [uploaded] }, 201)
      }
      if (url === `/api/projects/${project.id}/documents`) return initialManifest.promise
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/project name/i), project.name)
    await user.click(screen.getByRole('button', { name: /create project/i }))
    expect(await screen.findByRole('heading', { level: 1, name: project.name })).toBeInTheDocument()

    await user.upload(
      screen.getByLabelText(/choose documents/i),
      new File(['new'], uploaded.name, { type: 'application/pdf' }),
    )
    await user.click(screen.getByRole('button', { name: /upload 1 file$/i }))
    expect(await screen.findByText(uploaded.name)).toBeInTheDocument()

    await act(async () => {
      initialManifest.resolve(jsonResponse([]))
    })
    expect(screen.getByText(uploaded.name)).toBeInTheDocument()
  })
})
