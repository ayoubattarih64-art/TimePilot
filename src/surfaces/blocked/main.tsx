import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { ThemeProvider } from '../../theme'
import { BlockedPage } from './BlockedPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BlockedPage />
    </ThemeProvider>
  </StrictMode>,
)
