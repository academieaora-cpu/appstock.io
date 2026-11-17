/**
 * Projets enregistrés sur l'appareil (IndexedDB) : sauvegarde automatique du travail
 * en cours et projets nommés. Rien ne quitte le navigateur.
 */
export interface LocalProject {
  id: string
  name: string
  savedAt: number
  size: number
}

interface Row extends LocalProject {
  data: Uint8Array
}

export const AUTOSAVE_ID = 'autosave'
const DB = 'appstock-geo'
const STORE = 'projects'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Stockage local indisponible dans ce navigateur.'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Stockage local indisponible.'))
  })
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = action(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

export async function saveLocal(id: string, name: string, data: Uint8Array): Promise<LocalProject> {
  const row: Row = { id, name, savedAt: Date.now(), size: data.length, data }
  await run('readwrite', (s) => s.put(row))
  return { id, name, savedAt: row.savedAt, size: row.size }
}

export async function loadLocal(id: string): Promise<Uint8Array | null> {
  const row = await run<Row | undefined>('readonly', (s) => s.get(id))
  return row ? row.data : null
}

export async function listLocal(): Promise<LocalProject[]> {
  const rows = await run<Row[]>('readonly', (s) => s.getAll())
  return rows.map(({ id, name, savedAt, size }) => ({ id, name, savedAt, size })).sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteLocal(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

/** Demande au navigateur de ne pas effacer ces données quand l'espace manque. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
