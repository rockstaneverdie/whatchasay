<script lang="ts">
  import { onMount } from 'svelte';
  import { sendBg, type BgResponses, type TabRequest, type TabStatus } from '../../core/messaging/types';
  import { DEFAULT_SETTINGS, loadSettings, type UiLang } from '../../core/storage/settings';
  import { pageT, type PageKey } from '../../i18n/pages';

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
  <h1>WhatchaSay?</h1>
  {#if !loaded}
    <p class="muted">…</p>
  {:else}
    {#if !siteAccess}
      <p class="warn">{t('popup.noAccess')}</p>
      <button type="button" class="primary" onclick={grant}>{t('popup.grant')}</button>
    {/if}

    {#if status?.hasVideo}
      <p>
        {#if status.trackLabel}
          {t('popup.track', { label: status.trackLabel, n: status.cues ?? 0 })}
        {:else}
          <span class="muted">{t('popup.noTrack')}</span>
        {/if}
      </p>
      <div class="stack">
        <button type="button" class="primary" onclick={openUpload}>{t('popup.load')}</button>
        <button type="button" onclick={togglePanel} aria-pressed={status.panelVisible}
          >{t('popup.toggle')}</button
        >
      </div>
    {:else}
      <p class="muted">{status?.closedPlayer ? t('popup.closedPlayer') : t('popup.noVideo')}</p>
    {/if}

    <p class="provider">
      {#if provider?.configured}
        {t('popup.provider', { provider: provider.provider, model: provider.model })}
      {:else}
        <span class="warn">{t('popup.noKey')}</span>
      {/if}
    </p>
    <div class="row">
      <button type="button" onclick={() => openOptions('settings')}>{t('popup.settings')}</button>
      <button type="button" onclick={() => openOptions('phrases')}>{t('popup.phrases')}</button>
    </div>
  {/if}
</main>

<style>
  main {
    width: 300px;
    padding: 14px 16px 16px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row button {
    flex: 1;
  }

  .provider {
    margin: 14px 0 8px;
    font-size: 13px;
  }

  .warn {
    color: var(--err);
    font-size: 13px;
  }
</style>
