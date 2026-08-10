import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CDRL,
  CDRLAdjudication,
  CrosswalkFinding,
  ReadinessSummary,
  Requirement,
} from '../types'
import { CdrlRegister } from './CdrlRegister'
import { CrosswalkWorkspace } from './CrosswalkWorkspace'
import { ReportsWorkspace } from './ReportsWorkspace'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const requirement: Requirement = {
  id: 'requirement-1',
  document_id: 'source-1',
  document_name: 'synthetic-solicitation.pdf',
  requirement_text: 'The offeror shall provide a staffing plan.',
  source_text: 'The offeror shall provide a staffing plan.',
  source_locator: 'Section L.2',
  source_start: 10,
  source_end: 53,
  section: 'L',
  category: 'SUBMISSION_INSTRUCTION',
  mandatory_term: 'shall',
  obligation_owner: 'OFFEROR',
  applicability: 'PROPOSAL',
  confidence: 0.95,
  extraction_method: 'RULES',
  rule_version: 'rules-1.0',
  validation_status: 'VALIDATED',
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
}

const finding: CrosswalkFinding = {
  id: 'finding-1',
  project_id: 'project-1',
  requirement_id: requirement.id,
  requirement_text: requirement.requirement_text,
  requirement_section: 'L',
  candidate_status: 'COVERED',
  status: 'COVERED',
  score: 0.92,
  evidence: [{
    id: 'evidence-1',
    finding_id: 'finding-1',
    document_id: 'proposal-1',
    document_name: 'synthetic-proposal.pdf',
    source_locator: 'Characters 20-80',
    excerpt: 'Our staffing plan assigns qualified personnel to every required role.',
    is_manual: true,
  }],
  human_verified: true,
  reviewer: 'Synthetic Reviewer',
  stale: false,
  generated_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-08T00:00:00Z',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('release integrity workflows', () => {
  it('requires an explicit reviewer and reason when waiving an incomplete CDRL', async () => {
    const cdrl: CDRL = {
      id: 'cdrl-1',
      document_id: 'source-1',
      document_name: 'synthetic-cdrl.pdf',
      source_text: 'Synthetic DD Form 1423 record.',
      source_locator: 'Exhibit A, page 1',
      block_1: 'A001',
      block_2: 'Monthly Status Report',
      incomplete: true,
      incomplete_fields: ['block_10_frequency'],
    }
    const pending: CDRLAdjudication = {
      cdrl_id: cdrl.id,
      project_id: 'project-1',
      status: 'PENDING',
      fresh: true,
      context_only: false,
      incomplete: true,
      missing_fields: ['block_10_frequency'],
      effective_ready: false,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/cdrl-adjudications')) return jsonResponse([pending])
      if (url.endsWith('/cdrls/cdrl-1/adjudication') && init?.method === 'PUT') {
        expect(JSON.parse(String(init.body))).toMatchObject({
          status: 'WAIVED',
          reviewer: 'Synthetic Reviewer',
          waiver_reason: 'Synthetic source intentionally omits the delivery frequency.',
        })
        return jsonResponse({
          ...pending,
          status: 'WAIVED',
          reviewer: 'Synthetic Reviewer',
          waiver_reason: 'Synthetic source intentionally omits the delivery frequency.',
          updated_at: '2026-08-08T01:00:00Z',
          effective_ready: true,
        })
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<CdrlRegister projectId="project-1" cdrls={[cdrl]} onReviewRequirement={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /view details/i }))
    await user.selectOptions(screen.getByLabelText('Decision'), 'WAIVED')
    await user.type(screen.getByLabelText(/Reviewer label/), 'Synthetic Reviewer')
    await user.type(screen.getByLabelText(/Waiver reason/), 'Synthetic source intentionally omits the delivery frequency.')
    await user.click(screen.getByRole('button', { name: /save optional note/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Optional CDRL note saved')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cdrls/cdrl-1/adjudication'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('lets a reviewer remove mistaken manual evidence and reloads the stale finding', async () => {
    let deleted = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/evidence/evidence-1') && init?.method === 'DELETE') {
        deleted = true
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/crosswalk')) {
        return jsonResponse([{ ...finding, stale: deleted, human_verified: !deleted, evidence: deleted ? [] : finding.evidence }])
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<CrosswalkWorkspace projectId="project-1" proposalDocuments={[]} />)
    await user.click(await screen.findByRole('button', { name: /covered 1/i }))
    await user.click(screen.getByRole('button', { name: new RegExp(requirement.requirement_text, 'i') }))
    const remove = await screen.findByRole('button', { name: /remove manual evidence/i })
    await user.click(remove)

    await waitFor(() => expect(deleted).toBe(true))
    expect(await screen.findByText(/no candidate evidence was found/i)).toBeInTheDocument()
  })

  it('surfaces stale covered findings in the attention view and paginates large result sets', async () => {
    const findings: CrosswalkFinding[] = Array.from({ length: 30 }, (_, index) => ({
      ...finding,
      id: `finding-${index + 1}`,
      requirement_id: `requirement-${index + 1}`,
      requirement_text: `Synthetic requirement ${index + 1}`,
      candidate_status: index === 0 ? 'COVERED' : 'MISSING',
      status: index === 0 ? 'COVERED' : 'MISSING',
      stale: index === 0,
      evidence: index === 0 ? finding.evidence : [],
      human_verified: false,
      needs_attention: true,
      attention_reasons: [index === 0
        ? 'Reanalyze this finding after source changes.'
        : 'Resolve the missing proposal coverage result.'],
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(findings)))
    const user = userEvent.setup()

    render(<CrosswalkWorkspace projectId="project-1" proposalDocuments={[]} />)

    expect(await screen.findByRole('button', { name: /Synthetic requirement 1(?:\D|$)/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Synthetic requirement 26/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 1–25 of 30 matching findings/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByRole('button', { name: /Synthetic requirement 26/i })).toBeInTheDocument()
    expect(screen.getByText(/Showing 26–30 of 30 matching findings/i)).toBeInTheDocument()
  })

  it('creates and displays an action linked to a requirement', async () => {
    const readiness: ReadinessSummary = {
      project_id: 'project-1', ready: false, readiness_percent: 99.92,
      workflow_stage: 'REPORTS', workflow_status: 'IN_PROGRESS',
      documents_total: 2, documents_classified: 2, proposal_documents: 1,
      intake_total: 6, intake_verified: 6, intake_issues: 0,
      requirements_total: 1, requirements_validated: 1, requirements_pending: 0,
      cdrls_total: 0, cdrls_ready: 0, cdrls_incomplete: 0, cdrls_unreviewed: 0,
      cdrls_waived: 0, cdrls_stale: 0,
      crosswalk_total: 1, crosswalk_verified: 1, covered: 1, partial: 0,
      missing: 0, conflict: 0, n_a: 0, unverified: 0,
      actions_open: 0, actions_blocked: 0, blocking_reasons: [], next_action: null,
      stages: [],
    }
    let actions: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/readiness')) return jsonResponse(readiness)
      if (url.endsWith('/requirements')) return jsonResponse([requirement])
      if (url.endsWith('/crosswalk')) return jsonResponse([finding])
      if (url.endsWith('/actions') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(body.requirement_id).toBe(requirement.id)
        actions = [{
          id: 'action-1', project_id: 'project-1', ...body,
          created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
        }]
        return jsonResponse(actions[0], 201)
      }
      if (url.endsWith('/actions')) return jsonResponse(actions)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ReportsWorkspace projectId="project-1" />)
    await screen.findByRole('heading', { name: /action register/i })
    expect(screen.getByText('99.92%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add action/i }))
    await user.type(screen.getByLabelText('Action title'), 'Confirm staffing commitment')
    await user.selectOptions(screen.getByLabelText(/Related compliance item/), `requirement:${requirement.id}`)
    await user.click(screen.getByRole('button', { name: /create action/i }))

    expect(await screen.findByText('Confirm staffing commitment')).toBeInTheDocument()
    expect(screen.getByText(/Requirement · The offeror shall provide a staffing plan/i)).toBeInTheDocument()
  })
})
