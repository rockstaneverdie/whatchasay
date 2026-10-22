<script lang="ts">
  import { onMount } from 'svelte';
  import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../../core/storage/settings';
  import { pageT, type PageKey } from '../../i18n/pages';
  import SettingsForm from './SettingsForm.svelte';

  type Tab = 'settings' | 'phrases' | 'data';

  let settings = $state<Settings | null>(null);
  let tab = $state<Tab>((location.hash.slice(1) as Tab) || 'settings');

  const t = (key: PageKey, params?: Record<string, string | number>) =>
    pageT(settings?.uiLang ?? DEFAULT_SETTINGS.uiLang, key, params);

  onMount(() => {
    void loadSettings().then((s) => (settings = s));
    const onHash = () => (tab = (location.hash.slice(1) as Tab) || 'settings');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });

  $effect(() => {
    document.title = t('opt.title');
    document.documentElement.lang = settings?.uiLang ?? 'ru';
  });
</script>

<main>
  <header>
    <h1>Subtext</h1>
    <nav aria-label="sections">
      {#each ['settings', 'phrases', 'data'] as const as id (id)}
        <a href="#{id}" aria-current={tab === id ? 'page' : undefined}>{t(`opt.tab.${id}`)}</a>
      {/each}
    </nav>
  </header>

  {#if settings}
    {#if tab === 'settings'}
      <SettingsForm bind:settings {t} />
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 20px 64px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 24px;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 24px;
  }

  nav {
    display: flex;
    gap: 14px;
  }

  nav a {
    text-decoration: none;
    color: var(--muted);
    font-weight: 600;
    padding-bottom: 2px;
  }

  nav a[aria-current='page'] {
    color: var(--text);
    border-bottom: 2px solid var(--accent);
  }
</style>
