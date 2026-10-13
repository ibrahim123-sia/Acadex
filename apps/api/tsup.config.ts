import { defineConfig } from 'tsup';

// Production bundle: the workspace package @acadex/shared is TypeScript source, so it is
// bundled in; npm dependencies stay external and are installed normally.
export default defineConfig({
  entry: { server: 'src/server.ts', 'db/migrate': 'src/db/migrate.ts', 'db/seed': 'src/db/seed.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false, // each entry self-contained (migrate.js resolves ../../migrations from its own path)
  sourcemap: true,
  noExternal: ['@acadex/shared'],
});
