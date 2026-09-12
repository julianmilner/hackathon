import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { KoebergApp } from './KoebergApp'
import { PasswordGate } from '../PasswordGate'
import './koeberg.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <KoebergApp />
    </PasswordGate>
  </StrictMode>,
)
