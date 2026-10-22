// Scenarios for scripts/e2e.mjs. Each returns optional details or throws.

const HOST = 'subtext-overlay';

/** Runs in the page: returns facts about the overlay host. */
const probe = (host) => `
  const host = document.querySelector('${host}');
  if (!host) return null;
  const r = host.getBoundingClientRect();
  return {
    parent: host.parentElement && host.parentElement.id,
    hasShadow: !!host.shadowRoot,
    text: host.shadowRoot ? host.shadowRoot.textContent.trim().slice(0, 80) : '',
    rect: [r.x, r.y, r.width, r.height].map(Math.round),
    fullscreen: !!document.fullscreenElement && document.fullscreenElement.contains(host),
  };
`;

async function waitForHost(ctx, timeout = 8000) {
  const { driver } = ctx;
  return driver.wait(async () => driver.executeScript(probe(HOST)), timeout, 'overlay host did not appear');
}

export const scenarios = {
  async 'm0-hello-overlay'(ctx) {
    const { driver, By } = ctx;
    await driver.get(`${ctx.base}/player.html`);
    const info = await waitForHost(ctx);
    if (!info.hasShadow) throw new Error('no shadow root');
    if (info.parent !== 'player') throw new Error(`host mounted in #${info.parent}, expected #player`);
    await ctx.shot('m0-normal');

    await driver.findElement(By.id('fs')).click();
    await ctx.sleep(1200);
    const fs = await driver.executeScript(probe(HOST));
    await ctx.shot('m0-fullscreen');
    if (!fs.fullscreen) throw new Error('overlay is not inside the fullscreen element');
    await driver.executeScript('return document.exitFullscreen()');
    await ctx.sleep(600);
    return { normal: info, fullscreen: fs };
  },
};
