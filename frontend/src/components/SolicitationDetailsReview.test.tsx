import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  Project,
  ProjectDocument,
  SolicitationDetailCandidate,
  SolicitationDetailField,
  SolicitationDetailFieldKey,
  SolicitationDetailsAnalysis,
} from '../types'
import { DocumentUpload } from './DocumentUpload'
import { SolicitationDetailsReview } from './SolicitationDetailsReview'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const project: Project = {
  id: 'project-1',
  name: 'Synthetic Opportunity',
  solicitation_number: null,
  agency: null,
  due_at: null,
  due_timezone: null,
  sensitivity: 'PUBLIC',
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
}

const baseDocument: ProjectDocument = {
  id: 'base-1',
  name: 'synthetic-rfp.pdf',
  size_bytes: 4096,
  sha256: 'a'.repeat(64),
  status: 'EXTRACTED',
  classification: 'BASE_SOLICITATION',
}

function candidate(
  id: string,
  fieldKey: SolicitationDetailFieldKey,
  value: string,
  updates: Partial<SolicitationDetailCandidate> = {},
): SolicitationDetailCandidate {
  return {
    id,
    field_key: fieldKey,
    value,
    normalized_value: { [fieldKey]: value },
    document_id: baseDocument.id,
    document_name: baseDocument.name,
    document_classification: 'BASE_SOLICITATION',
    document_sha256: baseDocument.sha256,
    is_amendment: false,
    amendment_number: null,
    explicit_change: false,
    source_start: 10,
    source_end: 80,
    source_locator: 'characters 10-80',
    page_number: 2,
    excerpt: `${fieldKey}: ${value}`,
    confidence: 0.96,
    confidence_level: 'HIGH',
    detection_rationale: 'A value followed an explicit synthetic label.',
    detection_pattern: 'test-pattern',
    applicable: true,
    needs_input: null,
    ...updates,
  }
}

function field(
  fieldKey: SolicitationDetailFieldKey,
  label: string,
  candidates: SolicitationDetailCandidate[],
  updates: Partial<SolicitationDetailField> = {},
): SolicitationDetailField {
  return {
    field_key: fieldKey,
    label,
    repeatable: fieldKey === 'points_of_contact',
    status: candidates.length ? 'DETECTED' : 'NOT_FOUND',
    conflict: false,
    recommended_candidate_id: candidates[0]?.id ?? null,
    recommended_candidate_ids: candidates.slice(0, 1).map((item) => item.id),
    candidates,
    ...updates,
  }
}

function analysis(fields: SolicitationDetailField[], updates: Partial<SolicitationDetailsAnalysis> = {}): SolicitationDetailsAnalysis {
  return {
    project_id: project.id,
    run_id: 'run-1',
    analyzed_at: '2026-08-08T15:00:00Z',
    input_fingerprint: 'f'.repeat(64),
    rule_version: 'solicitation-details-1.0',
    stale: false,
    project_updated_at: project.updated_at,
    profile_updated_at: '2026-08-08T00:00:00Z',
    profile: {
      project_id: project.id,
      issuing_office: null,
      naics_code: null,
      psc_code: null,
      set_aside: null,
      contract_type: null,
      points_of_contact: [],
      updated_at: '2026-08-08T00:00:00Z',
    },
    fields,
    decisions: [],
    ...updates,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('solicitation details review', () => {
  it('automatically analyzes the first classified RFP and requires explicit conflict selection', async () => {
    const base = candidate('base-number', 'solicitation_number', 'SYN-26-R-0001')
    const amendment = candidate('amendment-number', 'solicitation_number', 'SYN-26-R-0002', {
      document_id: 'amendment-1',
      document_name: 'synthetic-amendment-0001.pdf',
      document_classification: 'AMENDMENT',
      document_sha256: 'b'.repeat(64),
      is_amendment: true,
      amendment_number: 1,
      explicit_change: false,
    })
    const deadline = candidate('deadline-1', 'due_at', 'September 18, 2026 at 4:00 PM', {
      normalized_value: { local_expression: 'September 18, 2026 at 4:00 PM' },
      applicable: false,
      needs_input: 'No explicit timezone was present.',
    })
    const detected = analysis([
      field('solicitation_number', 'Solicitation number', [base, amendment], {
        status: 'CONFLICT', conflict: true, recommended_candidate_id: null, recommended_candidate_ids: [],
      }),
      field('due_at', 'Proposal due date/time', [deadline], {
        status: 'NEEDS_INPUT', recommended_candidate_id: null, recommended_candidate_ids: [],
      }),
    ])
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/solicitation-details') && !init?.method) {
        return jsonResponse({ detail: 'No solicitation-detail analysis exists. Run analysis first.' }, 404)
      }
      if (url.endsWith('/solicitation-details/analyze') && init?.method === 'POST') return jsonResponse(detected)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SolicitationDetailsReview
        project={project}
        documents={[baseDocument]}
        onProjectUpdated={vi.fn()}
      />,
    )

    expect(await screen.findByText(/nothing changes until you approve/i)).toBeInTheDocument()
    expect(screen.getByText(/sources disagree/i)).toBeInTheDocument()
    const conflictCard = screen.getByRole('heading', { name: 'Solicitation number' }).closest('article')
    expect(conflictCard).not.toBeNull()
    const conflictChoices = within(conflictCard as HTMLElement).getAllByRole('radio')
    expect(conflictChoices).toHaveLength(2)
    expect(conflictChoices.every((input) => !(input as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByText('solicitation_number: SYN-26-R-0001')).toBeInTheDocument()
    expect(screen.getAllByText('a'.repeat(64))).toHaveLength(2)
    expect(screen.getAllByText(/page 2 · characters 10-80/i)).toHaveLength(3)
    expect(screen.getByText(/timezone confirmation required/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be applied automatically/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('applies only approved fields atomically and exposes the exact current candidate and profile', async () => {
    const naics = candidate('naics-1', 'naics_code', '541330', {
      normalized_value: { naics_code: '541330' },
    })
    const initial = analysis([field('naics_code', 'NAICS', [naics])])
    const appliedAt = '2026-08-08T16:00:00Z'
    const decision = {
      id: 'decision-1', project_id: project.id, run_id: initial.run_id, candidate_id: naics.id,
      field_key: 'naics_code' as const, reviewer: 'Synthetic Reviewer', previous_value: null,
      applied_value: '541330', applied_at: appliedAt,
    }
    const appliedAnalysis = analysis(initial.fields, {
      project_updated_at: appliedAt,
      profile_updated_at: appliedAt,
      profile: { ...initial.profile, naics_code: '541330', updated_at: appliedAt },
      decisions: [decision],
    })
    const updatedProject = { ...project, updated_at: appliedAt }
    const onProjectUpdated = vi.fn()
    const onProgressChanged = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/solicitation-details') && !init?.method) return jsonResponse(initial)
      if (url.endsWith('/solicitation-details/apply') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          reviewer: 'Synthetic Reviewer',
          expected_project_updated_at: initial.project_updated_at,
          expected_profile_updated_at: initial.profile_updated_at,
          run_id: initial.run_id,
          approvals: [{ field_key: 'naics_code', candidate_ids: [naics.id] }],
        })
        return jsonResponse({
          project: updatedProject,
          profile: appliedAnalysis.profile,
          applied_fields: ['naics_code'],
          decisions: [decision],
          analysis: appliedAnalysis,
        })
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <SolicitationDetailsReview
        project={project}
        documents={[baseDocument]}
        onProjectUpdated={onProjectUpdated}
        onProgressChanged={onProgressChanged}
      />,
    )

    const fieldCard = (await screen.findByRole('heading', { name: 'NAICS' })).closest('article')
    expect(fieldCard).not.toBeNull()
    const approval = within(fieldCard as HTMLElement).getByRole('checkbox', { name: /approve selected value/i })
    expect(approval).not.toBeChecked()
    await user.click(approval)
    await user.type(screen.getByLabelText(/reviewer name.*self-reported/i), 'Synthetic Reviewer')
    await user.click(screen.getByRole('button', { name: /apply 1 approved detail/i }))

    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledWith(updatedProject))
    expect(onProgressChanged).toHaveBeenCalledTimes(1)
    const currentProfile = screen.getByRole('heading', { name: /current approved profile/i }).closest('section')
    expect(currentProfile).not.toBeNull()
    expect(within(currentProfile as HTMLElement).getByText('541330')).toBeInTheDocument()
    expect(within(fieldCard as HTMLElement).getByText('Applied')).toBeInTheDocument()
    expect(screen.getByText(/last approved by Synthetic Reviewer \(self-reported\)/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/1 approved detail was applied atomically/i)
  })

  it('blocks stale analysis until the full package is reanalyzed', async () => {
    const title = candidate('title-1', 'title', 'Synthetic Logistics Support')
    const stale = analysis([field('title', 'Project title', [title])], { stale: true })
    const fetchMock = vi.fn(async () => jsonResponse(stale))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <SolicitationDetailsReview
        project={project}
        documents={[baseDocument]}
        onProjectUpdated={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/analysis is out of date/i)
    await user.click(screen.getByRole('checkbox', { name: /approve selected value/i }))
    await user.type(screen.getByLabelText(/reviewer name.*self-reported/i), 'Reviewer')
    expect(screen.getByRole('button', { name: /apply 1 approved detail/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reanalyze now/i })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('role-aware solicitation upload', () => {
  it('defaults and submits the base-solicitation role for the selected batch', async () => {
    const onUpload = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(<DocumentUpload state="idle" message={null} isAnonymous onUpload={onUpload} />)

    const file = new File(['synthetic public rfp'], 'synthetic-rfp.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText(/choose documents/i), file)
    const uploadButton = screen.getByRole('button', { name: /upload 1 file/i })
    expect(uploadButton).toBeDisabled()
    expect(screen.getByLabelText(/document type/i)).toHaveValue('BASE_SOLICITATION')
    await user.type(screen.getByLabelText(/package note/i), 'Synthetic base package')
    await user.click(screen.getByRole('checkbox', { name: /synthetic PUBLIC data/i }))
    await user.click(uploadButton)

    expect(onUpload).toHaveBeenCalledWith([file], {
      classification: 'BASE_SOLICITATION',
      classification_notes: 'Synthetic base package',
    })
  })
})
