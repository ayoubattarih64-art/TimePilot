import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { ThemeProvider } from '../../theme'
import { Popup } from './Popup'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  </StrictMode>,
)
