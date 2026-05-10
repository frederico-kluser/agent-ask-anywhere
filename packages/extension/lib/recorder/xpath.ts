export function generateXPath(el: Element): string {
  if (el === document.documentElement) return '/html';
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName.toLowerCase() === tag) index++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${tag}[${index}]`);
    node = node.parentElement;
  }
  return `/html/${parts.join('/')}`;
}
