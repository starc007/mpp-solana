import { useState, useCallback, useEffect, useRef } from 'react'
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import { solana, Mppx } from 'mppx-solana/client'

// ─── Types ──────────────────────────────────────────────────────────────────

type PaymentStatus =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'requesting' }
  | { phase: 'signing' }
  | { phase: 'confirming'; sig: string }
  | { phase: 'success'; sig: string; receipt: string }
  | { phase: 'error'; message: string }

interface PhantomProvider {
  publicKey: PublicKey | null
  isConnected: boolean
  connect(): Promise<{ publicKey: PublicKey }>
  disconnect(): Promise<void>
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>
}

declare global {
  interface Window {
    solana?: PhantomProvider
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const API_URL = '/api/pay'
const AMOUNT = '0.10'
const MINT_ADDRESS = import.meta.env.VITE_USDC_MINT ?? ''

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortKey(key: string) {
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null
  return window.solana ?? null
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Cursor() {
  return <span style={{ animation: 'blink 1s step-end infinite', color: 'var(--accent)' }}>_</span>
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: '2px solid var(--border-bright)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        flexShrink: 0,
      }}
    />
  )
}

function LogLine({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        opacity: dim ? 0.4 : 1,
        fontSize: 11,
        lineHeight: '18px',
        animation: 'slide-in-right 0.2s ease',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
      <span style={{ color: dim ? 'var(--text-secondary)' : 'var(--text)' }}>{children}</span>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export function App() {
  const [wallet, setWallet] = useState<PhantomProvider | null>(null)
  const [status, setStatus] = useState<PaymentStatus>({ phase: 'idle' })
  const [logs, setLogs] = useState<string[]>([])
  const [txCount, setTxCount] = useState(0)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-50), msg])
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Auto-detect connected wallet on mount
  useEffect(() => {
    const phantom = getPhantom()
    if (phantom?.isConnected && phantom.publicKey) {
      setWallet(phantom)
      log(`wallet detected: ${shortKey(phantom.publicKey.toBase58())}`)
    }
  }, [log])

  const connectWallet = useCallback(async () => {
    const phantom = getPhantom()
    if (!phantom) {
      setStatus({ phase: 'error', message: 'Phantom wallet not found. Install it at phantom.app' })
      return
    }
    setStatus({ phase: 'connecting' })
    log('connecting to phantom...')
    try {
      const { publicKey } = await phantom.connect()
      setWallet(phantom)
      log(`connected: ${shortKey(publicKey.toBase58())}`)
      setStatus({ phase: 'idle' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection rejected'
      setStatus({ phase: 'error', message: msg })
      log(`error: ${msg}`)
    }
  }, [log])

  const disconnectWallet = useCallback(async () => {
    const phantom = getPhantom()
    await phantom?.disconnect()
    setWallet(null)
    setStatus({ phase: 'idle' })
    log('wallet disconnected')
  }, [log])

  const pay = useCallback(async () => {
    if (!wallet?.publicKey) return

    setStatus({ phase: 'requesting' })
    log('initiating payment request...')
    log(`endpoint: POST ${API_URL}`)
    log(`amount: ${AMOUNT} USDC`)

    let capturedSig = ''

    try {
      const walletLike = {
        publicKey: wallet.publicKey,
        async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
          log('signing transaction in wallet...')
          setStatus({ phase: 'signing' })
          const signed = await wallet.signTransaction(tx)
          return signed
        },
      }

      const chargeClient = solana.charge({
        wallet: walletLike,
        mint: MINT_ADDRESS ? new PublicKey(MINT_ADDRESS) : undefined,
        network: 'devnet',
      })

      // Wrap createCredential to capture the signature
      const originalMethod = chargeClient
      const wrappedClient = {
        ...originalMethod,
        createCredential: async (ctx: Parameters<typeof originalMethod.createCredential>[0]) => {
          const cred = await originalMethod.createCredential(ctx)
          // Extract signature from credential (base64 JSON payload)
          try {
            const decoded = JSON.parse(atob(cred.split('.')[1] ?? ''))
            if (decoded?.payload?.signature) capturedSig = decoded.payload.signature
          } catch { /* ignore parse errors */ }
          return cred
        },
      }

      const mppxClient = Mppx.create({ methods: [wrappedClient] })

      log('sending 402-protected request...')
      setStatus({ phase: 'requesting' })

      const response = await mppxClient.fetch(API_URL)

      if (capturedSig) {
        setStatus({ phase: 'confirming', sig: capturedSig })
        log(`tx submitted: ${shortKey(capturedSig)}`)
        log('waiting for confirmation...')
      }

      if (!response.ok) {
        throw new Error(`Payment failed: HTTP ${response.status}`)
      }

      const receiptHeader = response.headers.get('MPP-Receipt') ?? '{}'
      setTxCount(n => n + 1)
      setStatus({ phase: 'success', sig: capturedSig, receipt: receiptHeader })
      log(`confirmed ✓`)
      log(`receipt: ${receiptHeader.slice(0, 80)}...`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus({ phase: 'error', message: msg })
      log(`error: ${msg}`)
    }
  }, [wallet, log])

  const reset = useCallback(() => {
    setStatus({ phase: 'idle' })
  }, [])

  // ── Derived state ──
  const isConnected = !!wallet?.publicKey
  const isLoading = ['connecting', 'requesting', 'signing', 'confirming'].includes(status.phase)
  const pubkeyStr = wallet?.publicKey?.toBase58() ?? ''

  // ── Phase label ──
  const phaseLabel: Record<string, string> = {
    idle: 'READY',
    connecting: 'CONNECTING',
    requesting: 'REQUESTING',
    signing: 'AWAITING SIGNATURE',
    confirming: 'CONFIRMING',
    success: 'CONFIRMED',
    error: 'ERROR',
  }

  const phaseColor: Record<string, string> = {
    idle: 'var(--text-secondary)',
    connecting: 'var(--warning)',
    requesting: 'var(--accent)',
    signing: 'var(--accent)',
    confirming: 'var(--accent)',
    success: 'var(--success)',
    error: 'var(--error)',
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px',
      gap: 0,
    }}>

      {/* ── Top Bar ── */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 24,
        borderBottom: '1px solid var(--border)',
        marginBottom: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--accent)',
            textTransform: 'uppercase',
          }}>MPPX</span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 300,
            letterSpacing: '0.15em',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
          }}>Solana</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
          <StatusDot color={isConnected ? 'var(--success)' : 'var(--text-muted)'} />
          <span>{isConnected ? `${shortKey(pubkeyStr)}` : 'NO WALLET'}</span>
          {isConnected && (
            <button
              onClick={disconnectWallet}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                padding: '2px 6px',
                borderRadius: 2,
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--error)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = 'var(--text-muted)' }}
            >
              [disconnect]
            </button>
          )}
        </div>
      </header>

      {/* ── Main layout ── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 380px',
        gap: 24,
        maxWidth: 1080,
        margin: '0 auto',
        width: '100%',
      }}>

        {/* ── Left: Payment Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Amount card */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            padding: 40,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Accent corner */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 3,
              height: '100%',
              background: 'var(--accent)',
              opacity: isLoading ? 1 : 0.3,
              transition: 'opacity 0.3s',
            }} />

            <div style={{ marginBottom: 8, fontSize: 10, letterSpacing: '0.25em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              PAYMENT AMOUNT
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(48px, 8vw, 80px)',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color: 'var(--accent)',
              marginBottom: 12,
            }}>
              ${AMOUNT}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.1em' }}>
              USDC · DEVNET · HTTP 402
            </div>

            {/* Progress bar — only during loading */}
            {isLoading && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                height: 2,
                background: 'var(--accent)',
                animation: 'progress-fill 90s linear forwards',
                opacity: 0.6,
              }} />
            )}
          </div>

          {/* Status card */}
          <div style={{
            background: 'var(--surface)',
            border: `1px solid ${status.phase === 'success' ? 'rgba(0,232,122,0.2)' : status.phase === 'error' ? 'rgba(255,59,59,0.2)' : 'var(--border)'}`,
            padding: 28,
            transition: 'border-color 0.3s',
          }}>
            <div style={{ marginBottom: 20, fontSize: 10, letterSpacing: '0.25em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              STATUS
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              {isLoading ? <Spinner /> : <StatusDot color={phaseColor[status.phase] ?? 'var(--text-secondary)'} />}
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: phaseColor[status.phase] ?? 'var(--text)',
              }}>
                {phaseLabel[status.phase] ?? status.phase.toUpperCase()}
              </span>
              {isLoading && <Cursor />}
            </div>

            {/* Phase details */}
            {status.phase === 'confirming' && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', animation: 'slide-up 0.2s ease' }}>
                <span>SIG: </span>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{shortKey(status.sig)}</span>
              </div>
            )}

            {status.phase === 'success' && (
              <div style={{ animation: 'slide-up 0.3s ease', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  background: 'var(--success-dim)',
                  border: '1px solid rgba(0,232,122,0.15)',
                  padding: '10px 14px',
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  <div style={{ color: 'var(--success)', letterSpacing: '0.1em', fontSize: 10 }}>TRANSACTION CONFIRMED</div>
                  {status.sig && (
                    <div style={{ color: 'var(--text-secondary)' }}>
                      <span>SIG: </span>
                      <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{status.sig.slice(0, 32)}...</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 24,
                    fontWeight: 900,
                    color: 'var(--success)',
                  }}>TXN #{txCount.toString().padStart(4, '0')}</div>
                </div>
              </div>
            )}

            {status.phase === 'error' && (
              <div style={{
                background: 'var(--error-dim)',
                border: '1px solid rgba(255,59,59,0.15)',
                padding: '10px 14px',
                fontSize: 11,
                color: 'var(--error)',
                animation: 'slide-up 0.2s ease',
              }}>
                {status.message}
              </div>
            )}
          </div>

          {/* Action button */}
          <div>
            {!isConnected ? (
              <button
                onClick={connectWallet}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '18px 24px',
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.25em',
                  textTransform: 'uppercase',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  if (!isLoading) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--accent-dim)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 24px rgba(200,255,0,0.1)'
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                }}
              >
                {isLoading ? <Spinner /> : 'CONNECT WALLET'}
              </button>
            ) : status.phase === 'success' || status.phase === 'error' ? (
              <button
                onClick={reset}
                style={{
                  width: '100%',
                  padding: '18px 24px',
                  background: 'transparent',
                  border: '1px solid var(--border-bright)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.25em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-secondary)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-bright)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
                }}
              >
                NEW TRANSACTION
              </button>
            ) : (
              <button
                onClick={pay}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '18px 24px',
                  background: isLoading ? 'var(--accent-dim)' : 'var(--accent)',
                  border: '1px solid var(--accent)',
                  color: isLoading ? 'var(--accent)' : 'var(--bg)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: '0.25em',
                  textTransform: 'uppercase',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  animation: !isLoading ? 'glow-pulse 3s ease infinite' : 'none',
                }}
                onMouseEnter={e => {
                  if (!isLoading) {
                    (e.currentTarget as HTMLElement).style.background = '#d4ff00'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(200,255,0,0.25)'
                  }
                }}
                onMouseLeave={e => {
                  if (!isLoading) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }
                }}
              >
                {isLoading ? <><Spinner /> PROCESSING</> : 'PAY NOW'}
              </button>
            )}
          </div>
        </div>

        {/* ── Right: Terminal Log ── */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          height: 'fit-content',
          position: 'sticky',
          top: 24,
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--error)', opacity: 0.7 }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', opacity: 0.7 }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', opacity: 0.7 }} />
            <span style={{ marginLeft: 8, fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              TERMINAL
            </span>
          </div>

          <div style={{
            padding: 16,
            minHeight: 320,
            maxHeight: 480,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <LogLine dim>system initialized</LogLine>
            <LogLine dim>protocol: mppx-solana v0.1.0</LogLine>
            <LogLine dim>network: devnet</LogLine>
            <LogLine dim>---</LogLine>
            {logs.map((line, i) => (
              <LogLine key={i}>{line}</LogLine>
            ))}
            {isLoading && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--accent)' }}>
                <span>›</span>
                <Cursor />
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* ── Bottom info bar ── */}
      <footer style={{
        marginTop: 40,
        paddingTop: 20,
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 10,
        color: 'var(--text-muted)',
        letterSpacing: '0.1em',
      }}>
        <span>HTTP 402 · MACHINE PAYMENT PROTOCOL</span>
        <span>SPL TOKEN TRANSFER · SOLANA DEVNET</span>
        <span>TXN: {txCount.toString().padStart(4, '0')}</span>
      </footer>
    </div>
  )
}
