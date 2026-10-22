import { buildExplainRequest } from '../core/ai/context';
import type { ExplainMode } from '../core/ai/types';
import { EXPLAIN_PORT, sendBg, type ExplainClientMsg, type ExplainServerMsg } from '../core/messaging/types';
import { formatMediaInfo } from '../core/subtitles/media-info';
import { log, safe } from '../utils/log';
import type { SubtextApp } from './app';
import type { ExplainTarget } from './state.svelte';

type Port = ReturnType<typeof browser.runtime.connect>;

/**
 * Content side of explanations (FR-I1…I7): pause, open the card, stream text in,
 * cancel on close or on a new target. Keys and network stay in the background.
 */
export class ExplainClient {
  private port: Port | null = null;
  private seq = 0;
  private wasPlaying = false;
  private retryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly app: SubtextApp) {
    app.explainHandler = (t) => this.explain(t, 'short');
    app.cardActions = {
      closeCard: (resume) => this.close(resume),
      explainMore: () => this.again('detailed', false),
      refreshCard: () => this.again(undefined, true),
      retryCard: () => this.again(undefined, false),
      saveCard: () => void this.save(),
      copyCard: () => void this.copy(),
      rateCard: (v) => void this.rate(v),
    };
  }

  private get state() {
    return this.app.state;
  }

  private connect(): Port {
    if (this.port) return this.port;
    const port = browser.runtime.connect({ name: EXPLAIN_PORT });
    port.onMessage.addListener((m: unknown) => safe(() => this.onMessage(m as ExplainServerMsg)));
    port.onDisconnect.addListener(() => {
      this.port = null;
      const card = this.state.card;
      if (card && (card.status === 'loading' || card.status === 'streaming')) {
        card.status = 'error';
        card.error = { code: 'network', message: 'background disconnected' };
      }
    });
    this.port = port;
    return port;
  }

  private send(msg: ExplainClientMsg) {
    try {
      this.connect().postMessage(msg);
    } catch (e) {
      // The background may have been restarted; one reconnect attempt.
      this.port = null;
      log.warn('port send failed, reconnecting', e);
      this.connect().postMessage(msg);
    }
  }

  explain(target: ExplainTarget, mode: ExplainMode, force = false): void {
    const video = this.app.currentVideo;
    const track = this.state.track;
    if (!video || !track) return;
    // FR-I2: pause first, synchronously, before any other work.
    if (!this.state.card) this.wasPlaying = !video.paused;
    video.pause();

    const cue = track.cues[target.cueIndex];
    if (!cue || cue.kind !== 'speech') return;
    this.cancelCurrent();

    // Plain copies: Svelte state proxies cannot cross postMessage (structured clone).
    const s = this.state.settings;
    const req = buildExplainRequest({
      track,
      cueIndex: target.cueIndex,
      ...(target.focusText ? { focusText: target.focusText } : {}),
      media: { ...this.state.mediaInfo },
      settings: {
        level: s.level,
        outLang: s.outLang,
        contextBudgetTokens: s.contextBudgetTokens,
        contextWindowCues: s.contextWindowCues,
        onlyPast: s.onlyPast,
      },
      mode,
    });
    const reqId = ++this.seq;
    this.state.card = {
      reqId,
      target,
      cueId: cue.id,
      mode,
      status: 'loading',
      text: '',
      cached: false,
    };
    try {
      this.send({ type: 'start', reqId, req, ...(force ? { force: true } : {}) });
    } catch (e) {
      log.error('could not start explanation', e);
      const card = this.state.card;
      if (card?.reqId === reqId) {
        card.status = 'error';
        card.error = { code: 'unknown', message: String(e) };
      }
    }
  }

  private again(mode: ExplainMode | undefined, force: boolean) {
    const card = this.state.card;
    if (!card) return;
    this.explain(card.target, mode ?? card.mode, force);
  }

  private cancelCurrent() {
    clearInterval(this.retryTimer);
    const card = this.state.card;
    if (card && (card.status === 'loading' || card.status === 'streaming')) {
      this.send({ type: 'cancel', reqId: card.reqId });
    }
  }

  /** FR-I4/I5: Space resumes playback (always — it is an explicit "continue"); Esc keeps the pause. */
  close(resume: boolean): void {
    if (!this.state.card) return;
    this.cancelCurrent();
    this.state.card = null;
    if (resume) void this.app.currentVideo?.play().catch(() => {});
  }

  get resumeWouldPlay(): boolean {
    return this.wasPlaying;
  }

  private onMessage(msg: ExplainServerMsg) {
    const card = this.state.card;
    if (!card || msg.reqId !== card.reqId) return;
    switch (msg.type) {
      case 'meta':
        card.cached = msg.cached;
        card.cacheKey = msg.cacheKey;
        break;
      case 'retrying':
        this.startRetryCountdown(Math.ceil(msg.delayMs / 1000));
        break;
      case 'chunk':
        card.retryInSec = undefined;
        card.text += msg.text;
        card.status = 'streaming';
        break;
      case 'done':
        clearInterval(this.retryTimer);
        card.retryInSec = undefined;
        card.text = msg.result.text;
        card.type = msg.result.type;
        card.confidence = msg.result.confidence;
        if (msg.result.expr) card.expr = msg.result.expr;
        card.result = msg.result;
        card.cacheKey = msg.cacheKey;
        card.status = 'done';
        break;
      case 'error':
        clearInterval(this.retryTimer);
        card.status = 'error';
        card.error = {
          code: msg.code,
          message: msg.message,
          ...(msg.retryAfter !== undefined ? { retryAfter: msg.retryAfter } : {}),
        };
        card.retryInSec = msg.retryAfter;
        if (msg.retryAfter) this.startRetryCountdown(msg.retryAfter);
        break;
    }
  }

  private startRetryCountdown(seconds: number) {
    clearInterval(this.retryTimer);
    const card = this.state.card;
    if (!card) return;
    card.retryInSec = seconds;
    this.retryTimer = setInterval(() => {
      const c = this.state.card;
      if (!c || c.retryInSec === undefined || c.retryInSec <= 0) {
        clearInterval(this.retryTimer);
        return;
      }
      c.retryInSec -= 1;
    }, 1000);
  }

  private async save() {
    const card = this.state.card;
    const cue = card && this.state.track?.cues.find((c) => c.id === card.cueId);
    if (!card || !cue || card.status !== 'done') return;
    await sendBg({
      type: 'phrases/add',
      phrase: {
        phrase: card.expr ?? card.target.focusText ?? cue.text,
        cueText: cue.text,
        explanation: card.text,
        type: card.type ?? 'other',
        show: formatMediaInfo(this.state.mediaInfo) || document.title,
        time: cue.start,
      },
    });
    card.saved = true;
    this.app.toast(this.state.t('toast.saved'), undefined, 1500);
  }

  private async copy() {
    const card = this.state.card;
    if (!card?.text) return;
    try {
      await navigator.clipboard.writeText(card.text.replace(/\*\*/g, ''));
      this.app.toast(this.state.t('toast.copied'), undefined, 1200);
    } catch (e) {
      log.warn('clipboard write failed', e);
    }
  }

  private async rate(value: 'up' | 'down') {
    const card = this.state.card;
    if (!card?.cacheKey || card.status !== 'done') return;
    card.feedback = value;
    await sendBg({ type: 'feedback', cacheKey: card.cacheKey, value });
  }

  destroy() {
    clearInterval(this.retryTimer);
    this.port?.disconnect();
    this.port = null;
  }
}
