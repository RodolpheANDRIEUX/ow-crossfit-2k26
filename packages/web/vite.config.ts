import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  resolve: {
    alias: {
      // Le coeur metier est partage tel quel avec le serveur : meme calcul de
      // score des deux cotes, donc aucun ecart possible.
      '@ow/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-64.png', 'logo-256.png'],
      manifest: {
        name: 'OW — Compteur',
        short_name: 'OW',
        description: 'Comptage des répétitions et chronométrage des épreuves par équipes',
        theme_color: '#111214',
        background_color: '#111214',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Le logo source (1,5 Mo) n'est pas embarque hors-ligne : l'app n'en
        // utilise que les versions reduites.
        globIgnores: ['**/logo.png'],
        // L'application doit demarrer sans reseau : la coquille est precachee,
        // et l'API n'est jamais mise en cache (les scores doivent etre frais).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        // Seule exception : les images des epreuves. Immuables (nouvelle image =
        // nouvel identifiant), elles restent disponibles pour le compteur hors-ligne.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ow-images',
              expiration: { maxEntries: 300 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
