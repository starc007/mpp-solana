/**
 * Charge server for the frontend-ui example.
 * Runs on port 3000. The Vite dev server (port 5173) proxies /api → :3000.
 *
 * Run: bun server.ts
 * Requires: TEST_RECIPIENT_ADDRESS, USDC_DEVNET_MINT
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { PublicKey } from '@solana/web3.js'
import { solana, Store, Mppx } from 'mpp-solana/server'

const recipient = new PublicKey(process.env.TEST_RECIPIENT_ADDRESS!)
const mint = new PublicKey(process.env.USDC_DEVNET_MINT!)
const store = Store.memory()

const chargeMethod = solana.charge({
  recipient,
  mint,
  network: 'devnet',
  store,
  verifyTimeout: 90_000,
})

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [chargeMethod],
})

const app = new Hono()

// Allow requests from the Vite dev server
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'WWW-Authenticate'],
  exposeHeaders: ['WWW-Authenticate', 'MPP-Receipt'],
}))

app.all('/pay', async (c) => {
  const result = await mppx['solana/charge']({
    amount: '0.10',
    description: 'API access via HTTP 402',
  })(c.req.raw)

  if (result.status === 402) return result.challenge

  return result.withReceipt(
    new Response(JSON.stringify({ ok: true, message: 'Payment verified.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
})

app.get('/health', (c) => c.json({ ok: true }))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Charge server → http://localhost:3000')
  console.log('Recipient:', recipient.toBase58())
  console.log('Mint:', mint.toBase58())
})
