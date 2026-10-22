// Drives the built extension in real Firefox via WebDriver (geckodriver is fetched by Selenium Manager).
// Usage: pnpm build && pnpm zip && node scripts/e2e.mjs [scenario ...]
// Screenshots and a JSON log go to .e2e/. No network access besides localhost is needed.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { serve } from './serve-fixtures.mjs';
import { scenarios } from './e2e-scenarios.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.e2e');
mkdirSync(outDir, { recursive: true });

const zip = readdirSync(join(root, '.output'))
  .filter((f) => f.endsWith('-firefox.zip'))
  .map((f) => join(root, '.output', f))[0];
if (!zip) throw new Error('no .output/*-firefox.zip – run `pnpm zip` first');
if (!existsSync(join(root, 'test/fixtures/media/tone.wav'))) {
  throw new Error('media fixtures missing – run `pnpm fixtures:media` first');
}

const PORT = 5555;
const server = await serve(PORT);
const options = new firefox.Options()
  .setBinary(process.env.FIREFOX_BIN ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe')
  .windowSize({ width: 1400, height: 1000 })
  .setPreference('media.autoplay.default', 0)
  .setPreference('media.autoplay.blocking_policy', 0);
if (process.env.HEADLESS) options.addArguments('-headless');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const results = [];
try {
  await driver.installAddon(zip, true);
  const ctx = {
    driver,
    By,
    until,
    base: `http://localhost:${PORT}`,
    async shot(name) {
      const png = await driver.takeScreenshot();
      const file = join(outDir, `${name}.png`);
      writeFileSync(file, png, 'base64');
      return file;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  const wanted = process.argv.slice(2);
  for (const [name, run] of Object.entries(scenarios)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const t0 = Date.now();
    try {
      const details = await run(ctx);
      results.push({ name, ok: true, ms: Date.now() - t0, details });
      console.log(`PASS ${name}`, details ?? '');
    } catch (e) {
      await ctx.shot(`FAIL-${name}`).catch(() => {});
      results.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.stack ?? e) });
      console.log(`FAIL ${name}\n  ${String(e?.message ?? e)}`);
    }
  }
} finally {
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  await driver.quit();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
