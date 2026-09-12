import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run build:pages` (mode 'pages') serves from https://<user>.github.io/hackathon/,
// everything else stays at '/'. Asset URLs in code go through import.meta.env.BASE_URL.
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/hackathon/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The 3D city.
        main: 'index.html',
        // The one-minute 'what if Koeberg blew up' show, also reachable at /demo.html in dev.
        demo: 'demo.html',
        // Standalone 2D crime heatmap, also reachable at /crime.html in dev.
        crime: 'crime.html',
        // Standalone Koeberg power station model, also reachable at /koeberg.html in dev.
        koeberg: 'koeberg.html',
        // standalone simulation sandboxes, see src/simulations/README.md
        tsunami: 'tsunami.html',
        kaiju: 'kaiju.html',
        fire: 'fire.html',
      },
    },
  },
}))
