import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/canvas/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      scope: '/canvas/',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'icons/app-192.png',
        'icons/app-512.png',
        'icons/app-maskable-512.png',
      ],
      manifest: {
        name: 'canvas',
        short_name: 'canvas',
        description: 'A local-first spatial canvas for notes, images, groups, and connections.',
        id: '/canvas/',
        start_url: '/canvas/',
        scope: '/canvas/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#14171b',
        background_color: '#14171b',
        icons: [
          { src: 'icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        globPatterns: ['**/*.{js,css,html,ico,png,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/canvas/index.html',
        navigateFallbackAllowlist: [/^\/canvas\/?/],
        navigateFallbackDenylist: [/^\/(?!canvas\/).*/],
      },
    }),
  ],
});
