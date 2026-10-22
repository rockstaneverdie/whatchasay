import 'fake-indexeddb/auto';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import SettingsForm from '../../src/entrypoints/options/SettingsForm.svelte';
import Popup from '../../src/entrypoints/popup/App.svelte';
import { DEFAULT_SETTINGS, loadSettings } from '../../src/core/storage/settings';
import { loadSecrets } from '../../src/core/storage/secrets';
import { pageT, type PageKey } from '../../src/i18n/pages';
import { reactive } from '../reactive.svelte';

const t = (key: PageKey, params?: Record<string, string | number>) => pageT('ru', key, params);

beforeEach(() => {
  fakeBrowser.reset();
  vi.useRealTimers();
  vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true as never);
});

/** Stands in for the background's runtime.onMessage handlers. */
function background(answers: Record<string, unknown>) {
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: { type: string }) =>
    msg.type in answers ? { ok: true, value: answers[msg.type] } : undefined) as never);
}

describe('options: SettingsForm', () => {
  it('saves the key to storage.local only and shows the model check result', async () => {
    // Background answer for "provider/models".
    background({ 'provider/models': { ok: true, models: [{ id: 'gemini-3.8-flash', label: 'x' }] } });
    const settings = reactive(structuredClone(DEFAULT_SETTINGS));
    const { container, getByText } = render(SettingsForm, { props: { settings, t } });
    const key = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await new Promise((r) => setTimeout(r, 20)); // stored keys finish loading first
    await fireEvent.input(key, { target: { value: '  AIza-test-key  ' } });
    await fireEvent.click(getByText('Проверить'));
    await waitFor(() => expect(container.textContent).toContain('Ключ работает. Моделей: 1.'));
    expect(await loadSecrets()).toEqual({ geminiKey: 'AIza-test-key' });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
    expect(key.type).toBe('password');
  });

  it('switches provider, shows presets, persists settings and asks for host access', async () => {
    vi.mocked(fakeBrowser.permissions.contains).mockResolvedValue(false as never);
    const settings = reactive(structuredClone(DEFAULT_SETTINGS));
    const { container, getByText } = render(SettingsForm, { props: { settings, t } });
    await fireEvent.click(container.querySelector('input[value="openai-compat"]')!);
    await fireEvent.click(getByText('Ollama'));
    await waitFor(async () => {
      const s = await loadSettings();
      expect(s.provider).toBe('openai-compat');
      expect(s.openai.baseUrl).toBe('http://localhost:11434/v1');
    });
    expect(container.textContent).toContain('Разрешить доступ к http://localhost/*');
  });

  it('captures hotkeys by code', async () => {
    const settings = reactive(structuredClone(DEFAULT_SETTINGS));
    const { container } = render(SettingsForm, { props: { settings, t } });
    const field = container.querySelectorAll<HTMLInputElement>('.hotkeys input')[1]!;
    await fireEvent.keyDown(field, { code: 'KeyX', key: 'x', shiftKey: true });
    expect(field.value).toBe('Shift+X');
    await waitFor(async () => expect((await loadSettings()).hotkeys.explain).toBe('Shift+KeyX'));
  });
});

describe('popup', () => {
  it('reports a page without a video and a missing key', async () => {
    background({ 'provider/status': { configured: false, provider: 'gemini', model: 'm' } });
    const { container } = render(Popup);
    await waitFor(() => expect(container.textContent).toContain('На этой странице нет подходящего видео.'));
    expect(container.textContent).toContain('Ключ ИИ не задан');
  });
});
