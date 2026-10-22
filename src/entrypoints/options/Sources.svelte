<script lang="ts">
  import { onMount } from 'svelte';
  import { sendBg, type BgResponses } from '../../core/messaging/types';
  import { INTERCEPT_PERMISSION } from '../../core/sources/sniffer';
  import { osOrigins } from '../../core/sources/service';
  import { loadSecrets, saveSecrets } from '../../core/storage/secrets';
  import { saveSettings, type Settings } from '../../core/storage/settings';
  import type { PageKey } from '../../i18n/pages';

  interface Props {
    settings: Settings;
    t: (key: PageKey, params?: Record<string, string | number>) => string;
  }

  let { settings = $bindable(), t }: Props = $props();

  let apiKey = $state('');
  let showKey = $state(false);
  let permitted = $state(true);
  let status = $state<BgResponses['os/status'] | null>(null);
  let check = $state<{ ok: boolean; text: string } | null>(null);
  let username = $state('');
  let password = $state('');
  let loginNote = $state('');
  let intercept = $state(false);
  let keyTimer: ReturnType<typeof setTimeout> | undefined;

  const origins = $derived(osOrigins(settings.sources.osBaseUrl));

  const refresh = async () => {
    status = await sendBg({ type: 'os/status' });
    permitted = await browser.permissions.contains({ origins }).catch(() => false);
    intercept = await browser.permissions
      .contains({ permissions: [...INTERCEPT_PERMISSION.permissions] })
      .catch(() => false);
  };

  onMount(() => {
    void loadSecrets().then((s) => (apiKey = s.osApiKey ?? ''));
    void refresh();
  });

  function onKeyInput() {
    check = null;
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => void saveSecrets({ osApiKey: apiKey.trim() }).then(refresh), 300);
  }

  async function grant() {
    permitted = await browser.permissions.request({ origins });
  }

  async function save() {
    settings = await saveSettings({ sources: $state.snapshot(settings.sources) });
  }

  async function runCheck() {
    clearTimeout(keyTimer);
    await saveSecrets({ osApiKey: apiKey.trim() });
    const r = await sendBg({ type: 'os/search', params: { query: 'test', languages: 'en' } });
    check = r.ok
      ? { ok: true, text: t('src.os.ok') }
      : { ok: false, text: t('opt.check.fail', { msg: r.message }) };
    await refresh();
  }

  async function login(e: SubmitEvent) {
    e.preventDefault();
    const r = await sendBg({ type: 'os/login', username: username.trim(), password });
    password = '';
    loginNote = r.ok ? t('src.os.loggedIn', { user: r.user }) : t('opt.check.fail', { msg: r.message });
    await refresh();
  }

  async function logout() {
    await sendBg({ type: 'os/logout' });
    loginNote = '';
    await refresh();
  }

  /** FR-S8 opt-in. Turning it off removes only webRequest, never the host access content scripts need. */
  async function toggleIntercept(e: Event) {
    const on = (e.currentTarget as HTMLInputElement).checked;
    if (on) {
      intercept = await browser.permissions.request({
        permissions: [...INTERCEPT_PERMISSION.permissions],
        origins: INTERCEPT_PERMISSION.origins,
      });
    } else {
      await browser.permissions.remove({ permissions: [...INTERCEPT_PERMISSION.permissions] });
      intercept = false;
    }
  }
</script>

<section>
  <h2>OpenSubtitles</h2>
  <p class="muted">{t('src.os.about')}</p>
  <label class="field">
    <span>{t('src.os.key')}</span>
    <span class="inline">
      <input
        type={showKey ? 'text' : 'password'}
        autocomplete="off"
        spellcheck="false"
        bind:value={apiKey}
        oninput={onKeyInput}
      />
      <button type="button" onclick={() => (showKey = !showKey)}
        >{showKey ? t('opt.key.hide') : t('opt.key.show')}</button
      >
    </span>
    <span class="muted">{t('src.os.keyWhere')} {t('opt.key.hint')}</span>
  </label>
  {#if !permitted}
    <p><button type="button" class="primary" onclick={grant}>{t('src.os.grant')}</button></p>
  {:else}
    <p class="ok">✓ {t('src.os.granted')}</p>
  {/if}
  <p class="inline">
    <button type="button" onclick={runCheck} disabled={!apiKey.trim()}>{t('opt.check')}</button>
    {#if check}<span class={check.ok ? 'ok' : 'err'} role="status">{check.text}</span>{/if}
  </p>
  <label class="field">
    <span>{t('src.os.langs')}</span>
    <input bind:value={settings.sources.osLanguages} onchange={save} spellcheck="false" />
  </label>

  <h3>{t('src.os.account')}</h3>
  {#if status?.loggedIn}
    <p class="inline">
      <span>{t('src.os.loggedIn', { user: status.user ?? '' })}</span>
      <button type="button" onclick={logout}>{t('src.os.logout')}</button>
    </p>
  {:else}
    <p class="muted">{t('src.os.accountWhy')}</p>
    <form class="inline" onsubmit={login}>
      <input
        placeholder={t('src.os.user')}
        aria-label={t('src.os.user')}
        autocomplete="username"
        bind:value={username}
      />
      <input
        type="password"
        placeholder={t('src.os.password')}
        aria-label={t('src.os.password')}
        autocomplete="current-password"
        bind:value={password}
      />
      <button type="submit" disabled={!username.trim() || !password}>{t('src.os.login')}</button>
    </form>
  {/if}
  {#if loginNote}<p class="muted" role="status">{loginNote}</p>{/if}

  <label class="check">
    <input type="checkbox" bind:checked={settings.sources.autoSync} onchange={save} />
    {t('src.autoSync')}
  </label>
</section>

<section>
  <h2>{t('src.sniff')}</h2>
  <label class="check">
    <input type="checkbox" checked={intercept} onchange={toggleIntercept} />
    {t('src.sniff.toggle')}
  </label>
  <p class="muted">{t('src.sniff.about')}</p>
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
    margin: 0 0 8px;
    font-size: 17px;
  }

  h3 {
    margin: 16px 0 6px;
    font-size: 15px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 10px 0;
  }

  .field > span:first-child {
    font-weight: 600;
    font-size: 14px;
  }

  .inline {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .inline input {
    flex: 1;
    min-width: 180px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 4px;
  }
</style>
