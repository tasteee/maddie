import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `vite` (dev) serves the playground. `vite build` builds the library.
export default defineConfig(({ command }) =>
  command === 'serve'
    ? { root: 'playground' }
    : {
        build: {
          lib: {
            entry: {
              index: resolve(__dirname, 'src/index.ts'),
              core: resolve(__dirname, 'src/core/index.ts'),
              elements: resolve(__dirname, 'src/elements/index.ts'),
            },
            formats: ['es'],
          },
          rollupOptions: { external: [/^lit/] },
          sourcemap: true,
        },
      },
);
