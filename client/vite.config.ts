import { defineConfig, createLogger, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import * as esbuild from 'esbuild'

const logger = createLogger();
const originalError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (
    typeof msg === 'string' &&
    (msg.includes('ws proxy error:') || msg.includes('ws proxy socket error:')) &&
    (msg.includes('EPIPE') || msg.includes('ECONNRESET'))
  ) {
    return;
  }
  originalError(msg, options);
};

const INLINE_MAPLIBRE_WORKER_ID = '\0inline-maplibre-worker-url'

/**
 * Vite's `?worker&url` still serves the MapLibre worker over HTTP in dev.
 * Chrome DevTools Offline blocks that fetch, so MapLibre never starts its
 * worker and never requests vector tiles. Bundle the worker into a blob URL
 * that lives in the already-loaded JS module.
 */
function inlineMaplibreWorker(): Plugin {
  let moduleCode: string | null = null
  return {
    name: 'inline-maplibre-worker',
    enforce: 'pre',
    resolveId(source) {
      if (source.includes('maplibre-gl-worker.mjs') && source.includes('?worker')) {
        return INLINE_MAPLIBRE_WORKER_ID
      }
    },
    async load(id) {
      if (id !== INLINE_MAPLIBRE_WORKER_ID) return
      if (!moduleCode) {
        const entry = path.resolve(__dirname, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
        const result = await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: 'esm',
          platform: 'browser',
          target: 'es2020',
          logLevel: 'silent',
        })
        moduleCode = `const blob = new Blob([${JSON.stringify(result.outputFiles[0].text)}], { type: 'text/javascript;charset=utf-8' });
const blobURL = URL.createObjectURL(blob);
export default blobURL;`
      }
      return moduleCode
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  customLogger: logger,
  define: {
    'import.meta.env.VITE_APP_BUILD_TIME': JSON.stringify(
      process.env.VITE_APP_BUILD_TIME || new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    ),
  },
  plugins: [
    inlineMaplibreWorker(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'OurMaps',
        short_name: 'OurMaps',
        description: 'Create and share custom map pins',
        theme_color: '#483D8B',
        background_color: '#f8f9fa',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg}',
          '**/sprites/*.json',
          '**/fonts/**/0-255.pbf',
          '**/fonts/**/256-511.pbf',
        ],
        navigateFallbackDenylist: [/^\/maps/],
        runtimeCaching: [
          {
            // A cached GET /api/maps/:id must not count as "online" — it
            // previously left a refreshed offline map in edit/Synced mode.
            urlPattern: /\/api\/maps\/[0-9a-f-]{36}(?:\?.*)?$/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              networkTimeoutSeconds: 1.5,
            },
          },
          {
            urlPattern: /^https:\/\/protomaps\.github\.io\/basemaps-assets\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'protomaps-assets-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'elevation-tiles-cache',
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\/maps\/fonts\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 1200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\/maps\/sprites\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sprites-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          }
        ]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl') || id.includes('node_modules/react-map-gl') || id.includes('node_modules/@vis.gl')) {
            return 'maplibre';
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'vendor';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      },
      '/maps': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        // Sprites and fonts are in client/public/maps. Proxying them to the
        // API server makes the map style hang when that server is unreachable.
        bypass(req) {
          const url = req.url || '';
          if (url.startsWith('/maps/sprites/') || url.startsWith('/maps/fonts/')) {
            return url.split('?')[0];
          }
        },
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3002',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') return;
            console.warn('[socket.io proxy error]', err);
          });
        },
      },
    },
    watch: {
      ignored: ['**/server/database.sqlite'],
    },
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
})
