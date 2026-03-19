import type { PublicKey } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import { getMint } from '@solana/spl-token'

/**
 * Parse a human-readable decimal token amount into raw units (bigint).
 * Throws if the amount has more fractional digits than the token supports.
 */
export function parseAmount(amount: string, decimals: number): bigint {
  if (amount.startsWith('-')) {
    throw new Error(`Amount must be non-negative: "${amount}"`)
  }

  const parts = amount.split('.')
  if (parts.length > 2) {
    throw new Error(`Invalid amount format: "${amount}"`)
  }

  const whole = parts[0] ?? '0'
  const frac = parts[1] ?? ''

  if (frac.length > decimals) {
    throw new Error(
      `Amount "${amount}" has ${frac.length} fractional digits but token supports only ${decimals}`,
    )
  }

  const paddedFrac = frac.padEnd(decimals, '0')
  return BigInt(whole + paddedFrac)
}

/**
 * Factory for `detectDecimals`. Accepts a `getMintFn` so the cache logic
 * can be tested offline without a real RPC connection.
 */
export function createDetectDecimals(
  getMintFn: (connection: Connection, mint: PublicKey) => Promise<{ decimals: number }>,
) {
  // Cache: "${mint.toBase58()}:${endpointUrl}" → decimals
  const cache = new Map<string, number>()
  return async function detectDecimals(
    mint: PublicKey,
    endpointUrl: string,
    connection: Connection,
  ): Promise<number> {
    const key = `${mint.toBase58()}:${endpointUrl}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const mintInfo = await getMintFn(connection, mint)
    cache.set(key, mintInfo.decimals)
    return mintInfo.decimals
  }
}

/**
 * Fetch the decimals for an SPL token mint.
 * Results are cached per mint+endpoint so pool failovers don't break the cache.
 */
export const detectDecimals = createDetectDecimals(getMint)
