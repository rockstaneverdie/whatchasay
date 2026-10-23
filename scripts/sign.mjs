// Signs the add-on with Mozilla for self-distribution (unlisted channel), so a release Firefox can
// install it permanently. Usage: pnpm sign   → web-ext-artifacts/*.xpi
//
// Needs AMO API credentials (https://addons.mozilla.org/developers/addon/api/key/) in the environment
// or in .env (git-ignored, excluded from the source archive):
//   WEB_EXT_API_KEY=user:12345:67
//   WEB_EXT_API_SECRET=…
// web-ext reads them from the environment itself; they are never put on a command line or printed.
// Every signed version must be new: bump "version" in package.json before signing again.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error(
    'WEB_EXT_API_KEY / WEB_EXT_API_SECRET are not set.\n' +
      'Create them at https://addons.mozilla.org/developers/addon/api/key/ and put them into .env.',
  );
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sources = join(root, '.output', `whatchasay-${version}-sources.zip`);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

// Production build plus the source archive Mozilla's reviewers may ask for (the bundle is minified).
run('pnpm zip');
run('pnpm web-ext:lint');
run(
  `pnpm exec web-ext sign --source-dir .output/firefox-mv3 --artifacts-dir web-ext-artifacts ` +
    `--channel unlisted --upload-source-code "${sources}"`,
);
console.log(
  '\nSigned. Install the .xpi from web-ext-artifacts/: drag it into Firefox, or about:addons → ⚙ → Install Add-on From File.',
);
