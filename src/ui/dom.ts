type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny hyperscript helper. `on*` attributes become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'class') el.className = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild as SVGElement;
}

export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString('en-IN'),
  cr: (n: number) => `₹${n < 0 ? '-' : ''}${Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toLocaleString('en-IN') : Math.abs(n).toFixed(1)} Cr`,
  clock: (min: number) => {
    const m = Math.floor(min) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  },
  dur: (min: number) => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  },
  day: (min: number) => Math.floor(min / 1440) + 1,
};
