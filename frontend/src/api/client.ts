import type { Project, ProjectCreate, ProjectDocument } from '../types'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function validationMessage(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (!Array.isArray(detail)) return null

  const messages = detail.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item]
    if (!item || typeof item !== 'object') return []

    const record = item as { loc?: unknown; msg?: unknown; message?: unknown }
    const text = typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : null
    if (!text) return []

    const location = Array.isArray(record.loc)
      ? record.loc
          .filter((part) => part !== 'body')
          .map(String)
          .join('.')
      : ''
    return [location ? `${location}: ${text}` : text]
  })

  return messages.length > 0 ? messages.join('; ') : null
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const record = body as { detail?: unknown; message?: unknown }
  return validationMessage(record.detail)
    ?? (typeof record.message === 'string' ? record.message : null)
    ?? fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      message = responseErrorMessage(await response.json(), message)
    } catch {
      // Preserve the HTTP status fallback when an error body is not JSON.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function unwrapList<T>(payload: T[] | { projects?: T[]; documents?: T[] }): T[] {
  if (Array.isArray(payload)) return payload
  return payload.projects ?? payload.documents ?? []
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  async listProjects(): Promise<Project[]> {
    const payload = await request<Project[] | { projects: Project[] }>('/api/projects')
    return unwrapList(payload)
  },

  getProject: (projectId: string) =>
    request<Project>(`/api/projects/${encodeURIComponent(projectId)}`),

  createProject: (project: ProjectCreate) =>
    request<Project>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    }),

  async listDocuments(projectId: string): Promise<ProjectDocument[]> {
    const payload = await request<
      ProjectDocument[] | { documents: ProjectDocument[] }
    >(`/api/projects/${encodeURIComponent(projectId)}/documents`)
    return unwrapList(payload)
  },

  async uploadDocuments(projectId: string, files: File[]): Promise<ProjectDocument[]> {
    const body = new FormData()
    files.forEach((file) => body.append('files', file))
    const payload = await request<
      ProjectDocument[] | { documents: ProjectDocument[] }
    >(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
      method: 'POST',
      body,
    })
    return unwrapList(payload)
  },
}
