import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ports offset from both source repos (whiteboard 5173, sat-homework 5273) so
// all three can run side by side during the port (PLAN.md §4.2).
const SERVER = 'http://localhost:6060'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5373,
    proxy: {
      '/api': { target: SERVER },
    },
    // packages/shared and packages/ui are consumed as TS+CSS source, not a build.
    fs: { allow: ['..'] },
  },
})
