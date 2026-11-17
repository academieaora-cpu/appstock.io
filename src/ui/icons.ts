/** Icônes du ruban (dessins originaux, traits simples 24 × 24). */
const P: Record<string, string> = {
  line: 'M4 20 20 4',
  pline: 'M3 19 9 9l5 6 7-11',
  polygon: 'M5 18 3 8l8-5 9 5-3 10z',
  rect: 'M4 6h16v12H4z',
  hexagon: 'M7 4h10l5 8-5 8H7l-5-8z',
  circle: 'M12 3a9 9 0 1 0 0.01 0',
  arc: 'M4 18a9 9 0 0 1 16 0',
  point: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 5v3M12 16v3M5 12h3M16 12h3',
  mline: 'M3 16 10 7l5 5 6-7M3 20l7-9 5 5 6-7',
  text: 'M5 5h14M12 5v15M9 20h6',
  hatch: 'M4 4h16v16H4zM4 12l8-8M4 20 20 4M12 20l8-8',
  dim: 'M4 8v10M20 8v10M4 13h16M6 15l-2-2 2-2M18 11l2 2-2 2',
  dimpoly: 'M4 18 8 6l12 4-4 10zM9 4h2M16 7l2 1',
  erase: 'M4 17l7-7 6 6-4 4H8zM11 10l5-5 5 5-5 5',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  scale: 'M4 20h7v-7H4zM11 13l9-9M14 4h6v6',
  mirror: 'M12 3v18M10 6 4 18h6zM14 6l6 12h-6z',
  offset: 'M3 18 9 8l5 6 7-10M3 22l6-10 5 6 7-10',
  explode: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  bearing: 'M12 21V3M12 3l-3 4M12 3l3 4M12 15l6-5',
  id: 'M12 3v18M3 12h18M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  area: 'M4 18 6 6l10-2 4 12zM9 11h6M9 14h4',
  radiate: 'M5 19l6-6M11 13l8-3M11 13l2 8M11 13 7 4',
  tcpoint: 'M8 12h8M12 8v8M15 7h5',
  number: 'M5 18 8 6l11 3-3 10zM4 4h3v3M18 4l2 2',
  table: 'M3 5h18v14H3zM3 10h18M3 14h18M9 10v9M15 10v9',
  areatag: 'M4 18 6 6l12-2 2 12zM9 12h6',
  tree: 'M12 3a5 5 0 0 1 5 5c0 3-2 5-5 5s-5-2-5-5a5 5 0 0 1 5-5zM12 13v8',
  tin: 'M3 18 8 5l5 9 8-6-3 12zM8 5l10 15M13 14 3 18',
  contours: 'M3 8c4-3 8 3 12 0s4 0 6-1M3 13c4-3 8 3 12 0s4 0 6-1M3 18c4-3 8 3 12 0s4 0 6-1',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  open: 'M3 7h6l2 2h10v10H3z',
  assistant: 'M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  print: 'M7 8V3h10v5M5 8h14v8H5zM7 14h10v7H7z',
  export: 'M12 3v12M8 11l4 4 4-4M4 17v4h16v-4',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  frame: 'M3 6h18v12H3zM7 9h10v6H7z',
  zoom: 'M10 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M15 15l6 6',
  zoomwin: 'M3 3h7M3 3v7M21 21h-7M21 21v-7M8 8h8v8H8z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01',
  projects: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z',
  layers: 'M12 3 3 8l9 5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  crs: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
}

export function icon(name: string | undefined): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('ico')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', P[name ?? ''] ?? P.point)
  svg.appendChild(path)
  return svg
}
