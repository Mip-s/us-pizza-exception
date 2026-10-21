import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built under /exception so it works inside the Operations hub (which forwards /exception/* here)
export default defineConfig({
  base: '/exception/',
  plugins: [react()],
  publicDir: 'static',
  server: { proxy: { '/exception/api': 'http://127.0.0.1:8787' } },
});
