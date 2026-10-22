// Scenarios for scripts/e2e.mjs. Each returns optional details or throws.
import { Key } from 'selenium-webdriver';

const HOST = 'subtext-overlay';

/** Runs in the page: facts about the overlay. */
const PROBE = `
  const host = document.querySelector('${HOST}');
  if (!host || !host.shadowRoot) return null;
  const root = host.shadowRoot;
  const r = host.getBoundingClientRect();
  const lines = root.querySelectorAll('.line');
  const active = [...root.querySelectorAll('.panel .line.active, .bar .line.active')].map((l) => Number(l.dataset.index));
  const list = root.querySelector('.list');
  const toast = root.querySelector('.toast');
  return {
    parent: host.parentElement && host.parentElement.id,
    rect: [r.x, r.y, r.width, r.height].map(Math.round),
    panel: !!root.querySelector('.panel'),
    compact: !!root.querySelector('.bar'),
    lines: lines.length,
    active,
    transform: list ? list.style.transform : null,
    toCurrent: !!root.querySelector('.to-current'),
    toast: toast ? toast.textContent.trim() : null,
    launcher: !!root.querySelector('.fab'),
    card: root.querySelector('.card') ? root.querySelector('.card').textContent.trim() : null,
    fullscreen: !!document.fullscreenElement && document.fullscreenElement.contains(host),
  };
`;

const probe = (ctx) => ctx.driver.executeScript(PROBE);

/** Drops a fixture file on the centre of the video, like a user would. */
const dropFixture = (ctx, path, name) =>
  ctx.driver.executeAsyncScript(
    `
    const [path, name, done] = arguments;
    fetch(path).then((r) => r.arrayBuffer()).then((buf) => {
      const v = document.querySelector('video');
      const r = v.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.items.add(new File([buf], name, { type: 'text/plain' }));
      const opts = { dataTransfer: dt, clientX: r.left + r.width / 3, clientY: r.top + r.height / 2, bubbles: true, cancelable: true };
      v.dispatchEvent(new DragEvent('dragenter', opts));
      v.dispatchEvent(new DragEvent('dragover', opts));
      const ok = !v.dispatchEvent(new DragEvent('drop', opts));
      done(ok);
    }).catch((e) => done(String(e)));
  `,
    path,
    name,
  );

async function waitFor(ctx, fn, what, timeout = 6000) {
  return ctx.driver.wait(
    async () => {
      const p = await probe(ctx);
      return p && fn(p) ? p : null;
    },
    timeout,
    `timed out waiting for ${what}`,
  );
}

/** Expected active cue indices for the current time, computed from the fixture independently. */
const EXPECTED_ACTIVE = `
  const cues = window.__cues;
  const v = document.querySelector('video');
  const host = document.querySelector('${HOST}');
  const root = host.shadowRoot;
  const t = v.currentTime - (window.__offset || 0);
  const shown = [...root.querySelectorAll('.panel .line.active')].map((l) => Number(l.dataset.index));
  const expected = cues.flatMap((c, i) => (c[0] <= t && t < c[1] ? [i] : []));
  const nearBoundary = cues.some((c) => Math.abs(c[0] - t) < 0.1 || Math.abs(c[1] - t) < 0.1);
  return { t, shown, expected, nearBoundary };
`;

async function loadCueTimes(ctx, file) {
  await ctx.driver.executeAsyncScript(
    `
    const [file, done] = arguments;
    fetch(file).then((r) => r.text()).then((txt) => {
      const ts = (s) => { const [c, f = '0'] = s.split(/[.,]/); return c.split(':').reduce((a, p) => a * 60 + Number(p), 0) + Number(f) / 10 ** f.length; };
      const cues = [...txt.matchAll(/(\\d+:\\d+:\\d+[,.]\\d+)\\s*-->\\s*(\\d+:\\d+:\\d+[,.]\\d+)/g)].map((m) => [ts(m[1]), ts(m[2])]);
      window.__cues = cues;
      done(cues.length);
    });
  `,
    file,
  );
}

async function setupSample(ctx) {
  await ctx.driver.get(`${ctx.base}/player.html`);
  await ctx.driver.wait(
    async () => ctx.driver.executeScript(`return !!document.querySelector('${HOST}')`),
    8000,
  );
  const dropped = await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt');
  if (dropped !== true) throw new Error(`drop was not handled: ${dropped}`);
  await waitFor(ctx, (p) => p.lines === 29, 'panel with 29 lines');
  await loadCueTimes(ctx, '/sample.srt');
}

export const scenarios = {
  async 'm1-drop-and-sync'(ctx) {
    await setupSample(ctx);
    const loaded = await probe(ctx);
    await ctx.shot('m1-loaded');

    // Play and sample sync repeatedly.
    await ctx.driver.executeScript(
      `const v = document.querySelector('video'); v.currentTime = 3.5; return v.play()`,
    );
    let mismatches = 0;
    const samples = [];
    for (let i = 0; i < 30; i++) {
      await ctx.sleep(200);
      const s = await ctx.driver.executeScript(EXPECTED_ACTIVE);
      const ok = JSON.stringify(s.shown) === JSON.stringify(s.expected);
      if (!ok && !s.nearBoundary) mismatches++;
      samples.push({ t: +s.t.toFixed(2), shown: s.shown, expected: s.expected });
    }
    await ctx.shot('m1-playing');
    if (mismatches > 0) throw new Error(`${mismatches} out-of-sync samples: ${JSON.stringify(samples)}`);

    // Word fill progresses within the active line.
    const words = await ctx.driver.executeScript(`
      const root = document.querySelector('${HOST}').shadowRoot;
      return [...root.querySelectorAll('.line.active .w')].map((w) => w.style.getPropertyValue('--p'));
    `);
    if (!words.length || !words.some((p) => Number(p) > 0)) throw new Error(`no word progress: ${words}`);

    // Seek: the panel updates within a frame.
    const seek = await ctx.driver.executeAsyncScript(`
      const done = arguments[0];
      const v = document.querySelector('video');
      v.pause();
      v.currentTime = 39.5;
      const t0 = performance.now();
      const root = document.querySelector('${HOST}').shadowRoot;
      const check = () => {
        const a = [...root.querySelectorAll('.panel .line.active')].map((l) => Number(l.dataset.index));
        if (a.includes(11)) done({ ms: performance.now() - t0, active: a });
        else if (performance.now() - t0 > 1000) done({ ms: -1, active: a });
        else requestAnimationFrame(check);
      };
      v.addEventListener('seeked', check, { once: true });
    `);
    if (seek.ms < 0) throw new Error(`seek did not update the panel: ${JSON.stringify(seek)}`);
    await ctx.sleep(600);
    await ctx.shot('m1-after-seek');
    return {
      loaded: { lines: loaded.lines, rect: loaded.rect },
      seekMsAfterSeeked: Math.round(seek.ms),
      words,
    };
  },

  async 'm1-drop-vtt'(ctx) {
    await ctx.driver.get(`${ctx.base}/player.html`);
    await ctx.driver.wait(
      async () => ctx.driver.executeScript(`return !!document.querySelector('${HOST}')`),
      8000,
    );
    if ((await dropFixture(ctx, '/sample.vtt', 'garden.vtt')) !== true) throw new Error('drop failed');
    const p = await waitFor(ctx, (q) => q.lines === 9, 'panel with 9 VTT cues');
    const speakers = await ctx.driver.executeScript(
      `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.speaker')].map((s) => s.textContent)`,
    );
    if (!speakers.includes('Rosa')) throw new Error(`voice tags not parsed: ${speakers}`);
    return { lines: p.lines, speakers };
  },

  async 'm1-manual-scroll'(ctx) {
    await setupSample(ctx);
    const before = await probe(ctx);
    await ctx.driver.executeScript(`
      const panel = document.querySelector('${HOST}').shadowRoot.querySelector('.panel');
      const r = panel.getBoundingClientRect();
      for (let i = 0; i < 4; i++) panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: r.left + 20, clientY: r.top + 40, bubbles: true, cancelable: true, composed: true }));
    `);
    const scrolled = await waitFor(ctx, (p) => p.toCurrent, '"back to current" button', 1500);
    if (scrolled.transform === before.transform) throw new Error('wheel did not move the list');
    await ctx.shot('m1-manual-scroll');
    const back = await waitFor(ctx, (p) => !p.toCurrent, 'auto-return after 3 s', 5000);
    await ctx.sleep(600);
    const settled = await probe(ctx);
    if (settled.transform !== before.transform)
      throw new Error(`did not return: ${settled.transform} vs ${before.transform}`);
    return { before: before.transform, scrolled: scrolled.transform, back: back.transform };
  },

  async 'm1-hotkeys-offset-repeat-toggle'(ctx) {
    const { driver } = ctx;
    await setupSample(ctx);
    await driver.executeScript(
      `document.querySelector('video').currentTime = 20; document.activeElement.blur()`,
    );
    await driver.findElement(ctx.By.css('body')).click();
    await driver.actions().sendKeys(']').perform();
    const plus = await waitFor(ctx, (p) => p.toast && p.toast.includes('+0.1'), 'offset toast +0.1');
    await driver.actions().keyDown(Key.SHIFT).sendKeys('[').keyUp(Key.SHIFT).perform();
    const minus = await waitFor(ctx, (p) => p.toast && p.toast.includes('-0.9'), 'offset toast -0.9');
    await driver
      .actions()
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .sendKeys(']')
      .perform();
    await waitFor(ctx, (p) => p.toast && /[+]?0\.0/.test(p.toast), 'offset back to 0');

    // R: back to the start of the current cue and play.
    await driver.executeScript(`const v = document.querySelector('video'); v.pause(); v.currentTime = 24.0;`);
    await ctx.sleep(200);
    await driver.actions().sendKeys('r').perform();
    await ctx.sleep(250);
    const rep = await driver.executeScript(
      `const v = document.querySelector('video'); return { t: v.currentTime, paused: v.paused }`,
    );
    if (rep.paused || rep.t < 22.0 || rep.t > 22.6) throw new Error(`repeat failed: ${JSON.stringify(rep)}`);
    await driver.executeScript(`document.querySelector('video').pause()`);

    // Alt+L toggles the panel.
    await driver.actions().keyDown(Key.ALT).sendKeys('l').keyUp(Key.ALT).perform();
    const hidden = await waitFor(ctx, (p) => !p.panel, 'panel hidden');
    await driver.actions().keyDown(Key.ALT).sendKeys('l').keyUp(Key.ALT).perform();
    await waitFor(ctx, (p) => p.panel, 'panel shown');

    const siteToggles = await driver.executeScript('return window.siteToggles');
    return { plus: plus.toast, minus: minus.toast, repeat: rep, hidden: !hidden.panel, siteToggles };
  },

  async 'm1-reload-restores'(ctx) {
    await setupSample(ctx);
    await ctx.driver.navigate().refresh();
    const p = await waitFor(ctx, (q) => q.lines === 29, 'restored track after reload', 8000);
    await ctx.shot('m1-restored');
    return { toast: p.toast, lines: p.lines };
  },

  async 'm1-fullscreen'(ctx) {
    await setupSample(ctx);
    await ctx.driver.executeScript(`document.querySelector('video').currentTime = 14.5`);
    await ctx.driver.findElement(ctx.By.id('fs')).click();
    await ctx.sleep(1200);
    const p = await probe(ctx);
    await ctx.shot('m1-fullscreen');
    await ctx.driver.executeScript('return document.exitFullscreen()');
    await ctx.sleep(500);
    if (!p.fullscreen || !p.panel) throw new Error(`panel not in fullscreen: ${JSON.stringify(p)}`);
    return { rect: p.rect, active: p.active };
  },

  async 'm1-perf-1000'(ctx) {
    const { driver } = ctx;
    await driver.get(`${ctx.base}/player.html?media=media/long.wav`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    const dropped = await dropFixture(ctx, '/media/long.srt', 'long.srt');
    if (dropped !== true) throw new Error('drop failed');
    await waitFor(ctx, (p) => p.lines === 1000, '1000 lines', 10000);
    await driver.executeScript(
      `const v = document.querySelector('video'); v.currentTime = 600; return v.play()`,
    );
    await ctx.sleep(1000);
    const frames = await driver.executeAsyncScript(`
      const done = arguments[0];
      const deltas = [];
      let last = performance.now();
      const t0 = last;
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        if (now - t0 < 5000) requestAnimationFrame(step);
        else done(deltas);
      };
      requestAnimationFrame(step);
    `);
    await ctx.shot('m1-perf-1000');
    await driver.executeScript(`document.querySelector('video').pause()`);
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const fps = 1000 / avg;
    const long = frames.filter((d) => d > 34).length;
    const res = {
      frames: frames.length,
      fps: +fps.toFixed(1),
      p50: +pct(0.5).toFixed(1),
      p95: +pct(0.95).toFixed(1),
      p99: +pct(0.99).toFixed(1),
      over34ms: long,
    };
    if (fps < 50) throw new Error(`low fps ${JSON.stringify(res)}`);
    return res;
  },
};
