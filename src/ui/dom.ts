/** Petits utilitaires de construction d'interface, sans dépendance. */
type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = String(v)
      else if (k === 'style') el.setAttribute('style', String(v))
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Record<string, unknown>)[k] = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/** Ouvre une boîte de dialogue modale ; renvoie la fonction de fermeture. */
export function modal(title: string, body: HTMLElement, options: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const dialog = h('dialog', { class: 'modal' + (options.wide ? ' wide' : '') })
  const close = () => {
    dialog.close()
    dialog.remove()
    options.onClose?.()
  }
  dialog.append(h('header', null, h('h2', null, title), h('button', { class: 'icon', title: 'Fermer', 'aria-label': 'Fermer', onclick: close }, '✕')), body)
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
  document.body.appendChild(dialog)
  dialog.showModal()
  return close
}

export function toast(message: string, kind: 'info' | 'erreur' | 'ok' = 'info', ms = 6000): void {
  let host = document.querySelector('.toasts')
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status' })
    document.body.appendChild(host)
  }
  const t = h('div', { class: 'toast ' + kind }, message)
  host.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', null, hint) : null)
}

export function select(options: [string, string][], value: string, onchange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { onchange: () => onchange(s.value) }, ...options.map(([v, l]) => h('option', { value: v }, l)))
  s.value = value
  return s
}

export function checkbox(label: string, checked: boolean, onchange: (v: boolean) => void): HTMLElement {
  const c = h('input', { type: 'checkbox', checked, onchange: () => onchange(c.checked) })
  return h('label', { class: 'check' }, c, h('span', null, label))
}

export function store<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stockage indisponible */
  }
}
