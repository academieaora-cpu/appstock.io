/**
 * Client du décodeur DWG. Le décodeur (LibreDWG en WebAssembly, GPL) est un
 * composant séparé, chargé à la demande dans son propre Web Worker : on lui envoie
 * les octets d'un DWG, il renvoie les octets d'un DXF.
 */
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    const url = new URL('plugins/dwg-libredwg/worker.js', document.baseURI)
    worker = new Worker(url, { type: 'module' })
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; dxf?: ArrayBuffer; error?: string }>) => {
      const p = pending.get(ev.data.id)
      if (!p) return
      pending.delete(ev.data.id)
      if (ev.data.ok && ev.data.dxf) p.resolve(new Uint8Array(ev.data.dxf))
      else p.reject(new Error(ev.data.error ?? 'conversion DWG impossible'))
    }
    worker.onerror = (ev) => {
      const err = new Error('Le décodeur DWG n’a pas pu être chargé (' + (ev.message || 'plugins/dwg-libredwg introuvable') + ').')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
      worker = null
    }
  }
  return worker
}

/** Convertit un fichier DWG en DXF, entièrement dans le navigateur. */
export function dwgToDxf(bytes: ArrayBuffer): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, bytes }, [bytes])
  })
}

/** Version d'un fichier DWG d'après sa signature (« AC1027 » → 2013). */
export function dwgVersion(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 6))
}
