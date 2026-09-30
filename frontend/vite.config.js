import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, las llamadas relativas a /api se reenvian al servidor Express.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
