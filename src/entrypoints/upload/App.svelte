<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabStatus } from '../../core/messaging/types';
  import { DEFAULT_SETTINGS, loadSettings, type UiLang } from '../../core/storage/settings';
  import { pageT, type PageKey } from '../../i18n/pages';

  /** FR-S1 (popup button): picks a file and hands its bytes to the content script of the tab. */
  let lang = $state<UiLang>(DEFAULT_SETTINGS.uiLang);
  let result = $state<'done' | 'fail' | null>(null);
  const tabId = Number(new URLSearchParams(location.search).get('tab'));

  const t = (key: PageKey) => pageT(lang, key);

  onMount(() => {
    void loadSettings().then((s) => (lang = s.uiLang));
  });

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !Number.isFinite(tabId)) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    try {
      const status = (await browser.tabs.sendMessage(tabId, {
        type: 'ui/load-file',
        name: file.name,
        bytes,
      })) as TabStatus | undefined;
      result = status?.hasVideo ? 'done' : 'fail';
    } catch {
      result = 'fail';
    }
    if (result === 'done') setTimeout(() => window.close(), 900);
  }
</script>

<main>
  <h1>{t('upload.title')}</h1>
  <p class="muted">{t('upload.hint')}</p>
  <input type="file" accept=".srt,.vtt" onchange={onFile} />
  {#if result === 'done'}<p class="ok">{t('upload.done')}</p>{/if}
  {#if result === 'fail'}<p class="err">{t('upload.fail')}</p>{/if}
</main>

<style>
  main {
    padding: 16px 18px;
  }

  h1 {
    margin: 0 0 6px;
    font-size: 18px;
  }
</style>
