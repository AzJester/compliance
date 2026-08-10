import type {
  CDRL,
  CDRLAdjudication,
  CDRLAdjudicationUpdate,
  CrosswalkFinding,
  CrosswalkEvidence,
  CrosswalkEvidenceCreate,
  CrosswalkGenerationSummary,
  CrosswalkUpdate,
  DocumentProfileUpdate,
  DocumentText,
  ExtractionSummary,
  HealthResponse,
  IntakeVerification,
  IntakeVerificationCreate,
  IntakeVerificationUpdate,
  Project,
  ProjectAction,
  ProjectActionCreate,
  ProjectActionUpdate,
  ProjectCreate,
  ProjectDocument,
  ProjectUpdate,
  ProjectWorkflow,
  ReadinessSummary,
  Requirement,
  RequirementUpdate,
  ReviewDecision,
  SolicitationDetailsAnalysis,
  SolicitationDetailsApplyRequest,
  SolicitationDetailsApplyResponse,
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

export interface DownloadedFile {
  blob: Blob
  filename: string
}

function downloadFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Fall through to the plain filename or the safe client fallback.
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback
}

async function download(path: string, fallbackFilename: string): Promise<DownloadedFile> {
  const response = await fetch(path, { headers: { Accept: '*/*' } })
  if (!response.ok) {
    let message = `Download failed (${response.status})`
    try {
      message = responseErrorMessage(await response.json(), message)
    } catch {
      // Preserve the HTTP status fallback when an error body is not JSON.
    }
    throw new ApiError(message, response.status)
  }
  return {
    blob: await response.blob(),
    filename: downloadFilename(response, fallbackFilename),
  }
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
  health: () => request<HealthResponse>('/api/health'),

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

  updateProject: (projectId: string, update: ProjectUpdate) =>
    request<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }),

  getSolicitationDetails: (projectId: string) =>
    request<SolicitationDetailsAnalysis>(
      `/api/projects/${encodeURIComponent(projectId)}/solicitation-details`,
    ),

  analyzeSolicitationDetails: (projectId: string) =>
    request<SolicitationDetailsAnalysis>(
      `/api/projects/${encodeURIComponent(projectId)}/solicitation-details/analyze`,
      { method: 'POST' },
    ),

  applySolicitationDetails: (projectId: string, update: SolicitationDetailsApplyRequest) =>
    request<SolicitationDetailsApplyResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/solicitation-details/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    ),

  getWorkflow: (projectId: string) =>
    request<ProjectWorkflow>(`/api/projects/${encodeURIComponent(projectId)}/workflow`),

  updateWorkflow: (projectId: string, update: Partial<ProjectWorkflow>) =>
    request<ProjectWorkflow>(`/api/projects/${encodeURIComponent(projectId)}/workflow`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }),

  async listDocuments(projectId: string): Promise<ProjectDocument[]> {
    const payload = await request<
      ProjectDocument[] | { documents: ProjectDocument[] }
    >(`/api/projects/${encodeURIComponent(projectId)}/documents`)
    return unwrapList(payload, ['documents', 'items', 'results'])
  },

  async uploadDocuments(
    projectId: string,
    files: File[],
    profile?: DocumentProfileUpdate,
  ): Promise<ProjectDocument[]> {
    const body = new FormData()
    files.forEach((file) => body.append('files', file))
    if (profile) {
      body.append('classification', profile.classification)
      if (profile.volume_name) body.append('volume_name', profile.volume_name)
      if (profile.classification_notes) body.append('classification_notes', profile.classification_notes)
    }
    const payload = await request<
      ProjectDocument[] | { documents: ProjectDocument[] }
    >(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
      method: 'POST',
      body,
    })
    return unwrapList(payload, ['documents', 'items', 'results'])
  },

  updateDocumentProfile: (
    projectId: string,
    documentId: string,
    update: DocumentProfileUpdate,
  ) => request<ProjectDocument>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/profile`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
  ),

  getDocumentText: (projectId: string, documentId: string, start = 0, limit = 20_000) =>
    request<DocumentText>(
      `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/text?start=${start}&limit=${limit}`,
    ),

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

  async listCdrlAdjudications(projectId: string): Promise<CDRLAdjudication[]> {
    const payload = await request<CDRLAdjudication[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/cdrl-adjudications`,
    )
    return unwrapList(payload, ['adjudications', 'items', 'results'])
  },

  updateCdrlAdjudication: (
    projectId: string,
    cdrlId: string,
    update: CDRLAdjudicationUpdate,
  ) => request<CDRLAdjudication>(
    `/api/projects/${encodeURIComponent(projectId)}/cdrls/${encodeURIComponent(cdrlId)}/adjudication`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
  ),

  async listIntakeVerifications(projectId: string): Promise<IntakeVerification[]> {
    const payload = await request<IntakeVerification[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/intake-verifications`,
    )
    return unwrapList(payload, ['verifications', 'items', 'results'])
  },

  createIntakeVerification: (projectId: string, verification: IntakeVerificationCreate) =>
    request<IntakeVerification>(`/api/projects/${encodeURIComponent(projectId)}/intake-verifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verification),
    }),

  initializeIntakeVerifications: (projectId: string) =>
    request<IntakeVerification[]>(`/api/projects/${encodeURIComponent(projectId)}/intake-verifications/initialize`, {
      method: 'POST',
    }),

  updateIntakeVerification: (
    projectId: string,
    verificationId: string,
    update: IntakeVerificationUpdate,
  ) => request<IntakeVerification>(
    `/api/projects/${encodeURIComponent(projectId)}/intake-verifications/${encodeURIComponent(verificationId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
  ),

  async listActions(projectId: string): Promise<ProjectAction[]> {
    const payload = await request<ProjectAction[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/actions`,
    )
    return unwrapList(payload, ['actions', 'items', 'results'])
  },

  createAction: (projectId: string, action: ProjectActionCreate) =>
    request<ProjectAction>(`/api/projects/${encodeURIComponent(projectId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    }),

  updateAction: (projectId: string, actionId: string, update: ProjectActionUpdate) =>
    request<ProjectAction>(
      `/api/projects/${encodeURIComponent(projectId)}/actions/${encodeURIComponent(actionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    ),

  generateCrosswalk: (projectId: string) =>
    request<CrosswalkGenerationSummary>(`/api/projects/${encodeURIComponent(projectId)}/crosswalk/generate`, {
      method: 'POST',
    }),

  async listCrosswalk(projectId: string): Promise<CrosswalkFinding[]> {
    const payload = await request<CrosswalkFinding[] | Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/crosswalk`,
    )
    return unwrapList(payload, ['findings', 'items', 'results'])
  },

  updateCrosswalkFinding: (projectId: string, findingId: string, update: CrosswalkUpdate) =>
    request<CrosswalkFinding>(
      `/api/projects/${encodeURIComponent(projectId)}/crosswalk/${encodeURIComponent(findingId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    ),

  addCrosswalkEvidence: (
    projectId: string,
    findingId: string,
    evidence: CrosswalkEvidenceCreate,
  ) => request<CrosswalkEvidence>(
    `/api/projects/${encodeURIComponent(projectId)}/crosswalk/${encodeURIComponent(findingId)}/evidence`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidence),
    },
  ),

  deleteCrosswalkEvidence: (projectId: string, findingId: string, evidenceId: string) =>
    request<void>(
      `/api/projects/${encodeURIComponent(projectId)}/crosswalk/${encodeURIComponent(findingId)}/evidence/${encodeURIComponent(evidenceId)}`,
      { method: 'DELETE' },
    ),

  getReadiness: (projectId: string) =>
    request<ReadinessSummary>(`/api/projects/${encodeURIComponent(projectId)}/readiness`),

  exportUrl: (projectId: string, register: string, format: 'json' | 'csv' | 'xlsx') =>
    `/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(register)}?format=${format}`,

  workbookUrl: (projectId: string) =>
    `/api/projects/${encodeURIComponent(projectId)}/exports/workbook.xlsx`,

  complianceReportUrl: (projectId: string) =>
    `/api/projects/${encodeURIComponent(projectId)}/exports/compliance-report.docx`,

  gapReportUrl: (projectId: string) =>
    `/api/projects/${encodeURIComponent(projectId)}/exports/gaps.csv`,

  downloadComplianceReport: (projectId: string) => download(
    `/api/projects/${encodeURIComponent(projectId)}/exports/compliance-report.docx`,
    'compliance-assessment.docx',
  ),

  downloadGapReport: (projectId: string) => download(
    `/api/projects/${encodeURIComponent(projectId)}/exports/gaps.csv`,
    'requirements-gaps.csv',
  ),
}
