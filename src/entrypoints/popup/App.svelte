<script lang="ts">
  import { onMount } from 'svelte';
  import { sendBg, type BgResponses, type TabRequest, type TabStatus } from '../../core/messaging/types';
  import { DEFAULT_SETTINGS, loadSettings, type UiLang } from '../../core/storage/settings';
  import { pageT, type PageKey } from '../../i18n/pages';
  import Logo from '../../ui/brand/Logo.svelte';

  let lang = $state<UiLang>(DEFAULT_SETTINGS.uiLang);
  let tabId = $state<number | null>(null);
  let status = $state<TabStatus | null>(null);
  let loaded = $state(false);
  let siteAccess = $state(true);
  let provider = $state<BgResponses['provider/status'] | null>(null);

  const t = (key: PageKey, params?: Record<string, string | number>) => pageT(lang, key, params);

  async function toTab<T>(msg: TabRequest): Promise<T | null> {
    if (tabId === null) return null;
    try {
      return ((await browser.tabs.sendMessage(tabId, msg)) as T | undefined) ?? null;
    } catch {
      return null; // No content script in this tab, or no frame with a video answered.
    }
  }

  onMount(async () => {
    lang = (await loadSettings()).uiLang;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    siteAccess = await browser.permissions.contains({ origins: ['<all_urls>'] }).catch(() => true);
    [status, provider] = await Promise.all([
      toTab<TabStatus>({ type: 'ui/status' }),
      sendBg({ type: 'provider/status' }).catch(() => null),
    ]);
    loaded = true;
  });

  async function grant() {
    siteAccess = await browser.permissions.request({ origins: ['<all_urls>'] });
  }

  async function togglePanel() {
    status = (await toTab<TabStatus>({ type: 'ui/toggle-panel' })) ?? status;
  }

  // Firefox closes a popup when a file picker opens, so the picker lives in a small window.
  async function openUpload() {
    if (tabId === null) return;
    await browser.windows.create({
      url: `${browser.runtime.getURL('/upload.html')}?tab=${tabId}`,
      type: 'popup',
      width: 440,
      height: 260,
    });
    window.close();
  }

  async function openOptions(section: 'settings' | 'phrases') {
    if (section === 'settings') await browser.runtime.openOptionsPage();
    else await browser.tabs.create({ url: browser.runtime.getURL('/options.html#phrases') });
    window.close();
  }
</script>

<main>
  <header>
    <Logo class="logo" label="WhatchaSay?" />
  </header>

  {#if !loaded}
    <p class="muted">…</p>
  {:else}
    {#if !siteAccess}
      <section class="card notice">
        <p>{t('popup.noAccess')}</p>
        <button type="button" class="primary" onclick={grant}>{t('popup.grant')}</button>
      </section>
    {/if}

    {#if status?.hasVideo}
      <section class="card">
        <div class="status">
          <span class="dot" class:on={!!status.trackLabel}></span>
          <div>
            <div class="label">{t('popup.videoFound')}</div>
            <div class="value">
              {#if status.trackLabel}
                {t('popup.track', { label: status.trackLabel, n: status.cues ?? 0 })}
              {:else}
                <span class="muted">{t('popup.noTrack')}</span>
              {/if}
            </div>
          </div>
        </div>
        <button type="button" class="primary" onclick={openUpload}>{t('popup.load')}</button>
        <button
          type="button"
          class="switch"
          role="switch"
          aria-checked={status.panelVisible}
          title={t('popup.toggle')}
          onclick={togglePanel}
        >
          <span>{t('popup.panel')}</span>
          <span class="track" aria-hidden="true"><span class="knob"></span></span>
        </button>
      </section>
    {:else}
      <section class="card">
        <p class="muted">{status?.closedPlayer ? t('popup.closedPlayer') : t('popup.noVideo')}</p>
      </section>
    {/if}

    <footer>
      <p class="provider">
        <span class="dot small" class:on={provider?.configured} class:warn={!provider?.configured}></span>
        {#if provider?.configured}
          {t('popup.provider', { provider: provider.provider, model: provider.model })}
        {:else}
          {t('popup.noKey')}
        {/if}
      </p>
      <nav>
        <button type="button" class="ghost" onclick={() => openOptions('settings')}
          >{t('popup.settings')}</button
        >
        <button type="button" class="ghost" onclick={() => openOptions('phrases')}
          >{t('popup.phrases')}</button
        >
      </nav>
    </footer>
  {/if}
</main>

<style>
  /* Brand: black and white only (brand/README.md); red is kept for the one warning state. */
  main {
    --ink: #000;
    --paper: #fff;
    --soft: #f2f2f2;
    --rule: #e3e3e3;
    --dim: #6b6b6b;
    --alert: #c0262d;
    width: 320px;
    padding: 16px;
    background: var(--paper);
    color: var(--ink);
    font-family:
      Inter,
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    main {
      --ink: #fff;
      --paper: #000;
      --soft: #151515;
      --rule: #2a2a2a;
      --dim: #9a9a9a;
      --alert: #ff6b6b;
    }
  }

  :global(body) {
    background: #fff;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      background: #000;
    }
  }

  header {
    padding: 0 0 14px;
    margin-left: -4px;
  }

  header :global(.logo) {
    display: block;
    height: 34px;
    width: auto;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--dim);
    font-size: 13px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 14px;
    background: var(--soft);
  }

  .notice {
    margin-bottom: 10px;
    font-size: 13px;
  }

  .status {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--dim);
  }

  .value {
    margin-top: 2px;
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .dot {
    flex: none;
    box-sizing: border-box;
    width: 10px;
    height: 10px;
    margin-top: 3px;
    border: 2px solid var(--ink);
    border-radius: 50%;
  }

  .dot.on {
    background: var(--ink);
  }

  .dot.small {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin: 0 6px 1px 0;
    vertical-align: middle;
  }

  .dot.warn {
    border-color: var(--alert);
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .primary {
    padding: 10px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--ink);
    color: var(--paper);
    font-weight: 600;
  }

  .primary:hover {
    opacity: 0.85;
  }

  .switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0 0;
    border: 0;
    background: transparent;
    font-size: 14px;
  }

  .switch .track {
    position: relative;
    box-sizing: border-box;
    width: 36px;
    height: 20px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    transition: background 0.15s;
  }

  .switch .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ink);
    transition: transform 0.15s;
  }

  .switch[aria-checked='true'] .track {
    background: var(--ink);
  }

  .switch[aria-checked='true'] .knob {
    background: var(--paper);
    transform: translateX(16px);
  }

  footer {
    margin-top: 14px;
  }

  .provider {
    font-size: 12px;
    color: var(--dim);
  }

  nav {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .ghost {
    flex: 1;
    padding: 8px 10px;
    border: 1.5px solid var(--rule);
    border-radius: 10px;
    background: transparent;
    font-weight: 500;
  }

  .ghost:hover {
    border-color: var(--ink);
  }

  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .switch .track,
    .switch .knob {
      transition: none;
    }
  }
</style>
