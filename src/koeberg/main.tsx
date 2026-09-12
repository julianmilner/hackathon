import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { KoebergApp } from './KoebergApp'
import './koeberg.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KoebergApp />
  </StrictMode>,
)
