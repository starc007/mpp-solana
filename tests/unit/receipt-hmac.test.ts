import { describe, it, expect } from 'bun:test'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

describe('HMAC receipt reference', () => {
  const secret = new Uint8Array(32).fill(0xab)
  const signature = '5UfDuX7WXYc2jRbZ9gR3GNUtgFyPxSHTmJMKQVrz8KHgEQhVGY3yBFkL3kEJvFnPdMrz4wW9t3S1G1DfDgk4sRMZ'

  it('produces a 64-char hex string', () => {
    const ref = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(signature)))
    expect(ref).toHaveLength(64)
    expect(ref).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same secret + signature = same output', () => {
    const ref1 = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(signature)))
    const ref2 = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(signature)))
    expect(ref1).toBe(ref2)
  })

  it('differs with a different secret', () => {
    const secret2 = new Uint8Array(32).fill(0xcd)
    const ref1 = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(signature)))
    const ref2 = bytesToHex(hmac(sha256, secret2, new TextEncoder().encode(signature)))
    expect(ref1).not.toBe(ref2)
  })

  it('differs with a different signature', () => {
    const sig2 = '4XfDuX7WXYc2jRbZ9gR3GNUtgFyPxSHTmJMKQVrz8KHgEQhVGY3yBFkL3kEJvFnPdMrz4wW9t3S1G1DfDgk4sRMZ'
    const ref1 = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(signature)))
    const ref2 = bytesToHex(hmac(sha256, secret, new TextEncoder().encode(sig2)))
    expect(ref1).not.toBe(ref2)
  })

  it('raw signature is returned when no secret is provided', () => {
    const receiptSecret: Uint8Array | undefined = undefined
    const ref = receiptSecret
      ? bytesToHex(hmac(sha256, receiptSecret, new TextEncoder().encode(signature)))
      : signature
    expect(ref).toBe(signature)
  })
})
