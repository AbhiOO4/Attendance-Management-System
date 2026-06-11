import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import {Toaster} from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext.tsx'
import { ThemeProvider } from "next-themes"
import { registerSW } from 'virtual:pwa-register'

// Register Service Worker for PWA
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, r) {
    if (r) {
      // Check for service worker updates every 5 minutes
      setInterval(async () => {
        if (!(!r.installing && navigator)) return
        if ('connection' in navigator && !navigator.onLine) return

        try {
          const resp = await fetch(swUrl, {
            cache: 'no-store',
            headers: {
              'cache': 'no-store',
              'cache-control': 'no-cache',
            },
          })
          if (resp?.status === 200) {
            await r.update()
          }
        } catch (err) {
          console.error('Failed to check for service worker update:', err)
        }
      }, 5 * 60 * 1000) // 5 minutes
    }
  }
})



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
