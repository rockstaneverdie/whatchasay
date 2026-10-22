import { sendBg, type BgRequest } from '../core/messaging/types';
import { saveSettings, type SettingsPatch } from '../core/storage/settings';
import { log } from './log';

/**
 * Only in `--mode e2e` builds (dead code otherwise): WebDriver cannot drive moz-extension://
 * pages, so the fixture page configures the extension through window messages instead.
 * Never handles secrets.
 */
export function installE2EHooks(): void {
  log.warn('E2E build: test hooks are active');
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; id?: number; op?: string; payload?: unknown } | null;
    if (e.source !== window || data?.type !== 'subtext-e2e') return;
    const { id, op, payload } = data;
    const run = async () => {
      if (op === 'settings') return saveSettings(payload as SettingsPatch);
      if (op === 'bg') return sendBg(payload as BgRequest);
      throw new Error(`unknown op ${op}`);
    };
    run().then(
      (result) =>
        window.postMessage(
          { type: 'subtext-e2e-result', id, result: JSON.parse(JSON.stringify(result ?? null)) },
          '*',
        ),
      (err: unknown) => window.postMessage({ type: 'subtext-e2e-result', id, error: String(err) }, '*'),
    );
  });
}
