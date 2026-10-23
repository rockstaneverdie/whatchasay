// Drives the built extension in real Firefox via WebDriver (geckodriver is fetched by Selenium Manager).
// Usage: pnpm e2e [scenario-prefix ...]   (builds the e2e variant first)
// Screenshots and a JSON log go to .e2e/. Only localhost is contacted (fixtures + mock AI and OpenSubtitles servers).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { startMockAi } from './mock-ai.mjs';
import { startMockOs } from './mock-opensubtitles.mjs';
import { serve } from './serve-fixtures.mjs';
import { liveScenarios } from './e2e-live.mjs';
import { scenarios as localScenarios } from './e2e-scenarios.mjs';

const scenarios = { ...localScenarios, ...liveScenarios };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.e2e');
mkdirSync(outDir, { recursive: true });

// The e2e build (--mode e2e) adds test hooks and localhost host permission; see src/utils/e2e-hooks.ts.
const addonDir = join(root, '.output', 'firefox-mv3-e2e');
if (!existsSync(addonDir)) throw new Error('no .output/firefox-mv3-e2e – run `pnpm build:e2e` first');
if (!existsSync(join(root, 'test/fixtures/media/tone.wav'))) {
  throw new Error('media fixtures missing – run `pnpm fixtures:media` first');
}

const ADDON_ID = 'subtext@subtext-extension.invalid';
const ADDON_UUID = '5b7e1d2a-0c3f-4e8a-9d61-2f4a7c9e0b13';
const PORT = 5555;
const server = await serve(PORT);
const ai = await startMockAi(5556);
const os = await startMockOs(5557);

const options = new firefox.Options()
  .setBinary(process.env.FIREFOX_BIN ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe')
  .windowSize({ width: 1400, height: 1000 })
  .setPreference('media.autoplay.default', 0)
  .setPreference('media.autoplay.blocking_policy', 0)
  // A known moz-extension:// origin for the options page.
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: ADDON_UUID }))
  // Grant optional host permissions without the doorhanger (only in this test profile).
  .setPreference('extensions.webextOptionalPermissionPrompts', false);
if (process.env.HEADLESS) options.addArguments('-headless');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const results = [];
try {
  await driver.installAddon(addonDir, true);
  const ctx = {
    driver,
    By,
    until,
    root,
    ai,
    os,
    base: `http://localhost:${PORT}`,
    ext: `moz-extension://${ADDON_UUID}`,
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
    // live-* scenarios hit real websites; they only run when asked for by name.
    if (name.startsWith('live-') && !wanted.some((w) => name.startsWith(w) && w.startsWith('live'))) continue;
    if (wanted.length && !wanted.some((w) => name.startsWith(w))) continue;
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
  ai.server.close();
  os.server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
