import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CDRL, ExtractionSummary, Requirement } from '../types'
import { RequirementsWorkspace } from './RequirementsWorkspace'

const requirement = (overrides: Partial<Requirement> = {}): Requirement => ({
  id: 'req-1',
  document_id: 'doc-1',
  document_name: 'Solicitation.pdf',
  requirement_text: 'The offeror shall provide a staffing plan.',
  source_text: 'The Offeror shall provide a staffing plan with its proposal.',
  source_locator: 'Section L.3.2, page 47',
  source_start: 100,
  source_end: 164,
  section: 'L',
  category: 'SUBMISSION_INSTRUCTION',
  mandatory_term: 'shall',
  obligation_owner: 'OFFEROR',
  applicability: 'PROPOSAL',
  confidence: 0.94,
  extraction_method: 'RULES',
  rule_version: 'rules-1.0',
  validation_status: 'PENDING',
  created_at: '2026-08-07T20:00:00Z',
  updated_at: '2026-08-07T20:00:00Z',
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RequirementsWorkspace', () => {
  it('runs extraction, reloads registers, and reports the exact summary', async () => {
    let extracted = false
    const summary: ExtractionSummary = {
      documents_analyzed: 3,
      requirements_created: 2,
      requirements_reused: 4,
      cdrls_created: 1,
      cdrls_reused: 2,
      total_requirements: 6,
      pending_requirements: 5,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/requirements/extract') && init?.method === 'POST') {
        extracted = true
        return jsonResponse(summary)
      }
      if (url.endsWith('/requirements')) return jsonResponse({ requirements: extracted ? [requirement()] : [] })
      if (url.endsWith('/cdrls')) return jsonResponse({ cdrls: [] })
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<RequirementsWorkspace projectId="project-1" view="requirements" />)
    expect(await screen.findByRole('heading', { name: 'All requirements' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /extract requirements/i }))

    const result = await screen.findByRole('region', { name: /extraction complete/i })
    expect(within(result).getByText('3 documents analyzed')).toBeInTheDocument()
    expect(within(result).getByText('Requirements created').nextElementSibling).toHaveTextContent('2')
    expect(within(result).getByText('Requirements reused').nextElementSibling).toHaveTextContent('4')
    expect(within(result).getByText('CDRLs created').nextElementSibling).toHaveTextContent('1')
    expect(within(result).getByText('CDRLs reused').nextElementSibling).toHaveTextContent('2')
    expect(within(result).getByText('Total requirements').nextElementSibling).toHaveTextContent('6')
    expect(within(result).getByText('Pending review').nextElementSibling).toHaveTextContent('5')
    expect(screen.getByText(requirement().requirement_text)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Extraction complete: 2 requirements and 1 CDRL records created.',
    )
  })

  it('provides dedicated Section L and Section M registers', async () => {
    const sectionL = requirement({ id: 'req-l', requirement_text: 'Submit a signed cover letter.' })
    const sectionM = requirement({
      id: 'req-m',
      section: 'M',
      category: 'EVALUATION_FACTOR',
      requirement_text: 'Technical approach is more important than price.',
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/requirements')) return jsonResponse([sectionL, sectionM])
      if (url.endsWith('/cdrls')) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    }))

    const { rerender } = render(<RequirementsWorkspace projectId="project-1" view="section-l" />)
    expect(await screen.findByRole('heading', { name: /section l submission register/i })).toBeInTheDocument()
    expect(screen.getByText(sectionL.requirement_text)).toBeInTheDocument()
    expect(screen.queryByText(sectionM.requirement_text)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(sectionL.requirement_text, 'i') }))
    expect(await screen.findByRole('heading', { name: /review requirement/i })).toBeInTheDocument()

    rerender(<RequirementsWorkspace projectId="project-1" view="section-m" />)
    expect(await screen.findByRole('heading', { name: /section m evaluation register/i })).toBeInTheDocument()
    expect(screen.getByText(sectionM.requirement_text)).toBeInTheDocument()
    expect(screen.queryByText(sectionL.requirement_text)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /review requirement/i })).not.toBeInTheDocument()
    })
  })

  it('keeps review saves locked while switching registers', async () => {
    const sectionL = requirement({ id: 'req-l', requirement_text: 'Submit a signed cover letter.' })
    const sectionM = requirement({
      id: 'req-m',
      section: 'M',
      category: 'EVALUATION_FACTOR',
      requirement_text: 'Technical approach is more important than price.',
    })
    const pendingPatch = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/requirements') && !init?.method) return jsonResponse([sectionL, sectionM])
      if (url.endsWith('/cdrls')) return jsonResponse([])
      if (url.endsWith('/reviews')) return jsonResponse([])
      if (url.endsWith(`/requirements/${sectionL.id}`) && init?.method === 'PATCH') {
        return pendingPatch.promise
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    const { rerender } = render(<RequirementsWorkspace projectId="project-1" view="section-l" />)
    await user.click(await screen.findByRole('button', { name: /submit a signed cover letter/i }))
    await user.type(screen.getByLabelText(/^reviewer$/i), 'First Reviewer')
    await user.click(screen.getByRole('button', { name: /^validate$/i }))

    rerender(<RequirementsWorkspace projectId="project-1" view="section-m" />)
    await user.click(await screen.findByRole('button', { name: /technical approach is more important/i }))
    expect(screen.getByRole('button', { name: /^saving/i })).toBeDisabled()

    act(() => {
      pendingPatch.resolve(jsonResponse({
        ...sectionL,
        validation_status: 'VALIDATED',
        reviewer: 'First Reviewer',
        updated_at: '2026-08-07T23:30:00Z',
      }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^validate$/i })).toBeEnabled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reloads the current requirement after a stale review conflict', async () => {
    const initial = requirement()
    const current = requirement({
      validation_status: 'VALIDATED',
      reviewer: 'Other Reviewer',
      requirement_text: 'Current requirement text from another review.',
      updated_at: '2026-08-07T23:45:00Z',
    })
    let requirementReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/requirements') && !init?.method) {
        requirementReads += 1
        return jsonResponse([requirementReads === 1 ? initial : current])
      }
      if (url.endsWith('/cdrls')) return jsonResponse([])
      if (url.endsWith('/reviews')) return jsonResponse([])
      if (url.endsWith(`/requirements/${initial.id}`) && init?.method === 'PATCH') {
        return jsonResponse({
          detail: 'Requirement changed after it was loaded; refresh and review the latest version.',
        }, 409)
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    render(<RequirementsWorkspace projectId="project-1" view="requirements" />)
    await user.click(await screen.findByRole('button', { name: /offeror shall provide a staffing plan/i }))
    await user.type(screen.getByLabelText(/^reviewer$/i), 'Stale Reviewer')
    await user.click(screen.getByRole('button', { name: /^validate$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/refresh and review the latest version/i)
    expect(requirementReads).toBe(2)
    expect(screen.getByLabelText(/normalized requirement/i)).toHaveValue(current.requirement_text)
    expect(screen.getByLabelText(/^reviewer$/i)).toHaveValue('Other Reviewer')
  })

  it('renders hostile solicitation content only as inert text', async () => {
    const hostile = '<img src="https://attacker.invalid/pixel" onerror="fetch(\'/steal\')"><script>window.pwned=true</script> javascript:alert(1)'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/requirements')) return jsonResponse([requirement({ source_text: hostile, source_locator: 'javascript:alert(2)' })])
      if (url.endsWith('/cdrls')) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<RequirementsWorkspace projectId="project-1" view="requirements" />)
    expect(await screen.findByText(hostile)).toBeInTheDocument()
    expect(screen.getByText('javascript:alert(2)')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([input]) => String(input).startsWith('/api/'))).toBe(true)
  })

  it('renders CDRL Block 16 and opens its linked requirement for human review', async () => {
    const linked = requirement({ id: 'req-cdrl', category: 'CDRL', requirement_text: 'Deliver the monthly status report.' })
    const cdrl: CDRL = {
      id: 'cdrl-1',
      document_id: 'doc-1',
      document_name: 'Exhibit A.pdf',
      requirement_id: linked.id,
      source_text: 'A001 Monthly Status Report',
      source_locator: 'Exhibit A, page 2',
      block_1: 'A001',
      block_2: 'Monthly Status Report',
      block_4: 'DI-MGMT-80368',
      block_10: 'MTHLY',
      block_12: '30 DAC',
      block_13: 'Every 30 days',
      block_16: 'Draft due five workdays before the final submission.',
      incomplete: true,
      incomplete_fields: ['block_3_subtitle'],
      source_truncated: true,
      validation_status: 'PENDING',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/requirements')) return jsonResponse({ requirements: [linked] })
      if (url.endsWith('/cdrls')) return jsonResponse({ cdrls: [cdrl] })
      if (url.endsWith(`/requirements/${linked.id}`) && init?.method === 'PATCH') {
        const update = JSON.parse(String(init.body)) as Partial<Requirement>
        return jsonResponse({ ...linked, ...update, updated_at: '2026-08-07T23:00:00Z' })
      }
      if (url.endsWith('/reviews')) return jsonResponse({ reviews: [{
        id: 'review-1',
        requirement_id: linked.id,
        action: 'VALIDATED',
        previous_state: { validation_status: 'PENDING' },
        new_state: { validation_status: 'VALIDATED' },
        note: 'Reviewed against the exact solicitation source.',
        reviewer: 'Dana Reviewer',
        created_at: '2026-08-07T22:00:00Z',
      }] })
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    render(<RequirementsWorkspace projectId="project-1" view="cdrls" />)
    const blockSixteen = await screen.findByRole('region', { name: /block 16 remarks/i })
    expect(within(blockSixteen).getByText(cdrl.block_16!)).toBeInTheDocument()
    expect(screen.getByText(/source capped · 1 fields missing/i)).toBeInTheDocument()
    const inventorySummary = screen.getByText(/view full DD Form 1423 field inventory/i)
    expect(inventorySummary).toBeInTheDocument()
    expect(inventorySummary.closest('details')?.querySelectorAll('dt')).toHaveLength(24)
    const missingFields = screen.getByRole('region', { name: /missing CDRL fields/i })
    expect(within(missingFields).getByText('Block 3 — Subtitle')).toBeInTheDocument()
    expect(screen.getAllByText('Not captured').length).toBeGreaterThan(0)
    expect(screen.getAllByText('DI-MGMT-80368').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /review linked requirement/i }))
    expect(await screen.findByRole('heading', { name: /review requirement/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close requirement review/i })).toHaveFocus()
    })
    expect(screen.getAllByText(linked.source_text).length).toBeGreaterThan(0)
    expect(await screen.findByText('Reviewed against the exact solicitation source.')).toBeInTheDocument()
    expect(screen.getByText('VALIDATED')).toBeInTheDocument()
    expect(screen.getByText(/view recorded before and after state/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^reviewer$/i), 'Dana Reviewer')
    await user.click(screen.getByRole('button', { name: /^validate$/i }))
    expect(await screen.findByText('Review validated')).toBeInTheDocument()
  })

  it('requires reviewer identity and a dismissal reason when adjudicating', async () => {
    const patchBodies: Record<string, unknown>[] = []
    let current = requirement()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/requirements') && !init?.method) return jsonResponse([current])
      if (url.endsWith('/cdrls')) return jsonResponse([])
      if (url.endsWith('/reviews')) return jsonResponse([])
      if (url.includes(`/requirements/${current.id}`) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patchBodies.push(body)
        current = { ...current, ...body, updated_at: '2026-08-07T21:00:00Z' } as Requirement
        return jsonResponse(current)
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    }))
    const user = userEvent.setup()

    render(<RequirementsWorkspace projectId="project-1" view="requirements" />)
    await user.click(await screen.findByText(current.requirement_text))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/reviewer name is required to save any review decision/i)
    expect(patchBodies).toHaveLength(0)

    await user.type(screen.getByLabelText(/^reviewer$/i), 'Alex Reviewer')
    await user.click(screen.getByRole('button', { name: /^validate$/i }))
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ validation_status: 'VALIDATED', reviewer: 'Alex Reviewer' })

    await user.click(screen.getByRole('button', { name: /^dismiss$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/dismissal reason is required/i)
    await user.type(screen.getByRole('textbox', { name: /dismissal reason/i }), 'Not an offeror obligation.')
    await user.click(screen.getByRole('button', { name: /^dismiss$/i }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1]).toMatchObject({
      validation_status: 'DISMISSED',
      reviewer: 'Alex Reviewer',
      review_note: 'Not an offeror obligation.',
    })
  })

  it('never applies a late requirement response to a different project', async () => {
    const alphaResponse = deferred<Response>()
    const alpha = requirement({ id: 'req-alpha', requirement_text: 'Alpha requirement' })
    const bravo = requirement({ id: 'req-bravo', requirement_text: 'Bravo requirement' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/project-alpha/requirements')) return alphaResponse.promise
      if (url.includes('/project-alpha/cdrls')) return jsonResponse([])
      if (url.includes('/project-bravo/requirements')) return jsonResponse([bravo])
      if (url.includes('/project-bravo/cdrls')) return jsonResponse([])
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<RequirementsWorkspace projectId="project-alpha" view="requirements" />)
    rerender(<RequirementsWorkspace projectId="project-bravo" view="requirements" />)
    expect(await screen.findByText(bravo.requirement_text)).toBeInTheDocument()

    await act(async () => alphaResponse.resolve(jsonResponse([alpha])))
    expect(screen.queryByText(alpha.requirement_text)).not.toBeInTheDocument()
    expect(screen.getByText(bravo.requirement_text)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/project-bravo/requirements'))).toBe(true)
  })
})
