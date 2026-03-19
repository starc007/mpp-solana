import { describe, it, expect } from 'bun:test'
import {
  SolanaPaymentError,
  InsufficientBalanceError,
  TransactionExpiredError,
  ReplayError,
  SessionError,
  RpcError,
  VerificationError,
} from '../../src/core/errors'

describe('SolanaPaymentError', () => {
  it('is an instance of Error', () => {
    const err = new SolanaPaymentError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('test')
    expect(err.name).toBe('SolanaPaymentError')
  })
})

describe('InsufficientBalanceError', () => {
  it('extends SolanaPaymentError', () => {
    const err = new InsufficientBalanceError(BigInt(100), BigInt(50))
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('InsufficientBalanceError')
    expect(err.required).toBe(BigInt(100))
    expect(err.available).toBe(BigInt(50))
    expect(err.message).toContain('100')
    expect(err.message).toContain('50')
  })
})

describe('TransactionExpiredError', () => {
  it('extends SolanaPaymentError and stores signature', () => {
    const err = new TransactionExpiredError('abc123')
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err.name).toBe('TransactionExpiredError')
    expect(err.signature).toBe('abc123')
    expect(err.message).toContain('abc123')
  })
})

describe('ReplayError', () => {
  it('extends SolanaPaymentError and stores signature', () => {
    const err = new ReplayError('sig456')
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err.name).toBe('ReplayError')
    expect(err.signature).toBe('sig456')
  })
})

describe('SessionError', () => {
  it('extends SolanaPaymentError and stores sessionId', () => {
    const err = new SessionError('session closed', 'sess-001')
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err.name).toBe('SessionError')
    expect(err.sessionId).toBe('sess-001')
    expect(err.message).toBe('session closed')
  })
})

describe('RpcError', () => {
  it('extends SolanaPaymentError and stores endpoints', () => {
    const endpoints = ['https://a.example.com', 'https://b.example.com']
    const err = new RpcError('all failed', endpoints)
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err.name).toBe('RpcError')
    expect(err.endpoints).toEqual(endpoints)
  })
})

describe('VerificationError', () => {
  it('extends SolanaPaymentError', () => {
    const err = new VerificationError('bad transfer')
    expect(err).toBeInstanceOf(SolanaPaymentError)
    expect(err.name).toBe('VerificationError')
    expect(err.message).toBe('bad transfer')
  })
})
