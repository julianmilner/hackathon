import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CrimeHeatmap from './CrimeHeatmap'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrimeHeatmap />
  </StrictMode>,
)
