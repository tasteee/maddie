import { defineConfig } from 'vite';

// `pnpm serve` runs the dev server in "serve" mode: no hot reload and no automatic
// page reloads. Code changes show up only when you refresh the browser yourself.
export default defineConfig(({ mode }) => {
  const isManualRefresh = mode === 'serve';
  return {
    base: './',
    server: isManualRefresh ? { hmr: false } : {},
  };
});
