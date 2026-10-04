import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.HTTPS === 'true' ? [basicSsl()] : [])
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'rug-pencil-sturdily.ngrok-free.dev',
      '.ngrok-free.dev',   // wildcard — covers future ngrok URLs too, since free-tier URLs change every restart
      '.ngrok-free.app',   // ngrok has used both suffixes at different times — safe to include both
    ]
  }
})
