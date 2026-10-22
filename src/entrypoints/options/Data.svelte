<script lang="ts">
  import { onMount } from 'svelte';
  import { cacheStats, clearCache, exportCache, importCache, pruneCache } from '../../core/storage/cache';
  import { saveSettings, type Settings } from '../../core/storage/settings';
  import type { PageKey } from '../../i18n/pages';
  import { download } from './download';

  interface Props {
    settings: Settings;
    t: (key: PageKey, params?: Record<string, string | number>) => string;
  }

  let { settings = $bindable(), t }: Props = $props();

  let stats = $state({ entries: 0, bytes: 0 });
  let note = $state('');

  const refresh = async () => (stats = await cacheStats());

  onMount(() => {
    void refresh();
  });

  async function setLimit() {
    settings = await saveSettings({ cacheMaxMB: settings.cacheMaxMB });
    await pruneCache(settings.cacheMaxMB * 1024 * 1024);
    await refresh();
  }

  async function clear() {
    await clearCache();
    await refresh();
  }

  async function exportJson() {
    download(
      `subtext-cache-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(await exportCache()),
      'application/json',
    );
  }

  async function onImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const n = await importCache(JSON.parse(await file.text()), settings.cacheMaxMB * 1024 * 1024);
      note = t('opt.cache.imported', { n });
    } catch (err) {
      note = String(err);
    }
    await refresh();
  }
</script>

<section>
  <h2>{t('opt.cache')}</h2>
  <p>{t('opt.cache.stats', { n: stats.entries, mb: (stats.bytes / 1024 / 1024).toFixed(2) })}</p>
  <label class="field">
    <span>{t('opt.cache.limit')}</span>
    <input type="number" min="1" step="1" bind:value={settings.cacheMaxMB} onchange={setLimit} />
  </label>
  <div class="row">
    <button type="button" onclick={clear}>{t('opt.cache.clear')}</button>
    <button type="button" onclick={exportJson}>{t('opt.cache.export')}</button>
    <label class="file">
      {t('opt.cache.import')}
      <input type="file" accept="application/json,.json" onchange={onImport} />
    </label>
  </div>
  {#if note}<p class="muted" role="status">{note}</p>{/if}
</section>

<section>
  <h2>{t('opt.privacy')}</h2>
  <p>{t('opt.privacy.text')}</p>
</section>

<style>
  section {
    margin: 0 0 16px;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
  }

  h2 {
    margin: 0 0 10px;
    font-size: 17px;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
  }

  .field input {
    width: 100px;
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .file {
    position: relative;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
  }

  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
