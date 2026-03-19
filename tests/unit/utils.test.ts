import { describe, it, expect } from 'bun:test'
import { PublicKey, Keypair, type Connection } from '@solana/web3.js'
import { parseAmount, createDetectDecimals } from '../../src/core/utils'

describe('parseAmount', () => {
  it('converts whole number amounts', () => {
    expect(parseAmount('1', 6)).toBe(BigInt(1_000_000))
    expect(parseAmount('10', 6)).toBe(BigInt(10_000_000))
  })

  it('converts decimal amounts', () => {
    expect(parseAmount('0.01', 6)).toBe(BigInt(10_000))
    expect(parseAmount('1.5', 6)).toBe(BigInt(1_500_000))
    expect(parseAmount('0.000001', 6)).toBe(BigInt(1))
  })

  it('pads fractional part to full decimals', () => {
    expect(parseAmount('1.1', 6)).toBe(BigInt(1_100_000))
    expect(parseAmount('0.1', 2)).toBe(BigInt(10))
  })

  it('handles zero', () => {
    expect(parseAmount('0', 6)).toBe(BigInt(0))
    expect(parseAmount('0.0', 6)).toBe(BigInt(0))
  })

  it('throws on too many fractional digits', () => {
    expect(() => parseAmount('0.0000001', 6)).toThrow()
    expect(() => parseAmount('1.1234567', 6)).toThrow()
  })

  it('throws on invalid format', () => {
    expect(() => parseAmount('1.2.3', 6)).toThrow()
    expect(() => parseAmount('abc', 6)).toThrow()
  })

  it('throws on negative amounts via BigInt parse', () => {
    expect(() => parseAmount('-1', 6)).toThrow()
  })
})

describe('detectDecimals cache', () => {
  const conn = {} as Connection

  it('fetches decimals on first call and caches the result', async () => {
    let callCount = 0
    const mockGetMint = async () => { callCount++; return { decimals: 6 } as any }
    const detect = createDetectDecimals(mockGetMint)
    const mint = Keypair.generate().publicKey

    const result = await detect(mint, 'https://rpc.example.com', conn)
    expect(result).toBe(6)
    expect(callCount).toBe(1)
  })

  it('returns cached value on second call with same mint + endpoint', async () => {
    let callCount = 0
    const mockGetMint = async () => { callCount++; return { decimals: 9 } as any }
    const detect = createDetectDecimals(mockGetMint)
    const mint = Keypair.generate().publicKey

    const r1 = await detect(mint, 'https://rpc.example.com', conn)
    const r2 = await detect(mint, 'https://rpc.example.com', conn)
    expect(r1).toBe(9)
    expect(r2).toBe(9)
    expect(callCount).toBe(1) // second call hit cache
  })

  it('fetches again for a different endpoint — key includes endpoint URL', async () => {
    let callCount = 0
    const mockGetMint = async () => { callCount++; return { decimals: 6 } as any }
    const detect = createDetectDecimals(mockGetMint)
    const mint = Keypair.generate().publicKey

    await detect(mint, 'https://rpc1.example.com', conn)
    await detect(mint, 'https://rpc2.example.com', conn)
    expect(callCount).toBe(2) // different endpoint → different cache key
  })

  it('different mint addresses use separate cache entries', async () => {
    let callCount = 0
    const mockGetMint = async () => { callCount++; return { decimals: 6 } as any }
    const detect = createDetectDecimals(mockGetMint)
    const mint1 = Keypair.generate().publicKey
    const mint2 = Keypair.generate().publicKey

    await detect(mint1, 'https://rpc.example.com', conn)
    await detect(mint2, 'https://rpc.example.com', conn)
    expect(callCount).toBe(2) // different mints → separate entries
  })
})
