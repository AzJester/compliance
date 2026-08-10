import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CrosswalkFinding, ReadinessSummary } from '../types'
import { ReportsWorkspace } from './ReportsWorkspace'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function readinessWith(updates: Partial<ReadinessSummary> = {}): ReadinessSummary {
  return {
    project_id: 'project/1',
    ready: false,
    readiness_percent: 0.48,
    workflow_stage: 'REPORTS',
    workflow_status: 'IN_PROGRESS',
    documents_total: 5,
    documents_classified: 5,
    proposal_documents: 1,
    intake_total: 0,
    intake_verified: 0,
    intake_issues: 0,
    requirements_total: 1250,
    requirements_validated: 0,
    requirements_pending: 1250,
    cdrls_total: 0,
    cdrls_ready: 0,
    cdrls_incomplete: 0,
    cdrls_unreviewed: 0,
    cdrls_waived: 0,
    cdrls_stale: 0,
    crosswalk_total: 1250,
    crosswalk_verified: 0,
    covered: 6,
    partial: 351,
    missing: 813,
    conflict: 80,
    n_a: 0,
    unverified: 1250,
    actions_open: 0,
    actions_blocked: 0,
    blocking_reasons: ['Resolve proposal coverage gaps.'],
    next_action: 'Address missing, partial, and conflicting responses.',
    stages: [],
    ...updates,
  }
}

const finding: CrosswalkFinding = {
  id: 'finding-1',
  project_id: 'project/1',
  requirement_id: 'requirement-1',
  requirement_text: 'The offeror shall provide a synthetic transition plan.',
  requirement_section: 'L',
  candidate_status: 'MISSING',
  status: 'MISSING',
  score: 0,
  evidence: [],
  human_verified: false,
  stale: false,
  generated_at: '2026-08-10T19:03:16Z',
  updated_at: '2026-08-10T19:04:55Z',
}

function dataFetch(readiness: ReadinessSummary, findings: CrosswalkFinding[] = [finding]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/readiness')) return jsonResponse(readiness)
    if (url.endsWith('/crosswalk')) return jsonResponse(findings)
    if (url.endsWith('/actions') || url.endsWith('/requirements')) return jsonResponse([])
    return jsonResponse({ detail: 'Not found' }, 404)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ReportsWorkspace report creation', () => {
  it('leads with shareable reports, preserves the public-data warning, and keeps raw exports secondary', async () => {
    const findings = [
      ...Array.from({ length: 351 }, (_, index) => ({ ...finding, id: `partial-${index}`, status: 'PARTIAL' as const, candidate_status: 'PARTIAL' as const })),
      ...Array.from({ length: 813 }, (_, index) => ({ ...finding, id: `missing-${index}` })),
      ...Array.from({ length: 80 }, (_, index) => ({ ...finding, id: `conflict-${index}`, status: 'CONFLICT' as const, candidate_status: 'CONFLICT' as const })),
    ]
    vi.stubGlobal('fetch', dataFetch(readinessWith(), findings))

    render(<ReportsWorkspace projectId="project/1" isAnonymous />)

    expect(await screen.findByRole('heading', { name: /create reports/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/public demo report warning/i)).toHaveTextContent(/Synthetic PUBLIC data only/i)
    expect(screen.getByRole('heading', { name: /compliance assessment report/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /requirements gap report/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/current compliance report snapshot/i)).toHaveTextContent('1,250 assessed')
    expect(screen.getByLabelText(/current compliance report snapshot/i)).toHaveTextContent('6 covered')
    expect(screen.getByLabelText(/current compliance report snapshot/i)).toHaveTextContent('1,244 gaps')
    expect(screen.getByLabelText(/current gap report snapshot/i)).toHaveTextContent('351 partial')
    expect(screen.getByLabelText(/current gap report snapshot/i)).toHaveTextContent('813 missing')
    expect(screen.getByLabelText(/current gap report snapshot/i)).toHaveTextContent('80 conflicts')

    const rawExports = screen.getByText(/Raw data exports/i).closest('details')
    expect(rawExports).not.toHaveAttribute('open')
  })

  it('creates a report server-side, prevents duplicate downloads, and uses the server filename', async () => {
    let resolveDownload!: (response: Response) => void
    const pendingDownload = new Promise<Response>((resolve) => { resolveDownload = resolve })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/readiness')) return jsonResponse(readinessWith())
      if (url.endsWith('/crosswalk')) return jsonResponse([finding])
      if (url.endsWith('/actions') || url.endsWith('/requirements')) return jsonResponse([])
      if (url.endsWith('/exports/compliance-report.docx')) return pendingDownload
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const createObjectUrl = vi.fn(() => 'blob:report')
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl })
    let downloadedFilename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function downloadClick(this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })
    const user = userEvent.setup()

    render(<ReportsWorkspace projectId="project/1" />)
    const createButton = await screen.findByRole('button', { name: /create and download DOCX/i })
    await user.click(createButton)

    expect(screen.getByRole('button', { name: /creating DOCX/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /create and download CSV/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /creating DOCX/i }))
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/exports/compliance-report.docx'))).toHaveLength(1)

    await act(async () => {
      resolveDownload(new Response(new Blob(['synthetic report']), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': 'attachment; filename="synthetic-compliance.docx"',
        },
      }))
    })

    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(/Compliance assessment report downloaded/i)
    expect(downloadedFilename).toBe('synthetic-compliance.docx')
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:report')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project%2F1/exports/compliance-report.docx',
      { headers: { Accept: '*/*' } },
    )
  })

  it('reports generation errors and allows a retry', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/readiness')) return jsonResponse(readinessWith())
      if (url.endsWith('/crosswalk')) return jsonResponse([finding])
      if (url.endsWith('/actions') || url.endsWith('/requirements')) return jsonResponse([])
      if (url.endsWith('/exports/gaps.csv')) return jsonResponse({ detail: 'The gap report could not be created.' }, 500)
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ReportsWorkspace projectId="project/1" />)
    await user.click(await screen.findByRole('button', { name: /create and download CSV/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Report creation failed: The gap report could not be created/i,
    )
    expect(screen.getByRole('button', { name: /create and download CSV/i })).toBeEnabled()
  })

  it('does not present zero gaps as compliant before proposal analysis', async () => {
    vi.stubGlobal('fetch', dataFetch(readinessWith({
      readiness_percent: 0,
      crosswalk_total: 0,
      covered: 0,
      partial: 0,
      missing: 0,
      conflict: 0,
      unverified: 0,
    }), []))

    render(<ReportsWorkspace projectId="project/1" />)

    expect(await screen.findByText(/Analyze the proposal before creating reports/i)).toBeInTheDocument()
    expect(screen.getByText(/zero gaps does not mean the proposal is compliant/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Proposal analysis required/i)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /create and download DOCX/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /create and download CSV/i })).toBeDisabled()
    expect(screen.queryByLabelText(/current compliance report snapshot/i)).not.toBeInTheDocument()
  })

  it('warns when a report would use stale assessment results', async () => {
    vi.stubGlobal('fetch', dataFetch(readinessWith({ crosswalk_total: 0, missing: 0 }), [{ ...finding, stale: true }]))

    render(<ReportsWorkspace projectId="project/1" />)

    const warning = await screen.findByText(/The saved assessment is out of date/i)
    expect(warning.parentElement).toHaveTextContent(/Reanalyze before sharing/i)
    const reportButton = screen.getByRole('button', { name: /create and download DOCX/i })
    expect(reportButton).toBeEnabled()
    expect(reportButton).toHaveAttribute('aria-describedby', 'report-availability-note')
    expect(screen.getByRole('button', { name: /create and download CSV/i })).toBeDisabled()
    expect(screen.getByLabelText(/current gap report snapshot/i)).toHaveTextContent('1 missing')
  })

  it('keeps the narrative report available but blocks gap CSV for an incomplete assessment', async () => {
    vi.stubGlobal('fetch', dataFetch(readinessWith({ crosswalk_total: 1 }), [finding]))

    render(<ReportsWorkspace projectId="project/1" />)

    expect(await screen.findByText(/assessment is incomplete or contains invalid results/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create and download DOCX/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /create and download CSV/i })).toBeDisabled()
  })
})
