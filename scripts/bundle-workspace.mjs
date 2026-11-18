import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(extension, '../..');
await build({
    entryPoints: [resolve(extension, 'webview/workspace.tsx')],
    outfile: resolve(extension, 'media/workspace.js'),
    bundle: true, minify: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
        '@/lib/auth': resolve(extension, 'webview/auth.ts'),
        '@/lib/endpoints': resolve(extension, 'webview/endpoints.ts'),
        'next/link': resolve(extension, 'webview/link.tsx'),
        '@': resolve(root, 'src'),
    },
});
const cssPath = resolve(extension, 'webview/styles.css');
const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath, to: resolve(extension, 'media/workspace.css') });
writeFileSync(resolve(extension, 'media/workspace.css'), result.css);
console.log('[bundle-workspace] bundled the actual website Fleet page and TopologyMap');
