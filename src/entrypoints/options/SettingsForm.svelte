<script lang="ts">
  import { onMount } from 'svelte';
  import { originPattern } from '../../core/ai/providers';
  import type { ModelInfo } from '../../core/ai/types';
  import {
    DEFAULT_HOTKEYS,
    formatHotkey,
    hotkeyFromEvent,
    type HotkeyAction,
  } from '../../core/player/hotkeys';
  import { sendBg } from '../../core/messaging/types';
  import { loadSecrets, saveSecrets } from '../../core/storage/secrets';
  import { saveSettings, type Settings, type SettingsPatch } from '../../core/storage/settings';
  import type { PageKey } from '../../i18n/pages';

  interface Props {
    settings: Settings;
    t: (key: PageKey, params?: Record<string, string | number>) => string;
  }

  let { settings = $bindable(), t }: Props = $props();

  const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;
  const PRESETS = [
    { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
    { label: 'Ollama', url: 'http://localhost:11434/v1' },
    { label: 'LM Studio', url: 'http://localhost:1234/v1' },
  ];
  const HOTKEY_ACTIONS = Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[];

  let geminiKey = $state('');
  let openaiKey = $state('');
  let showKey = $state(false);
  let models = $state<ModelInfo[]>([]);
  let check = $state<{ ok: boolean; text: string } | null>(null);
  let checking = $state(false);
  let savedFlash = $state(false);
  let permitted = $state(true);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let keyTimer: ReturnType<typeof setTimeout> | undefined;

  const origin = $derived(originPattern(settings.openai.baseUrl));

  onMount(() => {
    void loadSecrets().then((s) => {
      geminiKey = s.geminiKey ?? '';
      openaiKey = s.openaiKey ?? '';
    });
  });

  $effect(() => {
    const o = origin;
    if (settings.provider !== 'openai-compat' || !o) return;
    void browser.permissions.contains({ origins: [o] }).then((v) => (permitted = v));
  });

  function flash() {
    savedFlash = true;
    setTimeout(() => (savedFlash = false), 1200);
  }

  function persist(patch: SettingsPatch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveSettings(patch).then((s) => {
        settings = s;
        flash();
      });
    }, 250);
  }

  /** Writes the whole current form; simple and always consistent. */
  function save() {
    persist($state.snapshot(settings) as SettingsPatch);
  }

  function onKeyInput() {
    check = null;
    clearTimeout(keyTimer);
    keyTimer = setTimeout(
      () => void saveSecrets({ geminiKey: geminiKey.trim(), openaiKey: openaiKey.trim() }).then(flash),
      300,
    );
  }

  async function runCheck() {
    checking = true;
    check = null;
    clearTimeout(keyTimer);
    await saveSecrets({ geminiKey: geminiKey.trim(), openaiKey: openaiKey.trim() });
    clearTimeout(saveTimer);
    settings = await saveSettings($state.snapshot(settings) as SettingsPatch);
    const res = await sendBg({ type: 'provider/models' });
    checking = false;
    if (res.ok) {
      models = res.models;
      check = { ok: true, text: t('opt.check.ok', { n: res.models.length }) };
    } else {
      check = { ok: false, text: t('opt.check.fail', { msg: res.message }) };
    }
  }

  async function grant() {
    if (!origin) return;
    permitted = await browser.permissions.request({ origins: [origin] });
  }

  function captureHotkey(action: HotkeyAction, e: KeyboardEvent) {
    if (e.key === 'Tab') return;
    e.preventDefault();
    const spec = hotkeyFromEvent(e);
    if (!spec) return;
    settings.hotkeys[action] = spec;
    save();
  }

  function resetHotkeys() {
    settings.hotkeys = { ...DEFAULT_HOTKEYS };
    save();
  }
</script>

<div class="form">
  <p class="saved" aria-live="polite">{savedFlash ? t('opt.saved') : ''}</p>

  <section>
    <h2>{t('opt.provider')}</h2>
    <label class="radio">
      <input type="radio" bind:group={settings.provider} value="gemini" onchange={save} />
      {t('opt.provider.gemini')}
    </label>
    <label class="radio">
      <input type="radio" bind:group={settings.provider} value="openai-compat" onchange={save} />
      {t('opt.provider.openai')}
    </label>

    {#if settings.provider === 'gemini'}
      <label class="field">
        <span>{t('opt.key')}</span>
        <span class="inline">
          <input
            type={showKey ? 'text' : 'password'}
            autocomplete="off"
            spellcheck="false"
            bind:value={geminiKey}
            oninput={onKeyInput}
          />
          <button type="button" onclick={() => (showKey = !showKey)}
            >{showKey ? t('opt.key.hide') : t('opt.key.show')}</button
          >
        </span>
        <span class="muted">{t('opt.key.gemini.where')} {t('opt.key.hint')}</span>
      </label>
      <label class="field">
        <span>{t('opt.model')}</span>
        <span class="inline">
          <input list="models" bind:value={settings.gemini.model} onchange={save} spellcheck="false" />
        </span>
        <span class="muted">{t('opt.model.manual')}</span>
      </label>
    {:else}
      <label class="field">
        <span>{t('opt.baseUrl')}</span>
        <input bind:value={settings.openai.baseUrl} onchange={save} spellcheck="false" />
        <span class="presets">
          {t('opt.baseUrl.presets')}:
          {#each PRESETS as p (p.url)}
            <button
              type="button"
              class="link"
              onclick={() => {
                settings.openai.baseUrl = p.url;
                save();
              }}>{p.label}</button
            >
          {/each}
        </span>
      </label>
      {#if origin}
        <p>
          {#if permitted}
            <span class="ok">✓ {t('opt.permission.ok', { origin })}</span>
          {:else}
            <button type="button" class="primary" onclick={grant}>{t('opt.permission', { origin })}</button>
          {/if}
        </p>
      {/if}
      <label class="field">
        <span>{t('opt.key')}</span>
        <span class="inline">
          <input
            type={showKey ? 'text' : 'password'}
            autocomplete="off"
            spellcheck="false"
            bind:value={openaiKey}
            oninput={onKeyInput}
          />
          <button type="button" onclick={() => (showKey = !showKey)}
            >{showKey ? t('opt.key.hide') : t('opt.key.show')}</button
          >
        </span>
        <span class="muted">{t('opt.key.hint')}</span>
      </label>
      <label class="field">
        <span>{t('opt.model')}</span>
        <input list="models" bind:value={settings.openai.model} onchange={save} spellcheck="false" />
        <span class="muted">{t('opt.model.manual')}</span>
      </label>
    {/if}
    <datalist id="models">
      {#each models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
    </datalist>
    <p class="inline">
      <button type="button" onclick={runCheck} disabled={checking}>{t('opt.check')}</button>
      {#if check}<span class={check.ok ? 'ok' : 'err'} role="status">{check.text}</span>{/if}
    </p>
  </section>

  <section>
    <h2>{t('opt.level')}</h2>
    <div class="seg" role="radiogroup" aria-label={t('opt.level')}>
      {#each LEVELS as l (l)}
        <label class:on={settings.level === l}>
          <input type="radio" bind:group={settings.level} value={l} onchange={save} />{l}
        </label>
      {/each}
    </div>
    <label class="field">
      <span>{t('opt.outLang')}</span>
      <select bind:value={settings.outLang} onchange={save}>
        <option value="ru">{t('opt.outLang.ru')}</option>
        <option value="en-simple">{t('opt.outLang.en')}</option>
      </select>
    </label>
    <div class="grid">
      <label class="field">
        <span>{t('opt.budget')}</span>
        <input
          type="number"
          min="2000"
          step="1000"
          bind:value={settings.contextBudgetTokens}
          onchange={save}
        />
      </label>
      <label class="field">
        <span>{t('opt.window')}</span>
        <input type="number" min="10" step="10" bind:value={settings.contextWindowCues} onchange={save} />
      </label>
    </div>
    <label class="check">
      <input type="checkbox" bind:checked={settings.onlyPast} onchange={save} />
      {t('opt.onlyPast')}
    </label>
  </section>

  <section>
    <h2>{t('opt.panel')}</h2>
    <div class="grid">
      <label class="field">
        <span>{t('opt.panel.side')}</span>
        <select bind:value={settings.panel.side} onchange={save}>
          <option value="right">{t('opt.panel.side.right')}</option>
          <option value="left">{t('opt.panel.side.left')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('opt.panel.compact')}</span>
        <select bind:value={settings.panel.compact} onchange={save}>
          <option value="auto">{t('opt.panel.compact.auto')}</option>
          <option value="on">{t('opt.panel.compact.on')}</option>
          <option value="off">{t('opt.panel.compact.off')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('opt.panel.width')}: {settings.panel.widthPct}</span>
        <input type="range" min="28" max="40" bind:value={settings.panel.widthPct} onchange={save} />
      </label>
      <label class="field">
        <span>{t('opt.panel.font')}: {settings.panel.fontScale.toFixed(2)}×</span>
        <input
          type="range"
          min="0.7"
          max="1.6"
          step="0.05"
          bind:value={settings.panel.fontScale}
          onchange={save}
        />
      </label>
      <label class="field">
        <span>{t('opt.theme')}</span>
        <select bind:value={settings.theme} onchange={save}>
          <option value="auto">{t('opt.theme.auto')}</option>
          <option value="dark">{t('opt.theme.dark')}</option>
          <option value="light">{t('opt.theme.light')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('opt.uiLang')}</span>
        <select bind:value={settings.uiLang} onchange={save}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  </section>

  <section>
    <h2>{t('opt.hotkeys')}</h2>
    <p class="muted">{t('opt.hotkeys.hint')}</p>
    <div class="hotkeys">
      {#each HOTKEY_ACTIONS as a (a)}
        <label class="field row">
          <span>{t(`opt.hk.${a}`)}</span>
          <input readonly value={formatHotkey(settings.hotkeys[a])} onkeydown={(e) => captureHotkey(a, e)} />
        </label>
      {/each}
    </div>
    <button type="button" onclick={resetHotkeys}>{t('opt.hotkeys.reset')}</button>
  </section>

  <section>
    <h2>{t('opt.privacy')}</h2>
    <p>{t('opt.privacy.text')}</p>
  </section>
</div>

<style>
  .form {
    position: relative;
  }

  .saved {
    position: fixed;
    top: 12px;
    right: 16px;
    margin: 0;
    color: var(--ok);
    font-weight: 600;
  }

  section {
    margin: 0 0 16px;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
  }

  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 10px 0;
  }

  .field.row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
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
    min-width: 260px;
  }

  .radio,
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 18px;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }

  .seg label {
    padding: 6px 16px;
    cursor: pointer;
    font-weight: 600;
  }

  .seg label.on {
    background: var(--accent);
    color: #fff;
  }

  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .presets {
    font-size: 13px;
    color: var(--muted);
  }

  .link {
    border: 0;
    background: none;
    color: var(--accent);
    padding: 0 4px;
    text-decoration: underline;
  }

  .hotkeys input {
    width: 140px;
    text-align: center;
    cursor: pointer;
  }
</style>
