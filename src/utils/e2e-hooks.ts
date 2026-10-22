import { sendBg, type BgRequest } from '../core/messaging/types';
import { saveSecrets } from '../core/storage/secrets';
import { saveSettings, type SettingsPatch } from '../core/storage/settings';
import { log } from './log';

/**
 * Only in `--mode e2e` builds (dead code otherwise): WebDriver cannot drive moz-extension://
 * pages, so the fixture page configures the extension through window messages instead.
 * Real secrets are never touched: only throw-away OpenSubtitles keys prefixed `e2e-` can be set.
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
      if (op === 'os-test-key') {
        const key = String(payload);
        if (!key.startsWith('e2e-')) throw new Error('only e2e- keys');
        return saveSecrets({ osApiKey: key });
      }
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
