import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backend = new URL(env.VITE_SUPABASE_URL || 'https://npqrixancnwbmzcyqafx.supabase.co');
  if (
    !['https:', 'http:'].includes(backend.protocol) ||
    (command === 'build' && backend.protocol !== 'https:')
  )
    throw new Error('Production Supabase URL must use HTTPS');
  const realtime = new URL(backend.origin);
  realtime.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
  const connect = ["'self'", backend.origin, realtime.origin];
  if (command === 'serve') connect.push('ws://127.0.0.1:*', 'ws://localhost:*');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    'connect-src ' + connect.join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  return {
    base: '/recsys-2027-check/',
    plugins: [
      {
        name: 'security-policy',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    ],
    server: { host: '127.0.0.1', strictPort: true, cors: false },
    preview: { host: '127.0.0.1', strictPort: true, cors: false },
    build: {
      target: 'es2022',
      manifest: true,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          soe: resolve(process.cwd(), 'soe.html'),
        },
      },
    },
  };
});
