// Tiny cross-platform build helpers: `node scripts/build-helpers.mjs clean|copy-migrations`
import { cpSync, rmSync } from 'node:fs';

const cmd = process.argv[2];
if (cmd === 'clean') {
  rmSync('dist', { recursive: true, force: true });
} else if (cmd === 'copy-migrations') {
  cpSync('server/migrations', 'dist/server/migrations', { recursive: true });
} else {
  console.error('usage: build-helpers.mjs clean|copy-migrations');
  process.exit(1);
}
