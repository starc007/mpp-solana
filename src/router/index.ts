import { Hono } from 'hono'
import { Mppx } from 'mppx/server'
import { Store, Method } from 'mppx'
import type { SolanaNetwork } from '../core/rpc.js'
import { charge as createCharge } from '../server/charge.js'
import { Connection, PublicKey } from '@solana/web3.js'

export interface TokenConfig {
  /** SPL token mint address */
  mint: PublicKey
  /** Token decimals. Auto-detected if omitted. */
  decimals?: number
  /** Base charge amount in human-readable units (e.g. "0.10") */
  amount: string
  description?: string
}

export interface PaymentRouterParams {
  tokens: TokenConfig[]
  /** Recipient wallet address. Shared across all tokens. */
  recipient: PublicKey
  connection?: Connection
  endpoints?: string[]
  network?: SolanaNetwork
  /**
   * Shared store for cross-token replay protection.
   * A single signature can only be consumed once, even if two token methods
   * both try to process it. Required.
   */
  store: Store.Store
  verifyTimeout?: number
}

/**
 * Create a multi-asset Solana payment router.
 *
 * Each token gets its own `charge()` instance, but they share the same Store
 * so replay protection is global across all tokens.
 *
 * Usage:
 * ```ts
 * const router = createPaymentRouter({ tokens: [...], recipient, store })
 * app.route('/pay', router.hono)
 * ```
 */
export interface PaymentRouterResult {
  hono: Hono
  methods: Method.AnyServer[]
}

export function createPaymentRouter(params: PaymentRouterParams): PaymentRouterResult {
  const { tokens, recipient, store, verifyTimeout, network = 'mainnet-beta' } = params

  // One charge method per token — all share the same store for cross-token replay protection
  const methods = tokens.map(token =>
    createCharge({
      recipient,
      mint: token.mint,
      decimals: token.decimals,
      connection: params.connection,
      endpoints: params.endpoints,
      network,
      store,
      verifyTimeout,
    })
  )

  const app = new Hono()

  // Register one route per token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const method = methods[i]!
    const mintStr = token.mint.toBase58()

    // Each token gets its own Mppx instance with a single charge method.
    // The handler key is 'solana/charge' (name/intent from the chargeMethod schema).
    const mppx = Mppx.create({
      methods: [method],
    })

    app.all(`/${mintStr}`, async (c) => {
      const result = await mppx['solana/charge']({
        amount: token.amount,
        ...(token.description ? { description: token.description } : {}),
      })(c.req.raw)

      if (result.status === 402) return result.challenge

      return result.withReceipt(
        new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    })
  }

  // Health check
  app.get('/health', (c) =>
    c.json({ ok: true, tokens: tokens.map(t => t.mint.toBase58()) })
  )

  return { hono: app, methods }
}
