import type { ShadowSelection } from './host';

export type ClickHit =
  | { kind: 'seek'; index: number }
  | {
      kind: 'explain';
      index: number;
      focusText?: string;
      anchorEl?: Element;
      anchorRect?: DOMRect;
    };

function closestFrom(node: Node | null, selector: string): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>(selector) ?? null;
}

/** Trims surrounding punctuation of a clicked word: `"work".` → `work`. */
export function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

/**
 * FR-I1: what a click in the panel means.
 * Selection wins (focus = selected text), then the timestamp chip (seek),
 * then a word (focus = word), then the line (whole line).
 */
export function describeClick(target: Element | null, selection: ShadowSelection | null): ClickHit | null {
  if (selection) {
    const startLine = closestFrom(selection.startNode, '.line');
    const endLine = closestFrom(selection.endNode, '.line');
    if (startLine && endLine) {
      const a = Number(startLine.dataset.index);
      const b = Number(endLine.dataset.index);
      return {
        kind: 'explain',
        index: Math.min(a, b),
        focusText: selection.text.replace(/\s+/g, ' ').trim(),
        anchorRect: selection.rect,
      };
    }
  }
  if (!target) return null;
  const seek = target.closest<HTMLElement>('[data-seek]');
  if (seek) return { kind: 'seek', index: Number(seek.dataset.seek) };
  const line = target.closest<HTMLElement>('.line');
  if (!line) return null;
  const index = Number(line.dataset.index);
  const word = target.closest<HTMLElement>('.w');
  const text = word ? cleanWord(word.textContent ?? '') : '';
  if (word && text) return { kind: 'explain', index, focusText: text, anchorEl: word };
  return { kind: 'explain', index, anchorEl: line };
}
