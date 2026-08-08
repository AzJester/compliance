import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API error handling', () => {
  it('formats FastAPI validation detail arrays as readable field messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: [
        { type: 'datetime_from_date_parsing', loc: ['body', 'due_at'], msg: 'Input should be a valid datetime' },
        { type: 'extra_forbidden', loc: ['body', 'due_timezone'], msg: 'Extra inputs are not permitted' },
      ],
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(api.createProject({ name: 'Test', sensitivity: 'CUI' }))
      .rejects
      .toEqual(expect.objectContaining({
        message: 'due_at: Input should be a valid datetime; due_timezone: Extra inputs are not permitted',
        status: 422,
      }))
  })

  it('uses the requirement, review, extraction, and CDRL API contracts', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/requirements/extract')) return new Response(JSON.stringify({
        documents_analyzed: 1,
        requirements_created: 2,
        requirements_reused: 0,
        cdrls_created: 1,
        cdrls_reused: 0,
        total_requirements: 2,
        pending_requirements: 2,
      }), { status: 200 })
      if (url.endsWith('/reviews')) return new Response(JSON.stringify({ reviews: [] }), { status: 200 })
      if (url.endsWith('/cdrls')) return new Response(JSON.stringify({ cdrls: [] }), { status: 200 })
      if (url.endsWith('/requirements') && !init?.method) return new Response(JSON.stringify({ requirements: [] }), { status: 200 })
      if (init?.method === 'PATCH') return new Response(JSON.stringify({ id: 'req-1' }), { status: 200 })
      return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
    }))

    const summary = await api.extractRequirements('project 1')
    await api.listRequirements('project 1')
    await api.listCdrls('project 1')
    await api.listRequirementReviews('project 1', 'req/1')
    await api.updateRequirement('project 1', 'req/1', {
      requirement_text: 'Updated',
      section: 'L',
      category: 'SUBMISSION_INSTRUCTION',
      obligation_owner: 'OFFEROR',
      applicability: 'PROPOSAL',
      validation_status: 'VALIDATED',
      reviewer: 'Reviewer',
      review_note: 'Confirmed',
      expected_updated_at: '2026-08-07T20:00:00Z',
    })

    expect(summary.requirements_created).toBe(2)
    expect(calls.map((call) => call.url)).toEqual([
      '/api/projects/project%201/requirements/extract',
      '/api/projects/project%201/requirements',
      '/api/projects/project%201/cdrls',
      '/api/projects/project%201/requirements/req%2F1/reviews',
      '/api/projects/project%201/requirements/req%2F1',
    ])
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[4].init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[4].init?.body))).toMatchObject({
      validation_status: 'VALIDATED',
      reviewer: 'Reviewer',
      expected_updated_at: '2026-08-07T20:00:00Z',
    })
  })

  it('uses the solicitation-detail analyze and atomic apply contracts', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const analysis = {
      project_id: 'project 1', run_id: 'run-1', analyzed_at: '2026-08-08T00:00:00Z',
      input_fingerprint: 'f'.repeat(64), rule_version: '1.0', stale: false,
      project_updated_at: '2026-08-08T00:00:00Z', profile_updated_at: '2026-08-08T00:00:00Z',
      profile: { project_id: 'project 1', issuing_office: null, naics_code: null, psc_code: null, set_aside: null, contract_type: null, points_of_contact: [], updated_at: '2026-08-08T00:00:00Z' },
      fields: [], decisions: [],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/apply')) return new Response(JSON.stringify({
        project: { id: 'project 1' }, profile: analysis.profile, applied_fields: ['naics_code'],
        decisions: [], analysis,
      }), { status: 200 })
      return new Response(JSON.stringify(analysis), { status: 200 })
    }))

    await api.getSolicitationDetails('project 1')
    await api.analyzeSolicitationDetails('project 1')
    await api.applySolicitationDetails('project 1', {
      reviewer: 'Synthetic Reviewer',
      expected_project_updated_at: analysis.project_updated_at,
      expected_profile_updated_at: analysis.profile_updated_at,
      run_id: analysis.run_id,
      approvals: [{ field_key: 'naics_code', candidate_ids: ['candidate/1'] }],
    })

    expect(calls.map((call) => call.url)).toEqual([
      '/api/projects/project%201/solicitation-details',
      '/api/projects/project%201/solicitation-details/analyze',
      '/api/projects/project%201/solicitation-details/apply',
    ])
    expect(calls[1].init?.method).toBe('POST')
    expect(calls[2].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({
      reviewer: 'Synthetic Reviewer',
      approvals: [{ field_key: 'naics_code', candidate_ids: ['candidate/1'] }],
    })
  })
})
