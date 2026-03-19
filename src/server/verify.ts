import { Connection, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js'
import { VerificationError } from '../core/errors.js'

export interface VerifyTransferParams {
  signature: string
  reference: PublicKey
  expectedRecipientAta: PublicKey
  expectedMint: PublicKey
  expectedAmount: bigint
  timeoutMs?: number
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/** @internal Exported for reuse in session top-up verification. */
export async function fetchWithTimeout(
  connection: Connection,
  signature: string,
  timeoutMs: number,
): Promise<ParsedTransactionWithMeta> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (tx) return tx
    await sleep(1000)
  }
  throw new VerificationError(`Transaction not found within ${timeoutMs}ms: ${signature}`)
}

export function computeTransferDelta(
  tx: ParsedTransactionWithMeta,
  recipientAta: PublicKey,
  mint: PublicKey,
): bigint {
  const pre = tx.meta?.preTokenBalances ?? []
  const post = tx.meta?.postTokenBalances ?? []
  const keys = tx.transaction.message.accountKeys
  const mintStr = mint.toBase58()
  const ataStr = recipientAta.toBase58()
  let delta = BigInt(0)

  for (const p of post) {
    if (p.mint !== mintStr) continue
    const key = keys[p.accountIndex]?.pubkey?.toBase58()
    if (key !== ataStr) continue
    const postAmt = BigInt(p.uiTokenAmount.amount)
    const preEntry = pre.find(b => b.accountIndex === p.accountIndex && b.mint === mintStr)
    const preAmt = preEntry ? BigInt(preEntry.uiTokenAmount.amount) : BigInt(0)
    delta += postAmt - preAmt
  }

  return delta
}

/**
 * Verify an on-chain SPL token transfer:
 * 1. Transaction exists and succeeded
 * 2. Reference key is present in account keys
 * 3. Transfer delta to recipient ATA >= expected amount
 */
export async function verifyTransfer(
  connection: Connection,
  params: VerifyTransferParams,
): Promise<void> {
  const {
    signature,
    reference,
    expectedRecipientAta,
    expectedMint,
    expectedAmount,
    timeoutMs = 60_000,
  } = params

  const tx = await fetchWithTimeout(connection, signature, timeoutMs)

  if (tx.meta?.err) {
    throw new VerificationError(
      `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
    )
  }

  const hasRef = tx.transaction.message.accountKeys.some(k => k.pubkey.equals(reference))
  if (!hasRef) {
    throw new VerificationError(
      `Reference key ${reference.toBase58()} not found in transaction`,
    )
  }

  const delta = computeTransferDelta(tx, expectedRecipientAta, expectedMint)
  if (delta < expectedAmount) {
    throw new VerificationError(
      `Insufficient transfer: expected ${expectedAmount}, got ${delta}`,
    )
  }
}
