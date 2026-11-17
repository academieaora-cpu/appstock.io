declare module 'shpjs' {
  export function parseShp(shp: Uint8Array | ArrayBuffer, prj?: string): unknown[]
  export function parseDbf(dbf: Uint8Array | ArrayBuffer, cpg?: string): unknown[]
  export function combine(parts: [unknown[], unknown[] | undefined]): unknown
}
