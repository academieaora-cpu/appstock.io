// Outil de ligne de commande : convertit un DWG en DXF avec le décodeur du dossier plugins/ (tests et diagnostics).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmDir = join(root, 'node_modules/@mlightcad/libredwg-web/wasm')

export async function dwgToDxf(bytes) {
  const { default: createModule } = await import(pathToFileURL(join(wasmDir, 'libredwg-web.js')).href)
  const mod = await createModule({ locateFile: (f) => join(wasmDir, f), print: () => {}, printErr: () => {} })
  mod.FS.writeFile('in.dwg', new Uint8Array(bytes))
  const code = mod.dwg_write_dxf('in.dwg', 'out.dxf')
  if (!mod.FS.analyzePath('out.dxf', false).exists) throw new Error('conversion impossible (code ' + code + ')')
  return mod.FS.readFile('out.dxf').slice()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2)
  const dxf = await dwgToDxf(readFileSync(input))
  writeFileSync(output, dxf)
  console.error(`${input} → ${output} (${dxf.length} octets)`)
}
