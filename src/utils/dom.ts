/** DOM helpers that see through open shadow roots (FR-V6). */

/** The parent in the composed tree: a shadow root's parent is its host. */
export function composedParent(n: Node): Node | null {
  if (n.parentNode) return n.parentNode;
  return n instanceof ShadowRoot ? n.host : null;
}

export function composedContains(ancestor: Node, node: Node): boolean {
  for (let n: Node | null = node; n; n = composedParent(n)) if (n === ancestor) return true;
  return false;
}

/** Elements from `node` up to the document, crossing shadow boundaries. */
export function composedAncestors(node: Node): Element[] {
  const out: Element[] = [];
  for (let n: Node | null = composedParent(node); n; n = composedParent(n)) {
    if (n instanceof Element) out.push(n);
  }
  return out;
}

/**
 * The element in fullscreen as seen from the tree that holds `node`. Inside a shadow tree
 * `document.fullscreenElement` is retargeted to the host; the shadow root knows the real one.
 */
export function fullscreenElementFor(node: Node): Element | null {
  const root = node.getRootNode() as Document | ShadowRoot;
  return (root as { fullscreenElement?: Element | null }).fullscreenElement ?? document.fullscreenElement;
}

/** Hit test in the tree that holds `node` (so a point inside a shadow tree resolves there). */
export function elementAtPoint(node: Node, x: number, y: number): Element | null {
  const root = node.getRootNode() as Document | ShadowRoot;
  const fn = (root as { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint;
  return fn ? fn.call(root, x, y) : document.elementFromPoint(x, y);
}
