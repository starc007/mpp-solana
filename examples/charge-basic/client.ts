/**
 * Minimal example: USDC charge client.
 *
 * Run: bun examples/charge-basic/client.ts
 * Requires: TEST_WALLET_PRIVATE_KEY, USDC_DEVNET_MINT (devnet)
 */
import { Keypair, Connection, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import { decode as bs58Decode } from 'bs58'
import { solana, Mppx } from 'mpp-solana/client'

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

const chargeClient = solana.charge({
  wallet,
  network: 'devnet',
})

const mppxClient = Mppx.create({ methods: [chargeClient] })

const response = await mppxClient.fetch('http://localhost:3000/pay')
console.log('Status:', response.status)
console.log('Receipt:', response.headers.get('MPP-Receipt'))
const body = await response.json()
console.log('Body:', body)
