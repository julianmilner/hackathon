import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Sandbox } from './Sandbox'
import './sandbox.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sandbox />
  </StrictMode>,
)
