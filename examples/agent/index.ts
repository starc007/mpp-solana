/**
 * AI agent example: autonomous USDC payments via mpp-solana.
 *
 * Demonstrates using mpp-solana in an AI agent context where the agent
 * autonomously decides to pay for API access using its wallet.
 *
 * Run: bun examples/agent/index.ts
 * Requires: AGENT_WALLET_PRIVATE_KEY, USDC_DEVNET_MINT
 */
import { Keypair, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import { decode as bs58Decode } from 'bs58'
import { solana, Mppx } from 'mpp-solana/client'

// Agent wallet — loaded from env or a secrets manager in production
async function loadAgentWallet() {
  const keypair = Keypair.fromSecretKey(
    bs58Decode(process.env.AGENT_WALLET_PRIVATE_KEY!)
  )
  return {
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
}

// Lazy wallet: loaded once on first payment, not at startup
const chargeClient = solana.charge({
  wallet: loadAgentWallet,
  network: 'devnet',
})

const mppxClient = Mppx.create({ methods: [chargeClient] })

// Simulate an agent making an API call that requires payment
async function callPaidApi(url: string): Promise<unknown> {
  console.log(`Agent calling paid API: ${url}`)
  const response = await mppxClient.fetch(url)
  if (!response.ok) {
    throw new Error(`API call failed: ${response.status}`)
  }
  console.log(`Payment complete. Receipt: ${response.headers.get('Payment-Receipt')}`)
  return response.json()
}

// Agent "task": call a paid API endpoint
const result = await callPaidApi('http://localhost:3000/pay')
console.log('API result:', result)
