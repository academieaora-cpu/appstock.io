/**
 * Cible PDF : tracé vectoriel à l'échelle exacte, en millimètres, sur une page
 * au format demandé. Les textes sont de vrais textes (sélectionnables), les
 * traits de vrais traits : le PDF reste net à n'importe quel zoom.
 */
import { jsPDF } from 'jspdf'
import { CAP_RATIO, LINE_SPACING, type Painter, type RGB } from './painter'

const MM_TO_PT = 72 / 25.4

export class PdfPainter implements Painter {
  constructor(private doc: jsPDF) {
    doc.setLineCap('round')
    doc.setLineJoin('round')
  }

  beginStroke(color: RGB, width: number, dash?: number[]): void {
    this.doc.setDrawColor(color[0], color[1], color[2])
    this.doc.setLineWidth(width)
    this.doc.setLineDashPattern(dash ?? [], 0)
  }
  moveTo(x: number, y: number): void {
    this.doc.moveTo(x, y)
  }
  lineTo(x: number, y: number): void {
    this.doc.lineTo(x, y)
  }
  closePath(): void {
    this.doc.close()
  }
  endStroke(): void {
    this.doc.stroke()
  }
  fillPolygon(rings: number[][], color: RGB, alpha: number): void {
    const d = this.doc
    d.setFillColor(color[0], color[1], color[2])
    const translucent = alpha < 0.999
    if (translucent) {
      d.saveGraphicsState()
      d.setGState(new (d as unknown as { GState: new (o: object) => unknown }).GState({ opacity: alpha }) as Parameters<typeof d.setGState>[0])
    }
    for (const r of rings) {
      d.moveTo(r[0], r[1])
      for (let i = 2; i < r.length; i += 2) d.lineTo(r[i], r[i + 1])
      d.close()
    }
    d.fillEvenOdd()
    if (translucent) d.restoreGraphicsState()
  }
  dot(x: number, y: number, radius: number, color: RGB): void {
    this.doc.setFillColor(color[0], color[1], color[2])
    this.doc.circle(x, y, radius, 'F')
  }
  private font(capHeight: number, bold?: boolean): void {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal')
    this.doc.setFontSize((capHeight / CAP_RATIO) * MM_TO_PT)
  }
  text(x: number, y: number, capHeight: number, rot: number, text: string, ha: number, va: number, color: RGB, bold?: boolean): void {
    const d = this.doc
    this.font(capHeight, bold)
    d.setTextColor(color[0], color[1], color[2])
    const lines = text.indexOf('\n') >= 0 ? text.split('\n') : [text]
    const step = capHeight * LINE_SPACING
    const block = capHeight + step * (lines.length - 1)
    let y0 = 0
    if (va === 3) y0 = capHeight
    else if (va === 2) y0 = capHeight - block / 2
    else if (va === 1) y0 = -(block - capHeight) - capHeight * 0.3
    else y0 = -(block - capHeight)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const angle = (rot * 180) / Math.PI
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i]
      if (!s) continue
      // Position dans le repère du texte : dx le long de la ligne, dy vers le bas.
      const dx = ha === 0 ? 0 : -d.getTextWidth(s) * (ha === 1 ? 0.5 : 1)
      const dy = y0 + i * step
      const px = x + dx * cos + dy * sin
      const py = y - dx * sin + dy * cos
      if (angle) d.text(s, px, py, { angle })
      else d.text(s, px, py)
    }
  }
  textWidth(text: string, capHeight: number, bold?: boolean): number {
    this.font(capHeight, bold)
    return this.doc.getTextWidth(text)
  }
  save(): void {
    this.doc.saveGraphicsState()
  }
  clipRect(x: number, y: number, w: number, h: number): void {
    const d = this.doc
    d.rect(x, y, w, h, null as unknown as string)
    d.clip()
    d.discardPath()
  }
  restore(): void {
    this.doc.restoreGraphicsState()
  }
}

/** Crée un document PDF d'une page au format donné (en mm). */
export function createPdf(widthMm: number, heightMm: number, title: string): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: widthMm > heightMm ? 'landscape' : 'portrait', compress: true })
  doc.setProperties({ title, creator: 'AppStock Géo' })
  return doc
}
