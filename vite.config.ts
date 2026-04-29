import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.VITE_API_KEY ?? env.API_KEY ?? '';
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
    server: {
      proxy: {
        '/v1': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
