import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Layer our hand-written push / notificationclick handlers onto the
        // auto-generated Workbox SW (see public/push-sw.js). The generated sw.js
        // runs importScripts('push-sw.js') at startup, so the listeners register
        // in the SW scope without us owning the whole service worker.
        importScripts: ['push-sw.js'],
        // Take over immediately on a new deploy instead of waiting for every
        // tab/PWA instance to close, and delete the previous build's precache.
        // This is what makes mobile clients pick up updates without a manual
        // close/reopen.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          // NO rule for the API, deliberately. Rosters, locks and attendance are live shared
          // state — a cached copy (e.g. NetworkFirst falling back after a slow network) would
          // show a stale roster or "not yet submitted" and let a supervisor save over it. The
          // old `/^\/api\/.*$/` NetworkFirst rule never actually matched (Workbox tests the
          // full URL and the API is cross-origin) and was removed so nobody "fixes" it.
        ],
      },
      manifest: {
        name: 'NGDP Attendance Management System',
        short_name: 'NGDP AMS',
        description: 'Attendance Management System',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/ngdp logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/appLogo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  }
})
