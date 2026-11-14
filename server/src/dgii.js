// Consulta de RNC en la página pública de la DGII (formulario ASP.NET con
// ViewState, sin captcha). NO es una API oficial: la página puede cambiar; si
// no se reconoce la respuesta se lanza un error y la app permite continuar con
// un aviso. El navegador no puede llamarla directo (ViewState/CORS), por eso
// pasa por nuestra API.

const URL_CONSULTA = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx'
const PESOS = [7, 9, 8, 6, 5, 4, 3, 2]

export function limpiarRnc(v) { return String(v ?? '').replace(/\D/g, '') }

// RNC de empresa (9 dígitos) con dígito verificador (probado contra el listado
// oficial: 100 % de las empresas activas). 11 dígitos = cédula de persona física
// con negocio: solo se valida el largo.
export function rncValido(v) {
  const d = limpiarRnc(v)
  if (d.length === 11) return true
  if (d.length !== 9) return false
  const m = PESOS.reduce((s, p, i) => s + Number(d[i]) * p, 0) % 11
  const dv = m === 0 ? 2 : m === 1 ? 1 : 11 - m
  return dv === Number(d[8])
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodificar(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENT[e.toLowerCase()] ?? m
  })
}
const texto = (h) => decodificar(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function oculto(html, nombre) {
  const m = html.match(new RegExp(`id="${nombre}"[^>]*value="([^"]*)"`)) ?? html.match(new RegExp(`name="${nombre}"[^>]*value="([^"]*)"`))
  return m ? decodificar(m[1]) : ''
}

const CAMPOS = {
  'cedula/rnc': 'rnc', 'nombre/razon social': 'razonSocial', 'nombre comercial': 'nombreComercial',
  'categoria': 'categoria', 'regimen de pagos': 'regimenPagos', 'estado': 'estado',
  'actividad economica': 'actividadEconomica', 'administracion local': 'administracionLocal',
  'facturador electronico': 'facturadorElectronico',
}

// Interpreta el HTML de resultado. Exportada para probarla sin red.
export function interpretarRespuesta(html) {
  const tabla = html.match(/id="cphMain_dvDatosContribuyentes"[\s\S]*?<\/table>/)
  if (tabla) {
    const out = {}
    for (const fila of tabla[0].match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const c = (fila.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(texto)
      const campo = CAMPOS[sinAcentos(c[0] ?? '')]
      if (campo && c.length >= 2) out[campo] = c[1]
    }
    if (out.razonSocial) {
      return { encontrado: true, ...out, rnc: limpiarRnc(out.rnc) }
    }
  }
  const info = html.match(/id="cphMain_lblInformacion"[^>]*>([^<]*)/)
  if (info && /no se encuentra inscrito/i.test(info[1])) return { encontrado: false }
  throw new Error('Respuesta de la DGII no reconocida')
}

export async function consultarDgii(rnc, fetchFn = fetch) {
  const d = limpiarRnc(rnc)
  const señal = () => AbortSignal.timeout(10_000)
  const h = { 'User-Agent': 'Mozilla/5.0 (compatible; CieloNomina)', Accept: 'text/html' }
  const r1 = await fetchFn(URL_CONSULTA, { headers: h, signal: señal() })
  if (!r1.ok) throw new Error(`DGII ${r1.status}`)
  const html1 = await r1.text()
  const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
  const cuerpo = new URLSearchParams({
    __EVENTTARGET: 'ctl00$cphMain$btnBuscarPorRNC', __EVENTARGUMENT: '',
    __VIEWSTATE: oculto(html1, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: oculto(html1, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: oculto(html1, '__EVENTVALIDATION'),
    'ctl00$cphMain$txtRNCCedula': d, 'ctl00$cphMain$txtRazonSocial': '', 'ctl00$cphMain$hidActiveTab': '',
  })
  if (!cuerpo.get('__VIEWSTATE')) throw new Error('Página de la DGII sin ViewState')
  const r2 = await fetchFn(URL_CONSULTA, {
    method: 'POST', body: cuerpo, signal: señal(),
    headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookies ? { Cookie: cookies } : {}) },
  })
  if (!r2.ok) throw new Error(`DGII ${r2.status}`)
  return { ...interpretarRespuesta(await r2.text()), consultadoEn: new Date().toISOString() }
}

// Caché en memoria: 24 h para encontrados, 1 h para «no inscrito». Los fallos no se guardan.
export function crearConsultaConCache(fetchFn = fetch, ahora = () => Date.now()) {
  const cache = new Map()
  return async function consulta(rnc) {
    const d = limpiarRnc(rnc)
    const hit = cache.get(d)
    if (hit && hit.exp > ahora()) return hit.valor
    const valor = await consultarDgii(d, fetchFn)
    if (cache.size >= 5000) cache.delete(cache.keys().next().value)
    cache.set(d, { valor, exp: ahora() + (valor.encontrado ? 24 : 1) * 3_600_000 })
    return valor
  }
}
