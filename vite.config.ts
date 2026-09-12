import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // standalone simulation sandboxes, see src/simulations/README.md
        tsunami: 'tsunami.html',
      },
    },
  },
})
