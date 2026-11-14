import type { jsPDF } from 'jspdf'

/**
 * Dibuja el logo de la empresa dentro de una caja (maxW × maxH mm) respetando
 * su proporción — antes se forzaba a un cuadrado y un logo horizontal salía
 * deformado. Devuelve el ancho realmente usado (mm) o 0 si no hay logo / no
 * se pudo dibujar, para que el llamador corra el texto a la derecha.
 */
export function dibujarLogoPDF(
  doc: jsPDF,
  logo: string | undefined,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): number {
  if (!logo) return 0
  try {
    const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG'
    const { width, height } = doc.getImageProperties(logo)
    const ratio = width / height
    const PAD = 1.5 // margen de la pastilla blanca (mm)
    const innerH = maxH - PAD * 2
    const innerMaxW = maxW - PAD * 2
    let w = innerH * ratio
    let h = innerH
    if (w > innerMaxW) { w = innerMaxW; h = innerMaxW / ratio }
    // Pastilla blanca: un logo con fondo transparente o de colores oscuros
    // sigue legible sobre el encabezado azul.
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, y + (maxH - h) / 2 - PAD, w + PAD * 2, h + PAD * 2, 1.5, 1.5, 'F')
    doc.addImage(logo, fmt, x + PAD, y + (maxH - h) / 2, w, h)
    return w + PAD * 2
  } catch {
    return 0 // logo corrupto o formato no soportado — se omite
  }
}

/** Lee las dimensiones de un data URL (solo navegador). */
export function dimensionesImagen(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise(resolve => {
    const img = new window.Image()
    img.onload = () => resolve({ w: img.width, h: img.height })
    img.onerror = () => resolve(null)
    img.src = src
  })
}
