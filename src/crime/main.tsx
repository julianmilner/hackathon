import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CrimeHeatmap from './CrimeHeatmap'
import { PasswordGate } from '../PasswordGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <CrimeHeatmap />
    </PasswordGate>
  </StrictMode>,
)
