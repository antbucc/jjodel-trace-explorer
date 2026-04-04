import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    host: true
  },

  preview: {
    host: true,
    allowedHosts: [
      "jjodel-trace-explorer-production.up.railway.app"
    ]
  }
})