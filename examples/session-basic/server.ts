/**
 * Session example: pre-funded session with bearer auth.
 *
 * Run: bun examples/session-basic/server.ts
 * Requires: TEST_RECIPIENT_ADDRESS, TEST_SERVER_KEYPAIR, USDC_DEVNET_MINT
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { Keypair, PublicKey } from '@solana/web3.js'
import { decode as bs58Decode } from 'bs58'
import { solana, Store, Mppx } from 'mpp-solana/server'

const recipient = new PublicKey(process.env.TEST_RECIPIENT_ADDRESS!)
const mint = new PublicKey(process.env.USDC_DEVNET_MINT!)
const serverKeypair = Keypair.fromSecretKey(bs58Decode(process.env.TEST_SERVER_KEYPAIR!))
const store = Store.memory()

const sessionMethod = solana.session({
  recipient,
  mint,
  serverKeypair,
  network: 'devnet',
  store,
})

const app = new Hono()

app.all('/session', async (c) => {
  const mppx = Mppx.create({ methods: [sessionMethod] })
  const result = await mppx['solana/session']({
    amount: '0.10',
    depositAmount: '1.00',
    description: 'API session',
  })(c.req.raw)
  if (result.status === 402) return result.challenge
  return result.withReceipt(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
})

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('Session server on http://localhost:3001')
})
