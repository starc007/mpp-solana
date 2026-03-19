import { describe, it, expect } from 'bun:test'
import { isTransient } from '../../src/core/rpc'

describe('isTransient', () => {
  it('returns true for 429 rate limit errors', () => {
    expect(isTransient(new Error('Response status: 429'))).toBe(true)
  })

  it('returns true for 503 service unavailable', () => {
    expect(isTransient(new Error('503 Service Unavailable'))).toBe(true)
  })

  it('returns true for ETIMEDOUT', () => {
    expect(isTransient(new Error('ETIMEDOUT'))).toBe(true)
  })

  it('returns true for ECONNRESET', () => {
    expect(isTransient(new Error('ECONNRESET'))).toBe(true)
  })

  it('returns true for fetch failed', () => {
    expect(isTransient(new Error('fetch failed'))).toBe(true)
  })

  it('returns false for non-Error values', () => {
    expect(isTransient('not an error')).toBe(false)
    expect(isTransient(null)).toBe(false)
  })

  it('returns false for application-level errors', () => {
    expect(isTransient(new Error('invalid signature'))).toBe(false)
    expect(isTransient(new Error('insufficient funds'))).toBe(false)
    expect(isTransient(new Error('AccountNotFound'))).toBe(false)
  })
})
