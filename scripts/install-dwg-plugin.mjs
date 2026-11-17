// Installe le décodeur DWG (LibreDWG compilé en WebAssembly, GPL-3.0) dans public/plugins/.
// Le décodeur est un composant séparé et remplaçable, chargé à l'exécution dans un Web Worker :
// il n'est jamais fusionné avec le code de l'application par le bundler, et ne communique
// avec elle que par un format neutre et documenté (DXF).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules/@mlightcad/libredwg-web/wasm')
const src = join(root, 'plugins/dwg-libredwg')
const out = join(root, 'public/plugins/dwg-libredwg')
if (!existsSync(pkg)) {
  console.warn('[dwg-plugin] @mlightcad/libredwg-web absent : lecture DWG désactivée.')
  process.exit(0)
}
mkdirSync(out, { recursive: true })
cpSync(join(pkg, 'libredwg-web.js'), join(out, 'libredwg-web.js'))
cpSync(join(pkg, 'libredwg-web.wasm'), join(out, 'libredwg-web.wasm'))
cpSync(join(src, 'worker.js'), join(out, 'worker.js'))
cpSync(join(src, 'README.md'), join(out, 'README.md'))
console.log('[dwg-plugin] décodeur DWG installé dans public/plugins/dwg-libredwg')
