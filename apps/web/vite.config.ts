import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApiPlugin } from './src/mockApi.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), mockApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
