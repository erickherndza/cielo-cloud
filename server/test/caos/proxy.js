// Proxy TCP de caos: se coloca entre la API y Postgres y permite inyectar fallas de red
// reales (sin tocar Docker ni el servidor): corte de conexiones, paquetes que se pierden,
// rechazo de conexiones y latencia. Es una herramienta de PRUEBA: nunca se usa contra producción.
import net from 'node:net'

export class ProxyCaos {
  /** @param {{host:string, port:number}} destino */
  constructor(destino) {
    this.destino = destino
    this.modo = 'normal'      // normal | agujero | rechazo
    this.latenciaMs = 0       // retraso por bloque de datos, en ambos sentidos
    this.sockets = new Set()
    this.conexiones = 0
    this.server = net.createServer(c => this.#alConectar(c))
  }

  async iniciar() {
    await new Promise(r => this.server.listen(0, '127.0.0.1', r))
    return this.server.address().port
  }

  get puerto() { return this.server.address().port }

  #registrar(s) { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); s.on('error', () => {}); return s }

  #alConectar(cliente) {
    this.conexiones++
    this.#registrar(cliente)
    if (this.modo === 'rechazo') return cliente.destroy()
    if (this.modo === 'agujero') return                      // acepta y no responde nunca (red que traga paquetes)
    const up = this.#registrar(net.connect(this.destino))
    const reenviar = (de, a) => de.on('data', buf => {
      if (this.modo === 'agujero') return
      if (this.latenciaMs > 0) setTimeout(() => { if (!a.destroyed) a.write(buf) }, this.latenciaMs)
      else a.write(buf)
    })
    reenviar(cliente, up); reenviar(up, cliente)
    up.on('close', () => cliente.destroy()); cliente.on('close', () => up.destroy())
  }

  /** Corta de golpe todas las conexiones abiertas (como un reinicio de la base o un corte de red). */
  cortarTodas() { for (const s of [...this.sockets]) s.resetAndDestroy?.() ?? s.destroy() }

  /** Deja de aceptar conexiones: ECONNREFUSED real. */
  async apagar() { this.cortarTodas(); await new Promise(r => this.server.close(r)) }
  async encender(puerto) { await new Promise(r => this.server.listen(puerto, '127.0.0.1', r)) }

  normal() { this.modo = 'normal'; this.latenciaMs = 0 }
}

/** Convierte la DATABASE_URL real en una que pasa por el proxy. */
export function urlPorProxy(urlReal, puertoProxy) {
  const u = new URL(urlReal); u.hostname = '127.0.0.1'; u.port = String(puertoProxy); return u.toString()
}
export function destinoDe(urlReal) { const u = new URL(urlReal); return { host: u.hostname, port: Number(u.port || 5432) } }
export const dormir = (ms) => new Promise(r => setTimeout(r, ms))
export async function conLimite(promesa, ms, etiqueta = 'operación') {
  let t
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${etiqueta}: sin respuesta tras ${ms} ms (colgada)`)), ms) })
  try { return await Promise.race([promesa, limite]) } finally { clearTimeout(t) }
}
