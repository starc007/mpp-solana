/**
 * Minimal example: single-token USDC charge server using mppx-solana.
 *
 * Run: bun examples/charge-basic/server.ts
 * Requires: SOLANA_RPC_URL, TEST_RECIPIENT_ADDRESS, USDC_DEVNET_MINT
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { PublicKey } from '@solana/web3.js'
import { solana, Store, Mppx } from 'mppx-solana/server'

const recipient = new PublicKey(process.env.TEST_RECIPIENT_ADDRESS!)
const mint = new PublicKey(process.env.USDC_DEVNET_MINT!)
const store = Store.memory()

const chargeMethod = solana.charge({
  recipient,
  mint,
  network: 'devnet',
  store,
})

const app = new Hono()

app.all('/pay', async (c) => {
  const mppx = Mppx.create({ methods: [chargeMethod] })
  const result = await mppx['solana/charge']({ amount: '0.10', description: 'API access' })(c.req.raw)
  if (result.status === 402) return result.challenge
  return result.withReceipt(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
})

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Server running on http://localhost:3000')
})
