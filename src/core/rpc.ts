import { Connection } from '@solana/web3.js'
import { RpcError } from './errors.js'

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'

export const NETWORK_URLS: Record<SolanaNetwork, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  localnet: 'http://localhost:8899',
}

export type PriorityFee = 'fixed' | 'dynamic' | { microLamports: number }

export interface ConnectionPool {
  withConnection<T>(fn: (connection: Connection, url: string) => Promise<T>): Promise<T>
}

/** @internal Exported for testing. Classifies an error as transient (retryable) or fatal. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('fetch failed')
  )
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts - 1 || !isTransient(err)) throw err
      await sleep(Math.min(1000 * Math.pow(2, attempt), 8000))
    }
  }
  throw new Error('unreachable')
}

export function createConnectionPool(endpoints: string[]): ConnectionPool {
  return {
    async withConnection<T>(
      fn: (connection: Connection, url: string) => Promise<T>,
    ): Promise<T> {
      const errors: Error[] = []
      for (const url of endpoints) {
        const connection = new Connection(url, 'confirmed')
        try {
          return await withRetry(() => fn(connection, url))
        } catch (err) {
          if (!isTransient(err)) throw err
          errors.push(err as Error)
        }
      }
      const details = errors.map((e, i) => `  [${endpoints[i]}]: ${e.message}`).join('\n')
      throw new RpcError(
        `All ${endpoints.length} RPC endpoints failed:\n${details}`,
        endpoints,
      )
    },
  }
}

/**
 * Resolve a ConnectionPool from:
 *   - endpoints[]  (multiple endpoints, failover enabled)
 *   - connection   (single pre-built Connection)
 *   - network      (fallback: use NETWORK_URLS)
 * endpoints[] takes precedence over connection.
 */
export function resolvePool(params: {
  connection?: Connection
  endpoints?: string[]
  network?: SolanaNetwork
}): ConnectionPool {
  if (params.endpoints?.length) {
    return createConnectionPool(params.endpoints)
  }
  if (params.connection) {
    const conn = params.connection
    const url = conn.rpcEndpoint
    return {
      withConnection: <T>(fn: (c: Connection, u: string) => Promise<T>) => fn(conn, url),
    }
  }
  const network = params.network ?? 'mainnet-beta'
  const url = NETWORK_URLS[network]
  const conn = new Connection(url, 'confirmed')
  return {
    withConnection: <T>(fn: (c: Connection, u: string) => Promise<T>) => fn(conn, url),
  }
}
