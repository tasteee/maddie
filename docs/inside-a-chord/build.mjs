import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: node docs/inside-a-chord/build.mjs path/to/inside-a-chord.html');
  process.exit(1);
}

const root = fileURLToPath(new URL('.', import.meta.url));
const result = await build({
  root,
  base: './',
  configFile: false,
  build: {
    write: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 20_000,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

const html = result.output.find((entry) => entry.fileName === 'index.html');
const css = result.output.find((entry) => entry.fileName.endsWith('.css'));
const script = result.output.find((entry) => entry.type === 'chunk' && entry.isEntry);
if (!html || !css || !script) throw new Error('Expected an HTML document, stylesheet, and entry bundle.');

const standalone = String(html.source)
  .replace(/<link rel="stylesheet"[^>]+>/, () => '<style>\n' + css.source + '\n</style>')
  .replace(/<script type="module"[^>]+><\/script>/, () =>
    '<script type="module">\n' + script.code.replace(/<\/script/gi, '<\\/script') + '\n</script>');
await writeFile(resolve(destination), standalone);
console.log('Wrote ' + resolve(destination));
