import { describe, it, expect } from 'bun:test'

describe('onPayment callback pattern', () => {
  it('fires synchronous callback without throwing', () => {
    let captured: string | null = null
    const onPayment = (sig: string) => { captured = sig }
    const signature = 'test-sig-123'

    // Simulate fire-and-forget pattern
    Promise.resolve().then(() => onPayment(signature)).catch(() => {})

    // Sync callback sets value on next microtask
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(captured).toBe(signature)
        resolve()
      }, 10)
    })
  })

  it('swallows sync errors without propagating', () => {
    const onPayment = () => { throw new Error('boom') }

    // Should not throw or reject
    const p = Promise.resolve().then(() => onPayment()).catch(() => {})
    return expect(p).resolves.toBeUndefined()
  })

  it('swallows async rejection without propagating', () => {
    const onPayment = async () => { throw new Error('async boom') }

    const p = Promise.resolve().then(() => onPayment()).catch(() => {})
    return expect(p).resolves.toBeUndefined()
  })

  it('session callback receives action parameter', () => {
    let capturedAction: string | null = null
    const onPayment = (sig: string, action: 'open' | 'topUp') => { capturedAction = action }

    Promise.resolve().then(() => onPayment('sig', 'open')).catch(() => {})

    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(capturedAction).toBe('open')
        resolve()
      }, 10)
    })
  })
})
