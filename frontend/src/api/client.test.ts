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
})
