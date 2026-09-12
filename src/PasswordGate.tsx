import { useState, type FormEvent, type ReactNode } from 'react'

const PASSWORD = import.meta.env.VITE_DEMO_PASSWORD as string | undefined
const STORAGE_KEY = 'hackathon-demo-unlocked'

// Client-side only: the bundle ships the password, so this deters casual
// visitors to the hosted URL, not a determined attacker reading the JS.
export function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => !PASSWORD || sessionStorage.getItem(STORAGE_KEY) === '1',
  )
  const [attempt, setAttempt] = useState('')
  const [error, setError] = useState(false)

  if (unlocked) return <>{children}</>

  function submit(e: FormEvent) {
    e.preventDefault()
    if (attempt === PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, '1')
      setUnlocked(true)
    } else {
      setError(true)
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100vh',
        background: '#0b0b0c',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, width: 280 }}>
        <label htmlFor="demo-password">Enter password to view demo</label>
        <input
          id="demo-password"
          type="password"
          autoFocus
          value={attempt}
          onChange={(e) => {
            setAttempt(e.target.value)
            setError(false)
          }}
          style={{ padding: 8, fontSize: 16 }}
        />
        {error && <span style={{ color: '#f66' }}>Wrong password.</span>}
        <button type="submit" style={{ padding: 8, fontSize: 16 }}>
          Enter
        </button>
      </form>
    </div>
  )
}
