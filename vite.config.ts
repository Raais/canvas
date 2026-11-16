import { cpSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, type Plugin } from 'vite';

const PDFJS_ROOT = join(process.cwd(), 'node_modules/pdfjs-dist');
const PDF_WASM = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'];

function pdfjsAssets(): Plugin {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/canvas/pdfjs', (request, response, next) => {
        const url = (request.url ?? '').split('?')[0] ?? '';
        const parts = url.split('/').filter(Boolean);
        const kind = parts[0];
        const file = parts.slice(1).join('/');
        if ((kind !== 'cmaps' && kind !== 'standard_fonts' && kind !== 'wasm') || !file || file.includes('..')) {
          next();
          return;
        }
        if (kind === 'wasm' && !PDF_WASM.includes(file)) {
          next();
          return;
        }
        const disk = join(PDFJS_ROOT, kind, file);
        if (!existsSync(disk)) {
          next();
          return;
        }
        if (file.endsWith('.wasm')) response.setHeader('Content-Type', 'application/wasm');
        else if (file.endsWith('.pfb') || file.endsWith('.ttf')) response.setHeader('Content-Type', 'font/sfnt');
        else response.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(disk).pipe(response);
      });
    },
    closeBundle() {
      mkdirSync(join(process.cwd(), 'dist/pdfjs/wasm'), { recursive: true });
      cpSync(join(PDFJS_ROOT, 'cmaps'), join(process.cwd(), 'dist/pdfjs/cmaps'), { recursive: true });
      cpSync(join(PDFJS_ROOT, 'standard_fonts'), join(process.cwd(), 'dist/pdfjs/standard_fonts'), { recursive: true });
      for (const name of PDF_WASM) {
        cpSync(join(PDFJS_ROOT, 'wasm', name), join(process.cwd(), 'dist/pdfjs/wasm', name));
      }
    },
  };
}

export default defineConfig({
  base: '/canvas/',
  plugins: [
    pdfjsAssets(),
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
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,woff2,webmanifest,mjs,bcmap,pfb,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/canvas/index.html',
        navigateFallbackAllowlist: [/^\/canvas\/?/],
        navigateFallbackDenylist: [/^\/(?!canvas\/).*/],
      },
    }),
  ],
});
