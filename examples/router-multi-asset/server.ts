/**
 * Multi-asset router: accepts USDC and USDT payments.
 *
 * Run: bun examples/router-multi-asset/server.ts
 * Requires: TEST_RECIPIENT_ADDRESS, USDC_DEVNET_MINT, USDT_DEVNET_MINT
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { PublicKey } from '@solana/web3.js'
import { Store } from 'mppx'
import { createPaymentRouter } from 'mppx-solana/router'

const recipient = new PublicKey(process.env.TEST_RECIPIENT_ADDRESS!)
const usdcMint = new PublicKey(process.env.USDC_DEVNET_MINT!)
const usdtMint = new PublicKey(process.env.USDT_DEVNET_MINT!)
const store = Store.memory()

const { hono: payRouter } = createPaymentRouter({
  tokens: [
    { mint: usdcMint, amount: '0.10', description: 'USDC payment' },
    { mint: usdtMint, amount: '0.10', description: 'USDT payment' },
  ],
  recipient,
  network: 'devnet',
  store,
})

const app = new Hono()
app.route('/pay', payRouter)

serve({ fetch: app.fetch, port: 3002 }, () => {
  console.log('Multi-asset router on http://localhost:3002')
  console.log('Routes:')
  console.log(`  POST /pay/${usdcMint.toBase58()} — USDC`)
  console.log(`  POST /pay/${usdtMint.toBase58()} — USDT`)
})
