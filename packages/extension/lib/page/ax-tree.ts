/**
 * Generates a textual accessibility-tree-like view of the current page.
 * Self-contained: injected via chrome.scripting.executeScript({world:'MAIN'}).
 * Output format: indented lines like "[role=button name='Send'] (visible)".
 */
export function generateAxText(maxNodes = 400): string {
  const lines: string[] = [];
  let count = 0;

  function isVisible(el: Element): boolean {
    const rect = (el as HTMLElement).getBoundingClientRect?.();
    if (!rect) return false;
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el as HTMLElement);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return true;
  }

  function implicitRole(el: Element): string | null {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && (el as HTMLAnchorElement).href) return 'link';
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type;
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
    if (tag === 'img' && (el as HTMLImageElement).alt) return 'img';
    return null;
  }

  function accessibleName(el: Element): string {
    const al = el.getAttribute('aria-label');
    if (al?.trim()) return al.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? '';
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  function walk(el: Element, depth: number): void {
    if (count >= maxNodes) return;
    if (!isVisible(el)) return;
    const role = el.getAttribute('role') ?? implicitRole(el);
    const tag = el.tagName.toLowerCase();
    const name = accessibleName(el);
    const interactive =
      role !== null || ['button', 'a', 'input', 'select', 'textarea'].includes(tag);
    if (interactive || (name && depth < 4)) {
      const indent = '  '.repeat(Math.min(depth, 8));
      const escapedName = name.replace(/'/g, "\\'");
      const roleStr = role ?? tag;
      const idStr = el.id ? ` #${el.id}` : '';
      const testid = el.getAttribute('data-testid');
      const testidStr = testid ? ` data-testid="${testid}"` : '';
      lines.push(`${indent}[${roleStr}${idStr}${testidStr}] '${escapedName}'`);
      count++;
    }
    for (const child of el.children) walk(child, depth + 1);
  }

  walk(document.body, 0);
  return lines.join('\n');
}
