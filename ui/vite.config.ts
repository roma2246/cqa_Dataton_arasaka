import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — относительные пути, чтобы сборка открывалась и с FastAPI, и как web resource Dynamics 365.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    // В dev запросы к API идут на FastAPI — без CORS. Префикс сверить с backend/cqa/main.py.
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
