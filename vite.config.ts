import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {configDefaults} from 'vitest/config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      // TASK-0381: tests/ e do Playwright (specs test()/test.skip() da API
      // do @playwright/test, incompativel com o runner do Vitest) - sem
      // isso, `npx vitest run` tentava rodar os specs de E2E como se fossem
      // testes unitarios e quebrava com "test.skip() can only be called
      // inside test, describe block or fixture".
      exclude: [...configDefaults.exclude, 'tests/**'],
    },
  };
});
