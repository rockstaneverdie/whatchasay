// M4b scenarios (TZ 1.1, FR-V5…V10): third-party and embedded player patterns, all local.
import { Key } from 'selenium-webdriver';
import {
  clickMenuButton,
  dropFixture,
  e2eCall,
  openMenu,
  probe,
  setModel,
  shadowFind,
  waitCard,
  waitFor,
} from './e2e-scenarios.mjs';

const HOST = 'subtext-overlay';

const hostIn = (ctx, timeout = 8000) =>
  ctx.driver.wait(
    async () => ctx.driver.executeScript(`return !!document.querySelector('${HOST}')`),
    timeout,
    'overlay',
  );

/** Facts about an overlay that lives inside a web component's shadow root. */
const SHADOW_PROBE = `
  const player = document.querySelector('fancy-player');
  const host = player && player.shadowRoot && player.shadowRoot.querySelector('${HOST}');
  if (!host) return null;
  const root = host.shadowRoot;
  const fs = player.shadowRoot.fullscreenElement;
  return {
    parent: host.parentElement && host.parentElement.id,
    lines: root.querySelectorAll('.line').length,
    panel: !!root.querySelector('.panel'),
    fullscreen: !!fs && fs.contains(host),
  };
`;

export const m4bScenarios = {
  async 'm4b-xorigin-hotkeys'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/players/xorigin.html`);
    const frame = await driver.findElement(By.id('embed'));
    const topHasHost = await driver.executeScript(`return !!document.querySelector('${HOST}')`);
    await driver.switchTo().frame(frame);
    await hostIn(ctx);
    if ((await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt')) !== true)
      throw new Error('drop failed');
    await waitFor(ctx, (q) => q.lines === 29, 'track in the cross-origin frame');
    await driver.executeScript(`const v = document.querySelector('video'); v.pause(); v.currentTime = 20;`);
    await setModel(ctx, 'ok');

    // Focus in the parent page; hotkeys must still reach the frame (FR-V5).
    await driver.switchTo().defaultContent();
    await driver.findElement(By.id('outside')).click();
    await driver.actions().sendKeys(']').perform();
    await driver.switchTo().frame(frame);
    const offset = await waitFor(
      ctx,
      (q) => q.toast && q.toast.includes('+0.1'),
      'offset from the parent page',
    );
    await driver.switchTo().defaultContent();
    await driver.actions().keyDown(Key.ALT).sendKeys('l').keyUp(Key.ALT).perform();
    await driver.switchTo().frame(frame);
    await waitFor(ctx, (q) => !q.panel, 'Alt+L from the parent hides the panel');
    await driver.switchTo().defaultContent();
    await driver.actions().keyDown(Key.ALT).sendKeys('l').keyUp(Key.ALT).perform();
    await driver.switchTo().frame(frame);
    await waitFor(ctx, (q) => q.panel, 'Alt+L again shows it');

    // A card opened in the frame; Space pressed in the parent closes it and resumes.
    await driver.executeScript(`document.querySelector('video').currentTime = 14.4`);
    await driver.sleep(300);
    await (await shadowFind(ctx, '.panel .line.active .w')).click();
    await waitCard(ctx, (c) => c.status === 'done', 'card in the frame', 8000);
    await driver.switchTo().defaultContent();
    await driver.findElement(By.id('outside')).click();
    await ctx.sleep(300);
    await driver.actions().sendKeys(Key.SPACE).perform();
    await ctx.sleep(700);
    const scrollY = await driver.executeScript('return window.scrollY');
    await driver.switchTo().frame(frame);
    const after = await driver.executeScript(
      `return { paused: document.querySelector('video').paused, card: !!document.querySelector('${HOST}').shadowRoot.querySelector('.card') }`,
    );
    await driver.executeScript(`document.querySelector('video').pause()`);
    await driver.switchTo().defaultContent();
    await ctx.shot('m4b-xorigin');
    if (topHasHost) throw new Error('no overlay expected in the parent page');
    if (after.card || after.paused) throw new Error(`Space from parent: ${JSON.stringify(after)}`);
    if (scrollY !== 0) throw new Error(`the parent page scrolled (${scrollY}px): Space was not swallowed`);
    return { offset: offset.toast, spaceFromParent: after, parentScrollY: scrollY };
  },

  async 'm4b-shadow-dom-player'(ctx) {
    const { driver } = ctx;
    // 880 px player: a 34 % panel would be < 320 px, so 7.7 picks compact mode; check the side panel here.
    await e2eCall(ctx, 'settings', { panel: { compact: 'off' } });
    await driver.get(`${ctx.base}/players/shadow-player.html`);
    await driver.wait(
      async () => driver.executeScript(SHADOW_PROBE),
      8000,
      'overlay inside the open shadow root',
    );
    const dropped = await driver.executeAsyncScript(`
      const done = arguments[0];
      fetch('/sample.srt').then((r) => r.arrayBuffer()).then((buf) => {
        const v = document.querySelector('fancy-player').shadowRoot.querySelector('video');
        const r = v.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.items.add(new File([buf], 'Maple.Street.S01E03.srt'));
        const o = { dataTransfer: dt, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true, composed: true };
        v.dispatchEvent(new DragEvent('dragover', o));
        done(!v.dispatchEvent(new DragEvent('drop', o)));
      });
    `);
    if (!dropped) throw new Error('drop inside the shadow root was not handled');
    await driver.wait(
      async () => (await driver.executeScript(SHADOW_PROBE))?.lines === 29,
      6000,
      'panel with 29 lines',
    );
    // The component's own fullscreen targets an element inside its shadow root.
    const fsButton = await driver.executeScript(
      `return document.querySelector('fancy-player').shadowRoot.getElementById('wc-fs')`,
    );
    await fsButton.click();
    await ctx.sleep(1200);
    const fs = await driver.executeScript(SHADOW_PROBE);
    await ctx.shot('m4b-shadow-fullscreen');
    await driver.executeScript('return document.fullscreenElement && document.exitFullscreen()');
    await ctx.sleep(500);
    await e2eCall(ctx, 'settings', { panel: { compact: 'auto' } });
    if (!fs.fullscreen || !fs.panel) throw new Error(`fullscreen: ${JSON.stringify(fs)}`);
    return fs;
  },

  async 'm4b-closed-shadow-player'(ctx) {
    const { driver } = ctx;
    await driver.get(`${ctx.base}/players/closed-player.html`);
    await ctx.sleep(2500);
    const host = await driver.executeScript(`return !!document.querySelector('${HOST}')`);
    const logs = (await e2eCall(ctx, 'logs')).result.filter((l) => l.startsWith('error'));
    if (host) throw new Error('mounted into a closed player');
    if (logs.length) throw new Error(`errors: ${logs.join(' | ')}`);
    return { mounted: false, errors: 0 };
  },

  async 'm4b-layered-player'(ctx) {
    const { driver, By } = ctx;
    await setModel(ctx, 'ok');
    await driver.get(`${ctx.base}/players/layered-player.html`);
    await hostIn(ctx);
    // FR-V7: the click catcher covers the media box, so the overlay must move up to #player.
    await driver.wait(
      async () =>
        driver
          .executeScript(`return document.querySelector('${HOST}').parentElement.id`)
          .then((id) => id === 'player'),
      4000,
      'overlay was not lifted above the click catcher',
    );
    if ((await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt')) !== true)
      throw new Error('drop failed');
    await waitFor(ctx, (q) => q.lines === 29, 'panel');
    await driver.executeScript(`document.querySelector('video').currentTime = 14.4`);
    await ctx.sleep(300);
    // Launcher reachable (WebDriver refuses to click obscured elements).
    await openMenu(ctx);
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await (await shadowFind(ctx, '.panel .line.active .w')).click();
    await waitCard(ctx, (c) => c.status === 'done', 'card', 8000);
    const togglesAtCard = await driver.executeScript('return window.siteToggles');
    // FR-V8: the page listens to Space on window in the capture phase; ours runs first.
    await driver.actions().sendKeys(Key.SPACE).perform();
    await ctx.sleep(500);
    const afterSpace = await driver.executeScript(
      `return { paused: document.querySelector('video').paused, toggles: window.siteToggles, card: !!document.querySelector('${HOST}').shadowRoot.querySelector('.card') }`,
    );
    await driver.executeScript(`document.querySelector('video').pause()`);
    // FR-V10: our fullscreen takes the lifted container, so the panel comes along.
    await openMenu(ctx);
    await clickMenuButton(ctx, 'Полный экран с субтитрами');
    await ctx.sleep(1200);
    const fs = await driver.executeScript(
      `return { id: document.fullscreenElement && document.fullscreenElement.id, panel: !!document.querySelector('${HOST}').shadowRoot.querySelector('.panel') }`,
    );
    await ctx.shot('m4b-layered-fullscreen');
    await driver.executeScript('return document.fullscreenElement && document.exitFullscreen()');
    await ctx.sleep(500);
    void By;
    if (togglesAtCard !== 0) throw new Error(`click reached the site's catcher (${togglesAtCard})`);
    if (afterSpace.toggles !== 0 || afterSpace.card || afterSpace.paused)
      throw new Error(`Space: ${JSON.stringify(afterSpace)}`);
    if (fs.id !== 'player' || !fs.panel) throw new Error(`fullscreen: ${JSON.stringify(fs)}`);
    return { lifted: 'player', afterSpace, fullscreen: fs };
  },

  async 'm4b-same-element-new-episode'(ctx) {
    const { driver, By } = ctx;
    // blob: source swapped in the same <video> (FR-V9).
    await driver.get(`${ctx.base}/player.html?blob=1`);
    await driver.wait(
      async () =>
        driver.executeScript(`return document.querySelector('video').currentSrc.startsWith('blob:')`),
      8000,
    );
    await hostIn(ctx);
    await ctx.sleep(500);
    await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt');
    await waitFor(ctx, (q) => q.lines === 29, 'track on a blob: source');
    await driver.findElement(By.id('next-blob')).click();
    const blob = await waitFor(ctx, (q) => q.lines === 0, 'track reset after the blob swap', 6000);

    // URL change without touching the <video> (SPA navigation).
    await driver.get(`${ctx.base}/player.html?pushstate=1`);
    await hostIn(ctx);
    await ctx.sleep(500);
    await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt');
    await waitFor(ctx, (q) => q.lines === 29, 'track before navigation');
    await driver.findElement(By.id('next-url')).click();
    const url = await waitFor(ctx, (q) => q.lines === 0, 'track reset after the URL change', 6000);
    return { blobToast: blob.toast, urlToast: url.toast };
  },

  async 'm4b-video-element-fullscreen-hint'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/player.html`);
    await hostIn(ctx);
    await waitFor(ctx, (q) => q.lines === 29, 'restored track', 8000).catch(async () => {
      await dropFixture(ctx, '/sample.srt', 'Maple.Street.S01E03.srt');
      return waitFor(ctx, (q) => q.lines === 29, 'track');
    });
    await driver.findElement(By.id('fs-video')).click();
    await ctx.sleep(1000);
    const videoFs = await driver.executeScript(
      `return document.fullscreenElement === document.querySelector('video')`,
    );
    await driver.executeScript('return document.exitFullscreen()');
    const hint = await waitFor(
      ctx,
      (q) => q.toast && q.toast.includes('самого видео'),
      'hint after video fullscreen',
      4000,
    );
    const button = await shadowFind(ctx, '.toast button');
    await button.click();
    await ctx.sleep(1200);
    const ours = await probe(ctx);
    await ctx.shot('m4b-own-fullscreen');
    await driver.executeScript('return document.fullscreenElement && document.exitFullscreen()');
    await ctx.sleep(500);
    if (!videoFs) throw new Error('the fixture did not enter video fullscreen');
    if (!ours.fullscreen || !ours.panel) throw new Error(`own fullscreen: ${JSON.stringify(ours)}`);
    return { hint: hint.toast, ownFullscreen: { panel: ours.panel, rect: ours.rect } };
  },
};
