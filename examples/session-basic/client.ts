/**
 * Session client: opens a session, uses it multiple times, then closes.
 *
 * Run: bun examples/session-basic/client.ts
 * Requires: TEST_WALLET_PRIVATE_KEY, USDC_DEVNET_MINT
 */
import { Keypair, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import { decode as bs58Decode } from 'bs58'
import { solana, Mppx } from 'mppx-solana/client'

const keypair = Keypair.fromSecretKey(bs58Decode(process.env.TEST_WALLET_PRIVATE_KEY!))
const wallet = {
  publicKey: keypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ('version' in tx) {
      (tx as VersionedTransaction).sign([keypair])
    } else {
      (tx as Transaction).sign(keypair)
    }
    return tx
  },
}

const sessionClient = solana.session({ wallet, network: 'devnet' })
const mppxClient = Mppx.create({ methods: [sessionClient] })

// Open session (first request deposits funds)
console.log('Opening session...')
const openRes = await mppxClient.fetch('http://localhost:3001/session')
sessionClient.setSessionFromResponse(openRes)
console.log('Session opened:', sessionClient.getSession()?.sessionId)

// Use the session (bearer auth — no new on-chain tx)
console.log('Using session...')
const useRes = await mppxClient.fetch('http://localhost:3001/session')
console.log('Used session, status:', useRes.status)

// Close the session (triggers refund)
console.log('Closing session...')
sessionClient.close()
const closeRes = await mppxClient.fetch('http://localhost:3001/session')
console.log('Session closed, status:', closeRes.status)
console.log('Session state:', sessionClient.getSession()) // null
