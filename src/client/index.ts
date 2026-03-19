import { charge as charge_ } from './charge.js'
import { session as session_ } from './session.js'

export function solana(params: solana.Parameters): ReturnType<typeof charge_> {
  return charge_(params)
}

export namespace solana {
  export type Parameters = charge_.Parameters
  export const charge = charge_
  export const session = session_
}

export { Mppx } from 'mppx/client'
