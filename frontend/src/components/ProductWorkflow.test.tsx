import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CrosswalkFinding,
  IntakeVerification,
  Project,
  ProjectDocument,
  ProjectWorkflow,
  ReadinessSummary,
  WorkflowStage,
} from '../types'
import { CrosswalkWorkspace } from './CrosswalkWorkspace'
import { DocumentManifest } from './DocumentManifest'
import { NewProjectForm } from './NewProjectForm'
import { PackageVerification } from './PackageVerification'
import { ProjectDashboard } from './ProjectDashboard'
import { ProjectOverview } from './ProjectOverview'
import { ProposalWorkspace } from './ProposalWorkspace'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const project: Project = {
  id: 'project-1',
  name: 'Synthetic Sentinel',
  solicitation_number: 'FAKE-26-R-0001',
  agency: 'Synthetic Agency',
  due_at: null,
  due_timezone: null,
  sensitivity: 'PUBLIC',
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
}

const documentRecord: ProjectDocument = {
  id: 'document-1',
  name: 'synthetic-solicitation.pdf',
  size_bytes: 2048,
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  status: 'EXTRACTED',
  extraction_count: 1200,
  classification: 'UNCLASSIFIED',
}

const workflow: ProjectWorkflow = {
  project_id: project.id,
  stage: 'PROJECT_SETUP',
  status: 'IN_PROGRESS',
  blocker_summary: null,
  updated_at: '2026-08-08T00:00:00Z',
}

const stageLabels: Record<WorkflowStage, string> = {
  PROJECT_SETUP: 'Project setup',
  SOLICITATION_FILES: 'Solicitation files',
  VERIFY_PACKAGE: 'Verify package',
  REQUIREMENTS: 'Requirements',
  PROPOSAL_RESPONSE: 'Proposal response',
  CROSSWALK: 'Crosswalk',
  REPORTS: 'Reports',
}

const stageOrder = Object.keys(stageLabels) as WorkflowStage[]

function readinessWith(
  updates: Partial<ReadinessSummary> = {},
  stageUpdates: Partial<Record<WorkflowStage, Partial<ReadinessSummary['stages'][number]>>> = {},
): ReadinessSummary {
  return {
    project_id: project.id,
    ready: false,
    readiness_percent: 70,
    workflow_stage: 'PROJECT_SETUP',
    workflow_status: 'IN_PROGRESS',
    documents_total: 2,
    documents_classified: 2,
    proposal_documents: 1,
    intake_total: 1,
    intake_verified: 1,
    intake_issues: 0,
    requirements_total: 1,
    requirements_validated: 1,
    requirements_pending: 0,
    cdrls_total: 0,
    cdrls_ready: 0,
    cdrls_incomplete: 0,
    cdrls_unreviewed: 0,
    cdrls_waived: 0,
    cdrls_stale: 0,
    crosswalk_total: 1,
    crosswalk_verified: 1,
    covered: 1,
    partial: 0,
    missing: 0,
    conflict: 0,
    n_a: 0,
    unverified: 0,
    actions_open: 0,
    actions_blocked: 0,
    blocking_reasons: [],
    next_action: null,
    stages: stageOrder.map((stage) => ({
      stage,
      label: stageLabels[stage],
      status: 'COMPLETE',
      completed_items: 1,
      total_items: 1,
      blocking_reasons: [],
      next_action: null,
      ...stageUpdates[stage],
    })),
    ...updates,
  }
}

function renderOverview(
  documents: ProjectDocument[],
  fetchMock: ReturnType<typeof vi.fn>,
) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <ProjectOverview
      project={project}
      documents={documents}
      isLoadingDocuments={false}
      documentError={null}
      uploadState="idle"
      uploadMessage={null}
      isAnonymous
      onUpload={vi.fn()}
      onRefresh={vi.fn()}
      onProjectUpdated={vi.fn()}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('product workflow components', () => {
  it('uses backend blockers for setup and files instead of local completion heuristics', async () => {
    const authoritative = readinessWith({}, {
      PROJECT_SETUP: {
        status: 'BLOCKED',
        completed_items: 3,
        total_items: 4,
        blocking_reasons: ['Project setup is incomplete.'],
        next_action: 'Complete the missing project details.',
      },
      SOLICITATION_FILES: {
        status: 'BLOCKED',
        completed_items: 1,
        total_items: 1,
        blocking_reasons: ['Run requirement extraction for 1 new or reclassified solicitation document.'],
        next_action: 'Upload and classify the solicitation package.',
      },
    })
    const workflowUpdates: Array<Record<string, unknown>> = []
    const sourceDocument = { ...documentRecord, classification: 'BASE_SOLICITATION' as const }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/intake-verifications')) return jsonResponse([])
      if (url.endsWith('/readiness')) return jsonResponse(authoritative)
      if (url.endsWith('/workflow') && init?.method === 'PATCH') {
        const update = JSON.parse(String(init.body))
        workflowUpdates.push(update)
        return jsonResponse({ ...workflow, ...update })
      }
      if (url.endsWith('/workflow')) return jsonResponse(workflow)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    const user = userEvent.setup()

    renderOverview([sourceDocument], fetchMock)

    const setup = await screen.findByRole('button', { name: /Setup Blocked.*Project setup is incomplete/i })
    const files = screen.getByRole('button', { name: /Files Blocked.*new or reclassified solicitation document/i })
    expect(setup.closest('li')).toHaveClass('workflow-rail__attention')
    expect(files.closest('li')).toHaveClass('workflow-rail__attention')
    expect(screen.getByLabelText(/workflow stages complete/i)).toHaveTextContent('5/7')

    await user.click(setup)
    await user.click(files)
    await waitFor(() => expect(workflowUpdates).toHaveLength(2))
    expect(workflowUpdates).toEqual([
      {
        stage: 'PROJECT_SETUP',
        status: 'IN_PROGRESS',
        blocker_summary: null,
      },
      {
        stage: 'SOLICITATION_FILES',
        status: 'IN_PROGRESS',
        blocker_summary: null,
      },
    ])
  })

  it('keeps stale and gap-blocked crosswalk work out of the complete state', async () => {
    const authoritative = readinessWith({
      covered: 0,
      conflict: 1,
      blocking_reasons: [
        'Regenerate the proposal crosswalk after requirement or proposal changes.',
        'Resolve 1 proposal coverage gap(s).',
      ],
      next_action: 'Generate or review the proposal crosswalk.',
    }, {
      CROSSWALK: {
        status: 'BLOCKED',
        completed_items: 0,
        total_items: 1,
        blocking_reasons: [
          'Regenerate the proposal crosswalk after requirement or proposal changes.',
          'Resolve 1 proposal coverage gap(s).',
        ],
        next_action: 'Generate or review the proposal crosswalk.',
      },
    })
    const workflowUpdates: Array<Record<string, unknown>> = []
    const documents = [
      { ...documentRecord, classification: 'BASE_SOLICITATION' as const },
      { ...documentRecord, id: 'proposal-1', name: 'proposal.pdf', classification: 'PROPOSAL_VOLUME' as const },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/intake-verifications')) return jsonResponse([])
      if (url.endsWith('/readiness')) return jsonResponse(authoritative)
      if (url.endsWith('/crosswalk')) return jsonResponse([])
      if (url.endsWith('/workflow') && init?.method === 'PATCH') {
        const update = JSON.parse(String(init.body))
        workflowUpdates.push(update)
        return jsonResponse({ ...workflow, ...update })
      }
      if (url.endsWith('/workflow')) return jsonResponse(workflow)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    const user = userEvent.setup()

    renderOverview(documents, fetchMock)

    const crosswalk = await screen.findByRole('button', {
      name: /Crosswalk Blocked.*Regenerate the proposal crosswalk.*Resolve 1 proposal coverage gap/i,
    })
    expect(crosswalk.closest('li')).toHaveClass('workflow-rail__attention')
    expect(crosswalk.closest('li')).not.toHaveClass('workflow-rail__complete')
    expect(screen.getAllByText(/Regenerate the proposal crosswalk after requirement or proposal changes/i).length).toBeGreaterThanOrEqual(2)

    await user.click(crosswalk)
    await waitFor(() => expect(workflowUpdates).toHaveLength(1))
    expect(workflowUpdates[0]).toEqual({
      stage: 'CROSSWALK',
      status: 'IN_PROGRESS',
      blocker_summary: null,
    })
  })

  it('uses a conservative non-complete fallback when readiness cannot be loaded', async () => {
    const sourceDocument = { ...documentRecord, classification: 'BASE_SOLICITATION' as const }
    const workflowUpdates: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/intake-verifications')) return jsonResponse([])
      if (url.endsWith('/readiness')) return jsonResponse({ detail: 'Unavailable' }, 503)
      if (url.endsWith('/workflow') && init?.method === 'PATCH') {
        const update = JSON.parse(String(init.body))
        workflowUpdates.push(update)
        return jsonResponse({ ...workflow, ...update })
      }
      if (url.endsWith('/workflow')) return jsonResponse(workflow)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    const user = userEvent.setup()

    renderOverview([sourceDocument], fetchMock)

    const setup = await screen.findByRole('button', { name: /Setup Status unavailable.*readiness could not be loaded/i })
    const files = screen.getByRole('button', { name: /Files Status unavailable.*readiness could not be loaded/i })
    expect(setup.closest('li')).not.toHaveClass('workflow-rail__complete')
    expect(files.closest('li')).not.toHaveClass('workflow-rail__complete')
    expect(screen.getByText(/^Current readiness could not be loaded\. Workflow stages remain conservatively incomplete/i)).toBeInTheDocument()

    await user.click(files)
    await waitFor(() => expect(workflowUpdates).toHaveLength(1))
    expect(workflowUpdates[0]).toMatchObject({
      stage: 'SOLICITATION_FILES',
      status: 'IN_PROGRESS',
      blocker_summary: null,
    })
  })

  it('classifies a manifest document and saves its package note', async () => {
    const onDocumentsChanged = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => jsonResponse({
      ...documentRecord,
      classification: 'AMENDMENT',
      classification_notes: 'Supersedes the base schedule.',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <DocumentManifest
        projectId={project.id}
        documents={[documentRecord]}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
        onDocumentsChanged={onDocumentsChanged}
      />,
    )

    expect(screen.getByText(/1 file needs a role/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /assign role/i }))
    await user.selectOptions(screen.getByLabelText(/^file role$/i), 'AMENDMENT')
    await user.type(screen.getByLabelText(/file role note/i), 'Supersedes the base schedule.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      classification: 'AMENDMENT',
      classification_notes: 'Supersedes the base schedule.',
    })
  })

  it('uploads an anonymous proposal volume with atomic classification metadata', async () => {
    const onDocumentsChanged = vi.fn()
    const onContinue = vi.fn()
    const proposalDocument: ProjectDocument = {
      ...documentRecord,
      id: 'proposal-1',
      name: 'synthetic-technical.pdf',
      classification: 'PROPOSAL_VOLUME',
      volume_name: 'Technical Volume',
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData
      expect(body.get('classification')).toBe('PROPOSAL_VOLUME')
      expect(body.get('volume_name')).toBe('Technical Volume')
      expect(body.get('classification_notes')).toMatch(/proposal-response workflow/i)
      expect(body.getAll('files')).toHaveLength(1)
      return jsonResponse([proposalDocument], 201)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <ProposalWorkspace
        projectId={project.id}
        documents={[]}
        isAnonymous
        onDocumentsChanged={onDocumentsChanged}
        onContinue={onContinue}
      />,
    )

    await user.type(screen.getByLabelText(/proposal volume or upload group name/i), 'Technical Volume')
    await user.upload(
      screen.getByLabelText(/choose proposal documents/i),
      new File(['synthetic proposal'], 'synthetic-technical.pdf', { type: 'application/pdf' }),
    )
    const upload = screen.getByRole('button', { name: /upload proposal response/i })
    expect(upload).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /synthetic PUBLIC material/i }))
    await user.click(upload)

    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalledTimes(1))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('records persisted package verification with a reviewer label', async () => {
    const initial: IntakeVerification[] = [
      {
        id: 'check-1', project_id: project.id, check_key: 'base', label: 'Base solicitation present',
        status: 'PENDING', created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
      },
      {
        id: 'check-2', project_id: project.id, check_key: 'amendments', label: 'Amendments reconciled',
        status: 'PENDING', created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
      },
    ]
    const onVerified = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/initialize')) return jsonResponse(initial)
      const update = JSON.parse(String(init?.body)) as { status: string; reviewer: string }
      const id = String(input).endsWith('check-1') ? 'check-1' : 'check-2'
      return jsonResponse({ ...initial.find((item) => item.id === id), ...update })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<PackageVerification projectId={project.id} documents={[documentRecord]} onVerified={onVerified} />)
    const checks = await screen.findAllByRole('combobox')
    await user.selectOptions(checks[0], 'VERIFIED')
    await user.selectOptions(checks[1], 'VERIFIED')
    await user.type(screen.getByLabelText(/reviewer label/i), 'Synthetic Reviewer')
    await user.click(screen.getByRole('button', { name: /mark package verified/i }))

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('adds an exact manual proposal citation from selected source text', async () => {
    const proposalDocument: ProjectDocument = {
      ...documentRecord,
      id: 'proposal-1',
      name: 'technical.txt',
      classification: 'PROPOSAL_VOLUME',
      volume_name: 'Technical Volume',
    }
    const finding: CrosswalkFinding = {
      id: 'finding-1', project_id: project.id, requirement_id: 'requirement-1',
      requirement_text: 'The offeror shall provide a transition plan.', requirement_section: 'L',
      candidate_status: 'MISSING', status: 'MISSING', score: 0, evidence: [], human_verified: false,
      stale: false, generated_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
    }
    let evidenceAdded = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/crosswalk') && !init?.method) {
        return jsonResponse([evidenceAdded ? {
          ...finding,
          evidence: [{
            id: 'evidence-1', finding_id: finding.id, document_id: proposalDocument.id,
            document_name: proposalDocument.name, source_locator: 'characters 0-15', excerpt: 'transition plan',
            source_start: 0, source_end: 15, is_manual: true,
          }],
        } : finding])
      }
      if (url.includes('/documents/') && url.includes('/text?')) {
        return jsonResponse({
          document_id: proposalDocument.id, name: proposalDocument.name, total_characters: 44,
          start: 0, end: 44, text: 'transition plan with qualified personnel', truncated: false,
        })
      }
      if (url.endsWith('/evidence')) {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ document_id: proposalDocument.id, source_start: 0, source_end: 15 })
        evidenceAdded = true
        return jsonResponse({ id: 'evidence-1', finding_id: finding.id, ...body })
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<CrosswalkWorkspace projectId={project.id} proposalDocuments={[proposalDocument]} />)
    expect((await screen.findAllByText(finding.requirement_text)).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /add source passage/i }))
    const source = await screen.findByLabelText(/proposal source text/i)
    ;(source as HTMLTextAreaElement).setSelectionRange(0, 15)
    fireEvent.select(source)
    await user.click(screen.getByRole('button', { name: /add selected passage/i }))

    expect(await screen.findByText(/manually cited/i)).toBeInTheDocument()
  })

  it('edits project metadata from the dashboard', async () => {
    const onProjectUpdated = vi.fn()
    const localDueAt = '2026-09-15T12:00'
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const updated = {
      ...project,
      agency: 'Updated Synthetic Agency',
      due_at: new Date(localDueAt).toISOString(),
      due_timezone: localTimeZone,
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        agency: updated.agency,
        due_at: updated.due_at,
        due_timezone: localTimeZone,
      })
      return jsonResponse(updated)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <ProjectDashboard
        project={project}
        documents={[]}
        packageVerified={false}
        onNavigate={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    )
    await user.click(screen.getByText(/view or edit project details/i))
    await user.click(screen.getByRole('button', { name: /edit project details/i }))
    await user.clear(screen.getByLabelText(/agency or customer/i))
    await user.type(screen.getByLabelText(/agency or customer/i), updated.agency)
    fireEvent.change(screen.getByLabelText(/proposal due date and time/i), {
      target: { value: localDueAt },
    })
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledWith(updated))
  })

  it('does not silently clear a partially entered project deadline', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <ProjectDashboard
        project={project}
        documents={[]}
        packageVerified={false}
        onNavigate={vi.fn()}
        onProjectUpdated={vi.fn()}
      />,
    )
    await user.click(screen.getByText(/view or edit project details/i))
    await user.click(screen.getByRole('button', { name: /edit project details/i }))
    const dueInput = screen.getByLabelText(/proposal due date and time/i)
    Object.defineProperty(dueInput, 'validity', {
      configurable: true,
      value: { badInput: true },
    })
    fireEvent.change(dueInput, { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: /save details/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/both a proposal due date and time/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not silently omit a partially entered deadline when creating a project', async () => {
    const onCreate = vi.fn(async () => undefined)
    const user = userEvent.setup()

    render(
      <NewProjectForm
        isOpen
        isSubmitting={false}
        onCancel={vi.fn()}
        onCreate={onCreate}
      />,
    )
    await user.type(screen.getByLabelText(/project name/i), 'Synthetic Deadline Test')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    const dueInput = screen.getByLabelText(/proposal due date and time/i)
    Object.defineProperty(dueInput, 'validity', {
      configurable: true,
      value: { badInput: true },
    })
    fireEvent.change(dueInput, { target: { value: '' } })
    await user.click(screen.getByRole('checkbox', { name: /synthetic PUBLIC data/i }))
    await user.click(screen.getByRole('button', { name: /create project/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/both a proposal due date and time/i)
    expect(onCreate).not.toHaveBeenCalled()
  })
})
