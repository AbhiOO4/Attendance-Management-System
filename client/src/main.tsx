import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import {Toaster} from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext.tsx'
import { ThemeProvider } from "next-themes"


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
        >
          <App />
        </ThemeProvider>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
