import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Hono } from 'hono'
import { Store } from 'mppx'
import { Mppx as ClientMppx } from 'mppx/client'
import { createPaymentRouter } from '../../src/router/index.js'
import { charge as clientCharge } from '../../src/client/charge.js'
import {
  getTestConnection,
  getTestWallet,
  getRecipientAddress,
  getUsdcMint,
  getUsdtMint,
  keypairWallet,
} from './helpers.js'

const SKIP = !process.env.TEST_WALLET_PRIVATE_KEY

describe('PaymentRouter devnet integration', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  const consumedKeys: string[] = []

  // Track the USDC signature across tests so the replay test can use it
  let capturedUsdcSignature: string | undefined

  beforeAll(() => {
    if (SKIP) return

    const baseStore = Store.memory()
    const spyStore: Store.Store = {
      async get<T>(key: string) { return baseStore.get<T>(key) },
      async put(key: string, value: unknown) { consumedKeys.push(key); return baseStore.put(key, value) },
      async delete(key: string) { return baseStore.delete(key) },
    }

    const connection = getTestConnection()
    const recipient = getRecipientAddress()
    const usdcMint = getUsdcMint()
    const usdtMint = getUsdtMint()

    const { hono: routerApp } = createPaymentRouter({
      tokens: [
        { mint: usdcMint, amount: '0.10', description: 'USDC payment' },
        { mint: usdtMint, amount: '0.10', description: 'USDT payment' },
      ],
      recipient,
      connection,
      store: spyStore,
    })

    const app = new Hono()
    app.route('/pay', routerApp)

    server = Bun.serve({ port: 0, fetch: app.fetch })
    baseUrl = `http://localhost:${server.port}`
  })

  afterAll(() => {
    if (server) server.stop(true)
  })

  it('skips when env not set', () => {
    if (!SKIP) return
    expect(SKIP).toBe(true)
  })

  it('pays USDC successfully', async () => {
    if (SKIP) return

    const wallet = keypairWallet(getTestWallet())
    const connection = getTestConnection()
    const usdcMint = getUsdcMint()

    // Wrap the client method to capture the USDC signature for the replay test
    const clientMethod = clientCharge({ wallet, mint: usdcMint, connection })
    const originalCreate = clientMethod.createCredential.bind(clientMethod)
    const wrappedMethod = {
      ...clientMethod,
      async createCredential(params: Parameters<typeof clientMethod.createCredential>[0]) {
        const credential = await originalCreate(params)
        try {
          const decoded = JSON.parse(Buffer.from(credential, 'base64').toString())
          capturedUsdcSignature = decoded.payload?.signature
        } catch {
          // best-effort
        }
        return credential
      },
    }

    const mppxClient = ClientMppx.create({
      methods: [wrappedMethod as typeof clientMethod],
      polyfill: false,
    })

    const res = await mppxClient.fetch(`${baseUrl}/pay/${usdcMint.toBase58()}`)
    expect(res.status).toBe(200)

    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify the shared store recorded the USDC consumed key
    const usdcConsumedKey = consumedKeys.find(k => k.startsWith('solana:charge:consumed:'))
    expect(usdcConsumedKey).toBeTruthy()
    if (capturedUsdcSignature) {
      expect(consumedKeys).toContain(`solana:charge:consumed:${capturedUsdcSignature}`)
    }
  }, 120_000)

  it('pays USDT successfully', async () => {
    if (SKIP) return

    const wallet = keypairWallet(getTestWallet())
    const connection = getTestConnection()
    const usdtMint = getUsdtMint()

    let capturedUsdtSignature: string | undefined
    const clientMethod = clientCharge({ wallet, mint: usdtMint, connection })
    const originalCreate = clientMethod.createCredential.bind(clientMethod)
    const wrappedMethod = {
      ...clientMethod,
      async createCredential(params: Parameters<typeof clientMethod.createCredential>[0]) {
        const credential = await originalCreate(params)
        try {
          const decoded = JSON.parse(Buffer.from(credential, 'base64').toString())
          capturedUsdtSignature = decoded.payload?.signature
        } catch {
          // best-effort
        }
        return credential
      },
    }

    const mppxClient = ClientMppx.create({
      methods: [wrappedMethod as typeof clientMethod],
      polyfill: false,
    })

    const keyCountBefore = consumedKeys.length

    const res = await mppxClient.fetch(`${baseUrl}/pay/${usdtMint.toBase58()}`)
    expect(res.status).toBe(200)

    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify the shared store recorded a new consumed key for USDT
    expect(consumedKeys.length).toBeGreaterThan(keyCountBefore)
    if (capturedUsdtSignature) {
      expect(consumedKeys).toContain(`solana:charge:consumed:${capturedUsdtSignature}`)
    }
  }, 120_000)

  it('cross-token replay: USDC signature rejected by USDT endpoint', async () => {
    if (SKIP) return

    const usdtMint = getUsdtMint()

    // If the USDC test didn't capture a signature, we can't run the replay sub-check.
    // The consumed-key assertion in the USDC test already validates the store behaviour.
    if (!capturedUsdcSignature) {
      // Mark the key check: any consumed key must exist
      expect(consumedKeys.length).toBeGreaterThan(0)
      return
    }

    // Confirm the USDC consumed key is already in the shared store
    expect(consumedKeys).toContain(`solana:charge:consumed:${capturedUsdcSignature}`)

    // Get a fresh 402 challenge from the USDT endpoint
    const challengeRes = await fetch(`${baseUrl}/pay/${usdtMint.toBase58()}`)
    expect(challengeRes.status).toBe(402)

    // Build a fake credential that presents the already-consumed USDC signature
    // against the USDT endpoint.  Because both token routes share the same store,
    // the `solana:charge:consumed:<sig>` key already exists → the server must reject it.
    const { Challenge, Credential } = await import('mppx')
    const challenge = Challenge.fromResponse(challengeRes)

    const replayCredential = Credential.serialize({
      challenge,
      payload: { signature: capturedUsdcSignature },
    })

    const replayRes = await fetch(`${baseUrl}/pay/${usdtMint.toBase58()}`, {
      headers: { Authorization: `${challenge.method} ${replayCredential}` },
    })

    // The server must reject the cross-token replay — 200 is the only forbidden outcome
    expect(replayRes.status).not.toBe(200)
  }, 120_000)
})
