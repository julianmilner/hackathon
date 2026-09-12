import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Sandbox } from './Sandbox'
import '../../tsunami/sandbox/sandbox.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sandbox />
  </StrictMode>,
)
