// Petits utilitaires DOM : échappement et mise à jour différentielle (préserve survol, focus et défilement).

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error('Élément introuvable : ' + sel);
  return el as HTMLElement;
}

function morphNode(from: Node, to: Node) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.parentNode!.replaceChild(to.cloneNode(true), from);
    return;
  }
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  const fe = from as Element;
  const te = to as Element;
  for (const attr of Array.from(fe.attributes)) if (!te.hasAttribute(attr.name)) fe.removeAttribute(attr.name);
  for (const attr of Array.from(te.attributes)) if (fe.getAttribute(attr.name) !== attr.value) fe.setAttribute(attr.name, attr.value);
  morphChildren(fe, te);
}

function morphChildren(from: Element, to: Element) {
  const a = Array.from(from.childNodes);
  const b = Array.from(to.childNodes);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) morphNode(a[i], b[i]);
  for (let i = n; i < a.length; i++) from.removeChild(a[i]);
  for (let i = n; i < b.length; i++) from.appendChild(b[i].cloneNode(true));
}

const tpl = document.createElement('template');
/** Remplace le contenu d'un élément par du HTML en ne modifiant que les différences. */
export function patch(el: Element, html: string) {
  if ((el as any).__html === html) return;
  (el as any).__html = html;
  tpl.innerHTML = html;
  const tmp = document.createElement(el.tagName);
  tmp.appendChild(tpl.content.cloneNode(true));
  morphChildren(el, tmp);
}

export function fmt(n: number): string {
  return Math.floor(n).toLocaleString('fr-FR');
}
export function signed(n: number, digits = 0): string {
  const v = Number(n.toFixed(digits));
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: digits });
}
