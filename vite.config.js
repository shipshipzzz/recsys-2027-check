import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/recsys-2027-check/',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        soe: resolve(process.cwd(), 'soe.html'),
      },
    },
  },
});
