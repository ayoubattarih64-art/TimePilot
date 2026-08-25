import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { ThemeProvider } from '../../theme'
import { SidePanel } from './SidePanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SidePanel />
    </ThemeProvider>
  </StrictMode>,
)
