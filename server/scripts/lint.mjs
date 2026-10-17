import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url)),
  'eslint.config.mjs', 'server/src', 'server/scripts', 'server/test', 'web/src', 'web/test', 'web/public',
], { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'inherit' });
if (result.error) console.error('Unable to start the local ESLint installation. Run npm ci in server.');
process.exit(result.status ?? 1);
