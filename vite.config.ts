import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const host = new URL(process.env.QUMRA_APP_URL || 'http://localhost').hostname;
const port = Number(process.env.PORT || 3000);
let hmrConfig;

if (host === 'localhost') {
  hmrConfig = {
    protocol: 'ws',
    host: 'localhost',
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: 'wss',
    host: host,
    port: port,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: true,
    port,
    cors: {
      preflightContinue: true,
    },
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ['app', 'node_modules'],
    },
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});