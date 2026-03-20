import { Method, Credential, Receipt } from 'mppx'
import { Connection, PublicKey } from '@solana/web3.js'
import { session as sessionMethod } from '../methods/session.js'
import { resolvePool, type SolanaNetwork, type PriorityFee } from '../core/rpc.js'
import { parseAmount } from '../core/utils.js'
import { buildAndSendTransfer } from '../core/transaction.js'
import type { WalletLike } from '../types.js'

interface ActiveSession { sessionId: string; bearer: string }

export namespace session {
  export interface Parameters {
    wallet: WalletLike | (() => WalletLike | Promise<WalletLike>)
    mint?: PublicKey
    connection?: Connection
    endpoints?: string[]
    network?: SolanaNetwork
    priorityFee?: PriorityFee
    /** Called after a successful on-chain payment (open deposit or topUp) with the tx signature. Fire-and-forget. */
    onPayment?: (signature: string, action: 'open' | 'topUp') => void
  }
}

export function session(params: session.Parameters) {
  const { network = 'mainnet-beta', priorityFee } = params
  const pool = resolvePool({ connection: params.connection, endpoints: params.endpoints, network })

  let walletInstance: WalletLike | undefined
  let activeSession: ActiveSession | null = null
  let pendingTopUp = false
  let pendingClose = false

  async function getWallet(): Promise<WalletLike> {
    if (walletInstance) return walletInstance
    const w = params.wallet
    walletInstance = typeof w === 'function' ? await w() : w
    return walletInstance
  }

  const method = Method.toClient(sessionMethod, {
    async createCredential({ challenge }) {
      if (params.mint && challenge.request.methodDetails.mint !== params.mint.toBase58()) {
        throw new Error(`Mint mismatch: expected ${params.mint.toBase58()}, got ${challenge.request.methodDetails.mint}`)
      }
      const wallet = await getWallet()
      const { methodDetails } = challenge.request

      if (pendingClose && activeSession) {
        const s = activeSession
        pendingClose = false; activeSession = null
        return Credential.serialize({ challenge, payload: { action: 'close' as const, sessionId: s.sessionId, bearer: s.bearer } })
      }

      if (pendingTopUp && activeSession) {
        const signature = await pool.withConnection(async (connection) =>
          buildAndSendTransfer({
            connection, wallet,
            mint: new PublicKey(methodDetails.mint),
            recipient: new PublicKey(methodDetails.recipient),
            amount: parseAmount(challenge.request.amount, methodDetails.decimals),
            decimals: methodDetails.decimals,
            reference: new PublicKey(methodDetails.reference),
            priorityFee,
          })
        )
        if (params.onPayment) {
          Promise.resolve().then(() => params.onPayment!(signature, 'topUp')).catch(() => {})
        }
        pendingTopUp = false
        return Credential.serialize({ challenge, payload: { action: 'topUp' as const, sessionId: activeSession.sessionId, bearer: activeSession.bearer, topUpSignature: signature } })
      }

      if (activeSession) {
        return Credential.serialize({ challenge, payload: { action: 'bearer' as const, sessionId: activeSession.sessionId, bearer: activeSession.bearer } })
      }

      const depositAmount = challenge.request.depositAmount ?? challenge.request.amount
      const signature = await pool.withConnection(async (connection) =>
        buildAndSendTransfer({
          connection, wallet,
          mint: new PublicKey(methodDetails.mint),
          recipient: new PublicKey(methodDetails.recipient),
          amount: parseAmount(depositAmount, methodDetails.decimals),
          decimals: methodDetails.decimals,
          reference: new PublicKey(methodDetails.reference),
          priorityFee,
        })
      )
      if (params.onPayment) {
        Promise.resolve().then(() => params.onPayment!(signature, 'open')).catch(() => {})
      }
      return Credential.serialize({ challenge, payload: { action: 'open' as const, depositSignature: signature, refundAddress: wallet.publicKey.toBase58() } })
    },
  })

  function setSessionFromResponse(response: Response): void {
    const h = response.headers.get('Payment-Receipt')
    if (!h) return
    try {
      const receipt = Receipt.deserialize(h)
      const parsed = JSON.parse(receipt.reference ?? '{}')
      if (parsed.sessionId && parsed.bearer) activeSession = { sessionId: parsed.sessionId, bearer: parsed.bearer }
    } catch { /* ignore */ }
  }

  return Object.assign(method, {
    setSessionFromResponse,
    setSession: (sessionId: string, bearer: string) => { activeSession = { sessionId, bearer } },
    topUp: () => { pendingTopUp = true },
    close: () => { pendingClose = true },
    getSession: () => activeSession ? { ...activeSession } : null,
    reset: () => { activeSession = null; pendingTopUp = false; pendingClose = false },
  })
}
