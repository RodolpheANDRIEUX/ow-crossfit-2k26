import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  external: ['fastify', '@fastify/*', 'pg', 'pg-native', 'zod', 'ws'],
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
  plugins: [
    {
      // @ow/shared est du TypeScript source a inclure dans le bundle. On le
      // resout directement vers son dossier plutot que via le lien de workspace
      // de node_modules : le build ne depend plus de la facon dont npm a cree
      // ce lien (junction Windows, image Docker, CI...).
      name: 'ow-shared',
      setup(b) {
        b.onResolve({ filter: /^@ow\/shared$/ }, () => ({ path: shared }));
      },
    },
  ],
});

mkdirSync('dist', { recursive: true });
copyFileSync('src/schema.sql', 'dist/schema.sql');
console.log('build ok -> dist/index.js');
