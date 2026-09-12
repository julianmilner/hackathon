import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The 3D city.
        main: 'index.html',
        // Standalone 2D crime heatmap, also reachable at /crime.html in dev.
        crime: 'crime.html',
        // Standalone Koeberg power station model, also reachable at /koeberg.html in dev.
        koeberg: 'koeberg.html',
      },
    },
  },
})
