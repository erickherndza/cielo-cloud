// Utilidades para construir archivos de texto de ANCHO FIJO (TSS autodeterminación,
// DGT del Ministerio de Trabajo). Sin dependencias: se prueba con Node directo
// (ver scripts/test-ancho-fijo.mjs). Las reglas replican las macros de las
// plantillas oficiales (AbultarParametroN / C / CI).

/** Relleno de ceros a la izquierda; si excede, se recorta por la derecha (igual que la macro). */
export function padN(valor: string | number, n: number): string {
  let s = String(valor ?? '')
  if (s.length > n) s = s.slice(0, n)
  return s.padStart(n, '0')
}

/** Texto justificado a la izquierda, relleno de espacios a la derecha. */
export function padTexto(valor: string | undefined | null, n: number): string {
  let s = (valor ?? '').toString().trim()
  if (s.length > n) s = s.slice(0, n)
  return s.padEnd(n, ' ')
}

/** Texto justificado a la derecha, relleno de espacios a la izquierda. */
export function padTextoDerecha(valor: string | undefined | null, n: number): string {
  let s = (valor ?? '').toString().trim()
  if (s.length > n) s = s.slice(0, n)
  return s.padStart(n, ' ')
}

/** Monto con dos decimales en 16 posiciones: 9999999999999.99 (el punto cuenta). */
export function monto16(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
  return padN(v.toFixed(2), 16)
}

/** Ingreso exento: código de 2 posiciones + monto de 16 (18 en total). */
export function montoExento(codigo: '01' | '02' | '03', n: number): string {
  return n > 0.004 ? codigo + monto16(n) : ''
}

/** ISO (YYYY-MM-DD o con hora) → DDMMAAAA. Vacío si no hay fecha. */
export function fechaDDMMAAAA(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}${m[2]}${m[1]}` : ''
}

/** RNC/cédula del empleador: 11 posiciones, justificado a la derecha con espacios. */
export function clave11(rnc: string): string {
  const d = (rnc ?? '').replace(/\D/g, '')
  return d.padStart(11, ' ')
}

/** MMAAAA */
export function periodoMMAAAA(mes: number, anio: number): string {
  return `${String(mes).padStart(2, '0')}${String(anio).padStart(4, '0')}`
}

/** Solo dígitos y letras, sin guiones ni caracteres especiales (documentos). */
export function limpiarDocumento(v: string | undefined | null): string {
  return (v ?? '').replace(/[^0-9A-Za-z]/g, '')
}

/** Mayúsculas sin caracteres fuera de Latin-1 (el archivo se guarda en Windows-1252). */
export function textoLatin1(v: string | undefined | null): string {
  return (v ?? '')
    .toString()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .split('')
    .map(ch => (ch.charCodeAt(0) < 256 ? ch : ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\xFF]/g, '?')))
    .join('')
    .trim()
}

/** Cada carácter a un byte (Windows-1252 ≈ Latin-1 para el español). Líneas con CRLF, como la macro. */
export function aBytesLatin1(lineas: string[]): Uint8Array {
  const texto = lineas.join('\r\n') + '\r\n'
  const out = new Uint8Array(texto.length)
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    out[i] = c < 256 ? c : 63 // '?'
  }
  return out
}
