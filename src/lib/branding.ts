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
    let w = maxH * ratio
    let h = maxH
    if (w > maxW) { w = maxW; h = maxW / ratio }
    doc.addImage(logo, fmt, x, y + (maxH - h) / 2, w, h)
    return w
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
