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

    // Word fill progresses within the active line (paused mid-cue, so the check never lands in a gap).
    await ctx.driver.executeScript(
      `const v = document.querySelector('video'); v.pause(); v.currentTime = 8.2;`,
    );
    await ctx.sleep(300);
    const words = await ctx.driver.executeScript(`
      const root = document.querySelector('${HOST}').shadowRoot;
      return [...root.querySelectorAll('.line.active .w')].map((w) => w.style.getPropertyValue('--p'));
    `);
    const filled = words.map(Number);
    if (!filled.some((p) => p > 0) || !filled.some((p) => p < 1))
      throw new Error(`no partial word fill: ${words}`);

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

  // ------------------------------------------------------------------ M2

  async 'm2-provider-and-settings-entry'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/player.html`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    // No key configured yet → the background reports it.
    const before = await e2eCall(ctx, 'bg', { type: 'provider/status' });
    await setModel(ctx, 'ok');
    const models = await e2eCall(ctx, 'bg', { type: 'provider/models' });
    if (!models.result?.ok || models.result.models.length !== 5) throw new Error(JSON.stringify(models));

    // The launcher's "Settings" item opens the options page in a new tab.
    const handles = await driver.getAllWindowHandles();
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('video')) })
      .perform();
    await (await shadowFind(ctx, '.fab')).click();
    await ctx.shot('m2-launcher-menu');
    const item = await driver.executeScript(
      `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu button')].find((b) => b.textContent.trim() === 'Настройки')`,
    );
    await item.click();
    const opened = await driver.wait(
      async () => (await driver.getAllWindowHandles()).find((h) => !handles.includes(h)),
      5000,
      'options tab did not open',
    );
    const main = await driver.getWindowHandle();
    await driver.switchTo().window(opened);
    await driver.close();
    await driver.switchTo().window(main);
    return {
      statusBefore: before.result,
      models: models.result.models.map((m) => m.id),
      optionsTabOpened: true,
    };
  },

  async 'm2-explain-word-stream-space'(ctx) {
    const { driver } = ctx;
    await setModel(ctx, 'ok');
    await setupSample(ctx);
    await driver.executeScript(`
      window.__t = {};
      window.addEventListener('click', () => (window.__t.click = performance.now()), true);
      const v = document.querySelector('video');
      v.addEventListener('pause', () => (window.__t.pause = performance.now()));
      v.currentTime = 14.2;
      return v.play();
    `);
    await ctx.sleep(700);
    const before = (await httpJson('http://localhost:5556/stats')).requests;
    const word = await shadowFind(ctx, '.panel .line.active .w:nth-child(3)');
    await word.click();
    const skeleton = await waitCard(
      ctx,
      (c) => c.status === 'loading' || c.status === 'streaming',
      'card opened',
    );
    const t = await driver.executeScript('return window.__t');
    const pauseMs = t.pause - t.click;
    const streaming = await waitCard(ctx, (c) => c.status === 'streaming', 'streaming text', 5000);
    const done = await waitCard(ctx, (c) => c.status === 'done', 'card done', 8000);
    await ctx.shot('m2-card-done');
    if (!(pauseMs >= 0 && pauseMs <= 50)) throw new Error(`pause took ${pauseMs} ms`);
    if (!done.text.includes('Идиома') || !done.text.includes('back to square one'))
      throw new Error(done.text);
    if (done.text.includes('@@')) throw new Error('meta leaked into the card');
    const body = (await httpJson('http://localhost:5556/stats')).lastBody;
    const user = body.messages[1].content;

    // Space closes and resumes; the site's own Space handler must not fire.
    const togglesBefore = await driver.executeScript('return window.siteToggles');
    await driver.actions().sendKeys(Key.SPACE).perform();
    await ctx.sleep(300);
    const after = await driver.executeScript(
      `return { paused: document.querySelector('video').paused, toggles: window.siteToggles, card: !!document.querySelector('${HOST}').shadowRoot.querySelector('.card') }`,
    );
    if (after.card || after.paused || after.toggles !== togglesBefore)
      throw new Error(`space: ${JSON.stringify(after)}`);

    // Same word again → from cache, no network, under 100 ms.
    await driver.executeScript(`const v = document.querySelector('video'); v.pause(); v.currentTime = 14.2;`);
    await ctx.sleep(300);
    const again = await shadowFind(ctx, '.panel .line.active .w:nth-child(3)');
    const t0 = Date.now();
    await again.click();
    const cached = await waitCard(ctx, (c) => c.status === 'done', 'cached card', 2000);
    const cacheMs = Date.now() - t0;
    const inPage = await driver.executeAsyncScript(`
      const done = arguments[0];
      const card = document.querySelector('${HOST}').shadowRoot.querySelector('.card');
      done(card.dataset.cached);
    `);
    const requests = (await httpJson('http://localhost:5556/stats')).requests;
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    if (inPage !== 'true' || requests !== before + 1)
      throw new Error(`not cached: ${inPage}, requests ${requests - before}`);
    return {
      pauseMs: +pauseMs.toFixed(1),
      skeleton: skeleton.status,
      streamingSeen: !!streaming,
      selectedInPrompt: /SELECTED: "\w+"/.test(user),
      stableFirst: user.indexOf('TRANSCRIPT:') < user.indexOf('TARGET:'),
      cachedRoundTripMs: cacheMs,
      cachedNote: cached.text.includes('из кэша'),
    };
  },

  async 'm2-selection-esc-and-E'(ctx) {
    const { driver } = ctx;
    await setModel(ctx, 'ok');
    await setupSample(ctx);
    await driver.executeScript(`document.querySelector('video').currentTime = 18.5`);
    await ctx.sleep(400);
    const words = await shadowFindAll(ctx, '.panel .line.active .w');
    await driver.actions().move({ origin: words[2] }).press().move({ origin: words[5] }).release().perform();
    const card = await waitCard(ctx, (c) => c.status === 'done', 'selection card', 8000);
    const body = (await httpJson('http://localhost:5556/stats')).lastBody.messages[1].content;
    const selected = /SELECTED: "([^"]+)"/.exec(body)?.[1];
    await ctx.shot('m2-selection');
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await ctx.sleep(200);
    const afterEsc = await driver.executeScript(
      `return { paused: document.querySelector('video').paused, card: !!document.querySelector('${HOST}').shadowRoot.querySelector('.card') }`,
    );
    if (!selected || selected.split(' ').length < 3) throw new Error(`selection not sent: ${selected}`);
    if (afterEsc.card || !afterEsc.paused) throw new Error(`esc: ${JSON.stringify(afterEsc)}`);

    await driver.executeScript(
      `document.querySelector('video').currentTime = 26.5; window.getSelection().removeAllRanges();`,
    );
    await ctx.sleep(300);
    await driver.findElement(ctx.By.css('body')).click();
    await driver.actions().sendKeys('e').perform();
    const e = await waitCard(ctx, (c) => c.status === 'done', 'E card', 8000);
    const bodyE = (await httpJson('http://localhost:5556/stats')).lastBody.messages[1].content;
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    return {
      selected,
      cardType: card.text.slice(0, 20),
      eTarget: /TARGET: [^\n]+/.exec(bodyE)?.[0],
      eOk: !!e,
    };
  },

  async 'm2-errors'(ctx) {
    const out = {};
    const cases = [
      ['badkey', 'Ключ не подошёл', 'Открыть настройки'],
      ['rate', 'через 30 с', 'Повторить'],
      ['empty', 'Пустой ответ', 'Повторить'],
    ];
    await setupSample(ctx);
    for (const [model, expected, button] of cases) {
      await setModel(ctx, model, false);
      await ctx.driver.executeScript(`document.querySelector('video').currentTime = 26.5`);
      await ctx.sleep(300);
      await (await shadowFind(ctx, '.panel .line.active .w')).click();
      const card = await waitCard(ctx, (c) => c.status === 'error', `${model} error`, 8000);
      if (!card.text.includes(expected) || !card.text.includes(button))
        throw new Error(`${model}: ${card.text}`);
      out[model] = card.text.split('Пробел')[0].trim();
      if (model === 'rate') await ctx.shot('m2-error-rate');
      await ctx.driver.actions().sendKeys(Key.ESCAPE).perform();
    }
    // No network: nothing listens on 5599.
    await setModel(ctx, 'ok', false, 'http://localhost:5599/v1');
    await (await shadowFind(ctx, '.panel .line.active .w')).click();
    const net = await waitCard(ctx, (c) => c.status === 'error', 'network error', 8000);
    if (!net.text.includes('Нет связи')) throw new Error(net.text);
    out.network = net.text.split('Пробел')[0].trim();
    await ctx.driver.actions().sendKeys(Key.ESCAPE).perform();
    return out;
  },

  async 'm2-cancel-and-timeout'(ctx) {
    await setModel(ctx, 'slow');
    await setupSample(ctx);
    await ctx.driver.executeScript(`document.querySelector('video').currentTime = 26.5`);
    await ctx.sleep(300);
    const before = await httpJson('http://localhost:5556/stats');
    await (await shadowFind(ctx, '.panel .line.active .w')).click();
    await waitCard(ctx, (c) => c.status === 'loading', 'loading', 3000);
    await ctx.sleep(800);
    await ctx.driver.actions().sendKeys(Key.ESCAPE).perform();
    await ctx.driver.wait(
      async () => (await httpJson('http://localhost:5556/stats')).aborted > before.aborted,
      4000,
      'request was not aborted',
    );

    await (await shadowFind(ctx, '.panel .line.active .w')).click();
    const t0 = Date.now();
    const card = await waitCard(ctx, (c) => c.status === 'error', 'timeout error', 20000);
    const ms = Date.now() - t0;
    await ctx.shot('m2-timeout');
    await ctx.driver.actions().sendKeys(Key.ESCAPE).perform();
    if (!card.text.includes('15 секунд')) throw new Error(card.text);
    await setModel(ctx, 'ok');
    return { cancelled: true, timeoutAfterMs: ms };
  },

  async 'm2-key-never-in-content'(ctx) {
    const { readFileSync } = await import('node:fs');
    const js = readFileSync(`${ctx.root}/.output/firefox-mv3/content-scripts/content.js`, 'utf8');
    const leaks = ['geminiKey', 'openaiKey', 'loadSecrets', 'x-goog-api-key', 'authorization'].filter((s) =>
      js.includes(s),
    );
    if (leaks.length) throw new Error(`content script references: ${leaks}`);
    return { checked: 'content.js has no key handling code' };
  },

  // ------------------------------------------------------------------ M3

  async 'm3-iframe-player'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/iframe.html`);
    const frame = await driver.wait(ctx.until.elementLocated(By.css('iframe')), 5000);
    const topHasHost = await driver.executeScript(`return !!document.querySelector('${HOST}')`);
    await driver.switchTo().frame(frame);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    if ((await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt')) !== true)
      throw new Error('drop failed');
    const p = await waitFor(ctx, (q) => q.lines === 29, 'panel in iframe');
    await driver.executeScript(`document.querySelector('video').currentTime = 14.5`);
    await ctx.sleep(500);
    await driver.switchTo().defaultContent();
    await ctx.shot('m3-iframe');
    if (topHasHost) throw new Error('overlay must not mount in the top page without a video');
    return { parent: p.parent, lines: p.lines };
  },

  async 'm3-spa-swap'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/player.html?spa=1`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt');
    await waitFor(ctx, (q) => q.lines === 29, 'track for episode 3');
    await driver.findElement(By.id('next')).click();
    // The old <video> is gone; the overlay re-attaches to the new one and drops the old track.
    const p = await waitFor(ctx, (q) => q.lines === 0 && q.panel, 'empty panel on the new video', 6000);
    const sameVideo = await driver.executeScript(
      `const h = document.querySelector('${HOST}'); return h.parentElement.contains(document.querySelector('video'))`,
    );
    await ctx.shot('m3-spa-swap');
    if (!sameVideo) throw new Error('overlay not attached next to the new video');
    // Loading a track for episode 4, then going back restores episode 3's track (per-page library).
    await dropFixture(ctx, '/sample.vtt', 'garden.vtt');
    await waitFor(ctx, (q) => q.lines === 9, 'track for episode 4');
    return { toast: p.toast };
  },

  async 'm3-page-track-import'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/player.html?track=1`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    await driver
      .actions()
      .move({ origin: await driver.findElement(By.css('video')) })
      .perform();
    await (await shadowFind(ctx, '.fab')).click();
    const item = await driver.wait(
      async () =>
        driver.executeScript(
          `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.group button')].find((b) => b.textContent.includes('English (fixture)'))`,
        ),
      4000,
      'page track not listed',
    );
    await item.click();
    const p = await waitFor(ctx, (q) => q.lines === 9, 'imported page track', 6000);
    const site = await driver.executeScript(`return document.querySelector('video').textTracks[0].mode`);
    await ctx.shot('m3-page-track');
    if (site !== 'disabled') throw new Error(`site track mode changed to ${site}`);
    // Regression (found on Wikimedia Commons): imported tracks must be saved, so a reload restores them.
    await driver.navigate().refresh();
    const restored = await waitFor(ctx, (q) => q.lines === 9, 'imported track restored after reload', 8000);
    return { toast: p.toast, siteTrackMode: site, restoredToast: restored.toast };
  },

  async 'm4b-lazy-player-swap'(ctx) {
    // Pattern seen on Wikimedia Commons: a poster <video> stays in the page, the real player is
    // inserted next to it paused and starts a moment later. The overlay must follow the real one.
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/lazy-player.html`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    const before = await driver.executeScript(`return document.querySelector('${HOST}').parentElement.id`);
    await driver.findElement(By.id('poster-play')).click();
    await driver.wait(
      async () =>
        driver.executeScript(`return document.querySelector('${HOST}')?.parentElement?.id === 'real-player'`),
      6000,
      'overlay did not follow the real player',
    );
    return { before, after: 'real-player' };
  },

  async 'm3-compact-and-english'(ctx) {
    const { driver } = ctx;
    await setupSample(ctx);
    await e2eCall(ctx, 'settings', { uiLang: 'en', panel: { compact: 'on' } });
    let p;
    let menu;
    try {
      await driver.executeScript(`document.querySelector('video').currentTime = 18.6`);
      p = await waitFor(ctx, (q) => q.compact && q.active.length === 1, 'compact bar', 4000);
      // Move from outside onto the video so a real mousemove reaches the page.
      const video = await driver.findElement(ctx.By.css('video'));
      await driver
        .actions()
        .move({ origin: video, x: -400, y: -250 })
        .move({ origin: video, x: -100, y: -50 })
        .perform();
      await (await shadowFind(ctx, '.fab')).click();
      menu = await driver.executeScript(
        `return document.querySelector('${HOST}').shadowRoot.querySelector('.menu').textContent`,
      );
      await ctx.shot('m3-compact-en');
    } finally {
      await e2eCall(ctx, 'settings', { uiLang: 'ru', panel: { compact: 'auto' } });
    }
    if (!menu.includes('Load subtitles') || !menu.includes('Settings'))
      throw new Error(`menu not English: ${menu}`);
    return { compact: p.compact, menu: menu.slice(0, 60) };
  },

  async 'm3-save-phrase-and-more'(ctx) {
    const { driver } = ctx;
    await setModel(ctx, 'ok');
    await setupSample(ctx);
    await driver.executeScript(`document.querySelector('video').currentTime = 14.4`);
    await ctx.sleep(300);
    await (await shadowFind(ctx, '.panel .line.active .w:nth-child(6)')).click();
    await waitCard(ctx, (c) => c.status === 'done', 'card', 8000);
    await (await shadowFind(ctx, '.card [aria-label="Сохранить"]')).click();
    const saved = await waitFor(ctx, (q) => q.toast && q.toast.includes('Фраза сохранена'), 'saved toast');
    await (await shadowFind(ctx, '.card [aria-label="Полезно"]')).click();
    const more = await shadowFind(ctx, '.card .actions .btn');
    await more.click();
    await waitCard(ctx, (c) => c.status === 'done' && !c.text.includes('Подробнее'), 'detailed card', 8000);
    const body = (await httpJson('http://localhost:5556/stats')).lastBody.messages[1].content;
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    if (!body.includes('MODE: detailed')) throw new Error('detailed mode not requested');
    return { saved: saved.toast, detailed: true };
  },
  // ------------------------------------------------------------------ M4

  async 'm4-opensubtitles-search-autosync'(ctx) {
    const { driver } = ctx;
    await setupSample(ctx); // sample.srt is the timing reference
    await e2eCall(ctx, 'settings', {
      sources: { osBaseUrl: 'http://localhost:5557/api/v1', osLanguages: 'en', autoSync: true },
    });
    await e2eCall(ctx, 'os-test-key', 'e2e-key');
    await openMenuItem(ctx, 'Найти субтитры онлайн…');
    const query = await driver.executeScript(
      `return document.querySelector('${HOST}').shadowRoot.querySelector('.dialog input').value`,
    );
    await (await shadowFind(ctx, '.dialog form .primary')).click();
    await driver.wait(
      async () => (await shadowFindAll(ctx, '.dialog .result')).length === 2,
      5000,
      'two results',
    );
    await ctx.shot('m4-os-results');
    const stats = await httpJson('http://localhost:5557/stats');
    (await shadowFindAll(ctx, '.dialog .result'))[0].click();
    const done = await waitFor(
      ctx,
      (p) => p.toast && p.toast.includes('OpenSubtitles'),
      'download toast',
      8000,
    );
    if (!done.toast.includes('сдвиг -2.3')) throw new Error(`not synced: ${done.toast}`);
    // Synced cues line up with the original timing again.
    await driver.executeScript(`document.querySelector('video').currentTime = 14.5`);
    const p = await waitFor(ctx, (q) => q.active.length > 0, 'active line', 3000);
    // M4: show info filled in from the result.
    await openMenuItem(ctx, 'Что смотрим?');
    const form = await driver.executeScript(
      `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.form input')].map((i) => i.value)`,
    );
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    if (p.active[0] !== 4) throw new Error(`active ${p.active} after sync`);
    if (form[3] !== '2020') throw new Error(`media info not filled: ${form}`);
    if (
      stats.lastHeaders['user-agent'] !== 'WhatchaSay v0.1.0' ||
      stats.lastHeaders['api-key'] !== 'e2e-key'
    ) {
      throw new Error(`headers: ${JSON.stringify(stats.lastHeaders)}`);
    }
    return { query, request: stats.lastQuery, toast: done.toast, mediaForm: form };
  },

  async 'm4-opensubtitles-errors'(ctx) {
    const { driver } = ctx;
    await setupSample(ctx);
    await e2eCall(ctx, 'settings', { sources: { osBaseUrl: 'http://localhost:5557/api/v1' } });
    const out = {};
    await e2eCall(ctx, 'os-test-key', 'e2e-bad');
    await openMenuItem(ctx, 'Найти субтитры онлайн…');
    await (await shadowFind(ctx, '.dialog form .primary')).click();
    out.badKey = (await waitDialog(ctx, (t) => t.includes('не принял'), 'bad key')).slice(0, 80);
    await driver.actions().sendKeys(Key.ESCAPE).perform();

    await e2eCall(ctx, 'os-test-key', 'e2e-quota');
    await openMenuItem(ctx, 'Найти субтитры онлайн…');
    await (await shadowFind(ctx, '.dialog form .primary')).click();
    await driver.wait(
      async () => (await shadowFindAll(ctx, '.dialog .result')).length === 2,
      5000,
      'results',
    );
    (await shadowFindAll(ctx, '.dialog .result'))[0].click();
    out.quota = (await waitDialog(ctx, (t) => t.includes('Лимит'), 'quota')).slice(0, 80);
    await ctx.shot('m4-os-quota');
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await e2eCall(ctx, 'os-test-key', 'e2e-key');
    return out;
  },

  async 'm4-page-loaded-subtitles'(ctx) {
    const { driver } = ctx;
    await driver.get(`${ctx.base}/player.html?sniff=1`);
    await driver.wait(
      async () => driver.executeScript('return window.sniffLoaded === 3'),
      8000,
      'page fetched subtitles',
    );
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
    await openMenu(ctx);
    const items = await driver.wait(
      async () => {
        const t = await driver.executeScript(
          `const g = [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu .group')].find((x) => x.textContent.includes('загруженные страницей'));
           return g ? [...g.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;`,
        );
        return t && t.length >= 2 ? t : null;
      },
      5000,
      'sniffed group in menu',
    );
    await ctx.shot('m4-sniffed-menu');
    await clickMenuButton(ctx, 'seg-*.vtt');
    const vtt = await waitFor(
      ctx,
      (q) => q.lines === 29 && q.toast?.includes('со страницы'),
      'segmented vtt loaded',
      8000,
    );
    await openMenu(ctx);
    await clickMenuButton(ctx, 'extra.ttml');
    const ttml = await waitFor(ctx, (q) => q.lines === 4, 'ttml loaded', 8000);
    const media = await driver.executeScript(
      'return performance.getEntriesByType("resource").filter((e) => /[.](mp4|wav|m3u8)/.test(e.name)).length',
    );
    return {
      items,
      segmented: vtt.lines,
      ttml: ttml.lines,
      toast: vtt.toast,
      mediaRequestsUnchanged: media <= 1,
    };
  },
};

// ---------------------------------------------------------------- helpers

async function httpJson(url) {
  return (await fetch(url)).json();
}

/**
 * WebDriver cannot drive moz-extension:// pages, so the e2e build exposes a window-message hook
 * on fixture pages (src/utils/e2e-hooks.ts). Production builds do not contain it.
 */
async function e2eCall(ctx, op, payload) {
  const { driver } = ctx;
  if (!(await driver.getCurrentUrl()).startsWith(ctx.base)) {
    await driver.get(`${ctx.base}/player.html`);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('${HOST}')`), 8000);
  }
  const res = await driver.executeAsyncScript(
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
  if (res.error) throw new Error(`e2e hook ${op}: ${res.error}`);
  return res;
}

/** Settings live in storage; content scripts and the background pick changes up without reloads. */
async function setModel(ctx, model, _reload = true, baseUrl = 'http://localhost:5556/v1') {
  await e2eCall(ctx, 'settings', { provider: 'openai-compat', openai: { baseUrl, model } });
}

async function shadowFind(ctx, selector) {
  return ctx.driver.wait(
    async () =>
      ctx.driver.executeScript(
        `return document.querySelector('${HOST}').shadowRoot.querySelector(arguments[0])`,
        selector,
      ),
    4000,
    `no ${selector}`,
  );
}

async function shadowFindAll(ctx, selector) {
  return ctx.driver.executeScript(
    `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll(arguments[0])]`,
    selector,
  );
}

async function waitCard(ctx, fn, what, timeout = 4000) {
  return ctx.driver.wait(
    async () => {
      const c = await ctx.driver.executeScript(`
        const card = document.querySelector('${HOST}')?.shadowRoot?.querySelector('.card');
        return card ? { status: card.dataset.status, text: card.textContent.replace(/\\s+/g, ' ').trim() } : null;
      `);
      return c && fn(c) ? c : null;
    },
    timeout,
    `timed out waiting for ${what}`,
  );
}

async function openMenu(ctx) {
  const video = await ctx.driver.findElement(ctx.By.css('video'));
  await ctx.driver
    .actions()
    .move({ origin: video, x: -300, y: -200 })
    .move({ origin: video, x: -120, y: -60 })
    .perform();
  const open = await ctx.driver.executeScript(
    `return !!document.querySelector('${HOST}').shadowRoot.querySelector('.menu')`,
  );
  if (!open) await (await shadowFind(ctx, '.fab')).click();
  await shadowFind(ctx, '.menu');
}

async function clickMenuButton(ctx, text) {
  const b = await ctx.driver.wait(
    async () =>
      ctx.driver.executeScript(
        `return [...document.querySelector('${HOST}').shadowRoot.querySelectorAll('.menu button')].find((b) => b.textContent.includes(arguments[0]))`,
        text,
      ),
    4000,
    `no menu item ${text}`,
  );
  await b.click();
}

async function openMenuItem(ctx, text) {
  await openMenu(ctx);
  await clickMenuButton(ctx, text);
}

async function waitDialog(ctx, fn, what) {
  return ctx.driver.wait(
    async () => {
      const t = await ctx.driver.executeScript(
        `const d = document.querySelector('${HOST}').shadowRoot.querySelector('.dialog .body'); return d ? d.textContent : ''`,
      );
      return fn(t) ? t.trim() : null;
    },
    6000,
    `dialog: ${what}`,
  );
}

export { probe, waitFor, shadowFind, shadowFindAll, waitCard, openMenu, clickMenuButton, httpJson };
