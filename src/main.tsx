import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PasswordGate } from './PasswordGate'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <App />
    </PasswordGate>
  </StrictMode>,
)
