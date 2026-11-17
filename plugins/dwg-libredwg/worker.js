// SPDX-License-Identifier: GPL-3.0-or-later
//
// Décodeur DWG autonome : convertit un fichier DWG en DXF à l'aide de LibreDWG
// (https://www.gnu.org/software/libredwg/, GPL-3.0-or-later) compilé en WebAssembly
// par le projet libredwg-web (https://github.com/mlightcad/libredwg-web).
//
// Ce fichier et le binaire WebAssembly qu'il charge forment un programme distinct de
// l'application : il s'exécute dans son propre Web Worker, reçoit les octets d'un DWG
// et renvoie les octets d'un DXF (format d'échange public et documenté). Aucune
// structure interne n'est partagée avec l'application.
import createModule from './libredwg-web.js'

let modulePromise = null

function getModule() {
  if (!modulePromise) {
    modulePromise = createModule({
      locateFile: (file) => new URL(file, import.meta.url).href,
      print: () => {},
      printErr: () => {},
    })
  }
  return modulePromise
}

function safeUnlink(fs, name) {
  try {
    if (fs.analyzePath(name, false).exists) fs.unlink(name)
  } catch {
    /* rien à nettoyer */
  }
}

self.onmessage = async (event) => {
  const { id, bytes } = event.data
  let mod = null
  try {
    mod = await getModule()
    mod.FS.writeFile('in.dwg', new Uint8Array(bytes))
    const code = mod.dwg_write_dxf('in.dwg', 'out.dxf')
    let dxf = null
    if (mod.FS.analyzePath('out.dxf', false).exists) dxf = mod.FS.readFile('out.dxf')
    if (!dxf || dxf.length === 0) throw new Error('LibreDWG n’a produit aucune sortie (code ' + code + ')')
    // Copie hors du tas WebAssembly avant transfert.
    const out = dxf.slice().buffer
    self.postMessage({ id, ok: true, dxf: out, code }, [out])
  } catch (err) {
    // Après un abandon du module WebAssembly, on repart d'une instance neuve au prochain appel.
    modulePromise = null
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) })
  } finally {
    if (mod && modulePromise) {
      safeUnlink(mod.FS, 'in.dwg')
      safeUnlink(mod.FS, 'out.dxf')
    }
  }
}
