export class SolanaPaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SolanaPaymentError'
  }
}

export class InsufficientBalanceError extends SolanaPaymentError {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint,
  ) {
    super(`Insufficient balance: required ${required}, available ${available}`)
    this.name = 'InsufficientBalanceError'
  }
}

export class TransactionExpiredError extends SolanaPaymentError {
  constructor(public readonly signature: string) {
    super(`Transaction expired: ${signature}`)
    this.name = 'TransactionExpiredError'
  }
}

export class ReplayError extends SolanaPaymentError {
  constructor(public readonly signature: string) {
    super(`Transaction already consumed: ${signature}`)
    this.name = 'ReplayError'
  }
}

export class SessionError extends SolanaPaymentError {
  constructor(
    message: string,
    public readonly sessionId: string,
  ) {
    super(message)
    this.name = 'SessionError'
  }
}

export class RpcError extends SolanaPaymentError {
  constructor(
    message: string,
    public readonly endpoints: string[],
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

export class VerificationError extends SolanaPaymentError {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationError'
  }
}
