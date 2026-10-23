// Live checks on real, legal websites with third-party players (TZ 1.1, M4b). They need the internet,
// so `scripts/e2e.mjs` runs them only when asked: `pnpm e2e live`.
// Sintel (Blender Foundation) is CC-BY; Wikimedia Commons plays it with video.js and community subtitles.
// The AI answers come from the local mock (scripts/mock-ai.mjs); nothing is sent to a real provider.
import { Key } from 'selenium-webdriver';
import {
  clickMenuButton,
  httpJson,
  openMenu,
  probe,
  shadowFind,
  shadowFindAll,
  waitCard,
  waitFor,
} from './e2e-scenarios.mjs';

export const SINTEL = 'https://commons.wikimedia.org/wiki/File:Sintel_movie_4K.webm';

const HOST = 'subtext-overlay';

/** Facts about the page's players, without touching them. */
export const DESCRIBE_PAGE = `
  const videos = [...document.querySelectorAll('video')].map((v) => {
    const r = v.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      src: (v.currentSrc || v.src || '').replace(/^https?:\\/\\//, '').slice(0, 70),
      paused: v.paused,
      tracks: [...v.textTracks].map((t) => ({ kind: t.kind, lang: t.language, label: t.label, mode: t.mode })),
      parentClass: v.parentElement ? v.parentElement.className.slice(0, 60) : null,
    };
  });
  const host = document.querySelector('${HOST}');
  return {
    videos,
    overlay: !!host,
    overlayNextToPlayingVideo: !!host && !!host.parentElement && [...host.parentElement.querySelectorAll('video')].some((v) => !!v.currentSrc),
  };
`;

/** Same as the e2e hook call, but on any page (the hook exists on every page in the e2e build). */
async function hook(ctx, op, payload) {
  const res = await ctx.driver.executeAsyncScript(
    `
    const [op, payload, done] = arguments;
    const id = Math.random();
    const on = (e) => {
      if (e.data && e.data.type === 'subtext-e2e-result' && e.data.id === id) {
        removeEventListener('message', on);
        done(e.data);
      }
    };
    addEventListener('message', on);
    postMessage({ type: 'subtext-e2e', id, op, payload }, '*');
  `,
    op,
    payload,
  );
  if (res.error) throw new Error(`hook ${op}: ${res.error}`);
  return res.result;
}

/** Our active line and the page's own active cue, for a sync comparison. */
const COMPARE_ACTIVE = `
  const v = [...document.querySelectorAll('video')].find((x) => x.currentSrc);
  const track = [...v.textTracks].find((t) => t.mode !== 'disabled' && t.activeCues);
  const page = track && track.activeCues ? [...track.activeCues].map((c) => c.text.replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim()) : [];
  const ours = [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.panel .line.active .row')]
    .map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).join(' ');
  return { t: v.currentTime, page, ours, trackMode: track ? track.mode : null };
`;

export const liveScenarios = {
  async 'live-commons-sintel'(ctx) {
    const { driver, By } = ctx;
    const out = {};
    await driver.get(SINTEL);
    await driver.wait(
      async () => driver.executeScript(`return !!document.querySelector('${HOST}')`),
      15000,
      'overlay on placeholder',
    );
    out.placeholder = await driver.executeScript(DESCRIBE_PAGE);

    // The page shows a poster; Play swaps in the real video.js player (FR-V2 on a live site).
    await driver.findElement(By.css('.mw-tmh-player')).click();
    await driver.wait(
      async () =>
        driver.executeScript(
          `return [...document.querySelectorAll('video')].some((v) => v.currentSrc && v.readyState > 1)`,
        ),
      30000,
      'real player did not start',
    );
    await ctx.sleep(2500);
    await driver.executeScript(`[...document.querySelectorAll('video')].forEach((v) => v.pause())`);
    out.player = await driver.executeScript(DESCRIBE_PAGE);
    await ctx.shot('live-commons-player');
    if (!out.player.overlayNextToPlayingVideo)
      throw new Error('overlay did not move to the real player: ' + JSON.stringify(out.player).slice(0, 400));

    // Settings for this run: Russian UI, the local mock AI.
    await hook(ctx, 'settings', {
      uiLang: 'ru',
      provider: 'openai-compat',
      openai: { baseUrl: 'http://localhost:5556/v1', model: 'ok' },
      panel: { compact: 'auto' },
    });

    // Launcher menu: the page's text tracks and the subtitle files video.js fetched.
    await openMenu(ctx);
    out.menu = await driver.executeScript(
      `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu .group')].map((g) => g.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160))`,
    );
    await ctx.shot('live-commons-menu');
    const english = await driver.executeScript(
      `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu .group button')].find((b) => b.textContent.trim() === 'English (en)')?.textContent.trim()`,
    );
    if (!english) throw new Error(`no English page track in menu: ${JSON.stringify(out.menu)}`);
    await clickMenuButton(ctx, english);
    const imported = await waitFor(
      ctx,
      (p) => p.toast && p.toast.includes('Импортирована'),
      'import toast',
      20000,
    );
    const enCues = await driver.executeScript(`
      const v = [...document.querySelectorAll('video')].find((x) => x.currentSrc);
      const t = [...v.textTracks].find((t) => t.language === 'en');
      return [...t.cues].map((c) => [c.startTime, c.endTime]);`);
    out.imported = { item: english, toast: imported.toast, pageCues: enCues.length };

    // 898 px wide player → a 34 % panel would be 305 px < 320 px, so 7.7 switches to compact mode.
    const mid = (i) => (enCues[i][0] + enCues[i][1]) / 2;
    await driver.executeScript(
      `const v = [...document.querySelectorAll('video')].find((x) => x.currentSrc); v.pause(); v.currentTime = arguments[0];`,
      mid(3),
    );
    const compact = await waitFor(
      ctx,
      (p) => p.compact && p.active.length > 0,
      'compact bar on an active cue',
      8000,
    );
    out.compact = { active: compact.active };
    await ctx.shot('live-commons-compact');

    // Side panel forced on to check the karaoke panel, sync and explanations on the real player.
    await hook(ctx, 'settings', { panel: { compact: 'off' } });
    const panel = await waitFor(
      ctx,
      (p) => p.panel && p.lines === enCues.length,
      'side panel with every cue',
      8000,
    );
    out.panel = { lines: panel.lines };

    // Sync against the page's own cue timing while playing, across several cues.
    await driver.executeScript(
      `
      const v = [...document.querySelectorAll('video')].find((x) => x.currentSrc);
      v.currentTime = arguments[0]; return v.play();`,
      enCues[5][0] - 0.5,
    );
    const samples = [];
    for (let i = 0; i < 14; i++) {
      await ctx.sleep(600);
      samples.push(await driver.executeScript(COMPARE_ACTIVE));
    }
    const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
    const comparable = samples.filter((s) => s.page.length > 0);
    const agree = comparable.filter((s) => s.page.some((p) => norm(s.ours).includes(norm(p).slice(-15))));
    out.sync = { samples: samples.length, withPageCue: comparable.length, agree: agree.length };
    await ctx.shot('live-commons-playing');
    if (comparable.length === 0 || agree.length / comparable.length < 0.8) {
      throw new Error(`out of sync: ${JSON.stringify(samples.slice(0, 5))}`);
    }
    // Land on a spoken line for the explanation step.
    await driver.executeScript(
      `const v = [...document.querySelectorAll('video')].find((x) => x.currentSrc); v.currentTime = arguments[0]; return v.play();`,
      mid(6) - 0.4,
    );
    await ctx.sleep(500);

    // Explain a word: pause, card, Space resumes without the player toggling twice.
    const word = await shadowFind(ctx, '.panel .line.active .w');
    out.word = await word.getText();
    await word.click();
    const card = await waitCard(ctx, (c) => c.status === 'done', 'card on live site', 15000);
    const pausedAtCard = await driver.executeScript(
      `return [...document.querySelectorAll('video')].find((v) => v.currentSrc).paused`,
    );
    await ctx.shot('live-commons-card');
    const sent = (await httpJson('http://localhost:5556/stats')).lastBody.messages[1].content;
    await driver.actions().sendKeys(Key.SPACE).perform();
    await ctx.sleep(600);
    const afterSpace = await driver.executeScript(
      `return { paused: [...document.querySelectorAll('video')].find((v) => v.currentSrc).paused, card: !!document.querySelector('${HOST}').shadowRoot.querySelector('.card') }`,
    );
    out.explain = {
      pausedAtCard,
      cardStart: card.text.slice(0, 40),
      selectedInPrompt: /SELECTED: "[^"]+"/.test(sent),
      afterSpace,
    };
    if (!pausedAtCard || afterSpace.card || afterSpace.paused)
      throw new Error(`explain flow: ${JSON.stringify(out.explain)}`);

    // video.js fullscreen puts its wrapper in fullscreen; the panel must stay visible.
    const fsButton = await driver.findElements(By.css('.vjs-fullscreen-control'));
    if (fsButton.length) {
      await fsButton[0].click();
      await ctx.sleep(1500);
      out.fullscreen = await probe(ctx);
      await ctx.shot('live-commons-fullscreen');
      await driver.executeScript('return document.fullscreenElement && document.exitFullscreen()');
      await ctx.sleep(600);
      if (!out.fullscreen.fullscreen || !out.fullscreen.panel)
        throw new Error(`fullscreen: ${JSON.stringify(out.fullscreen)}`);
    } else {
      out.fullscreen = 'no fullscreen button found';
    }
    await driver.executeScript(`[...document.querySelectorAll('video')].forEach((v) => v.pause())`);

    // Subtitle files spotted by FR-S8 while video.js loaded them.
    await openMenu(ctx);
    out.sniffed = await driver.executeScript(
      `const g = [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu .group')].find((x) => x.textContent.includes('загруженные страницей'));
       return g ? [...g.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 6) : null;`,
    );
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    void shadowFindAll;
    return out;
  },
};
