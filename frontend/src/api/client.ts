import type {
  CDRL,
  ExtractionSummary,
  Project,
  ProjectCreate,
  ProjectDocument,
  Requirement,
  RequirementUpdate,
  ReviewDecision,
} from '../types'

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

function unwrapList<T>(payload: T[] | Record<string, unknown>, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  async listProjects(): Promise<Project[]> {
    const payload = await request<Project[] | { projects: Project[] }>('/api/projects')
    return unwrapList(payload, ['projects', 'items', 'results'])
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
    return unwrapList(payload, ['documents', 'items', 'results'])
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
    return unwrapList(payload, ['documents', 'items', 'results'])
  },

  extractRequirements: (projectId: string) =>
    request<ExtractionSummary>(`/api/projects/${encodeURIComponent(projectId)}/requirements/extract`, {
      method: 'POST',
    }),

  async listRequirements(projectId: string): Promise<Requirement[]> {
    const payload = await request<Requirement[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements`,
    )
    return unwrapList(payload, ['requirements', 'items', 'results'])
  },

  updateRequirement: (projectId: string, requirementId: string, update: RequirementUpdate) =>
    request<Requirement>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    ),

  async listRequirementReviews(projectId: string, requirementId: string): Promise<ReviewDecision[]> {
    const payload = await request<ReviewDecision[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/reviews`,
    )
    return unwrapList(payload, ['reviews', 'decisions', 'items', 'results'])
  },

  async listCdrls(projectId: string): Promise<CDRL[]> {
    const payload = await request<CDRL[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/cdrls`,
    )
    return unwrapList(payload, ['cdrls', 'CDRLs', 'items', 'results'])
  },
}
