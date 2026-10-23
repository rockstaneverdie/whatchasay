/**
 * The page a frame belongs to. A frame without a URL of its own (about:blank, about:srcdoc), which
 * players sometimes build from script, inherits its creator's base URL; its title is usually empty,
 * so the parent's is used when it is reachable.
 */
export function pageUrl(): URL {
  return new URL(location.protocol === 'about:' ? document.baseURI : location.href);
}

export function pageTitle(): string {
  if (document.title || location.protocol !== 'about:') return document.title;
  try {
    return window.parent.document.title;
  } catch {
    return '';
  }
}
