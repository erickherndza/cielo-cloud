// Ciclo de vida del proceso: cierre ordenado y red de seguridad ante errores no previstos.
//
// DigitalOcean envía SIGTERM en cada despliegue y reinicio. Sin un manejador, Node muere al instante y
// las peticiones en vuelo (incluida una escritura a medias) se pierden. Con cierre ordenado:
// deja de aceptar peticiones nuevas, espera a que terminen las que están en curso, cierra el pool de la
// base y sale con código 0. Si algo no termina a tiempo, sale con 1 para que la plataforma lo reinicie.

export function instalarCierreOrdenado({ app, pool, plazoMs = 25_000, proceso = process, salir = (c) => process.exit(c) }) {
  let cerrando = null

  async function cerrar(motivo, codigo = 0) {
    if (cerrando) return cerrando
    app.log.warn({ motivo }, 'cierre ordenado: dejando de aceptar peticiones')
    const duro = setTimeout(() => { app.log.error('el cierre ordenado excedió el plazo: salida forzada'); salir(1) }, plazoMs)
    duro.unref?.()
    app.cerrando = true
    cerrando = (async () => {
      try {
        await app.close()               // espera a que terminen las peticiones en curso
        await pool.end()
        clearTimeout(duro)
        salir(codigo)
      } catch (e) {
        app.log.error({ err: e }, 'error durante el cierre ordenado')
        salir(1)
      }
    })()
    return cerrando
  }

  proceso.on('SIGTERM', () => { void cerrar('SIGTERM') })
  proceso.on('SIGINT', () => { void cerrar('SIGINT') })
  // Un error no previsto deja el proceso en un estado dudoso: se registra, se cierra con orden y se
  // sale con error (la plataforma lo reinicia). Mejor un reinicio limpio que seguir con estado corrupto.
  proceso.on('uncaughtException', (err) => { app.log.fatal({ err }, 'excepción no capturada'); void cerrar('uncaughtException', 1) })
  proceso.on('unhandledRejection', (err) => { app.log.fatal({ err }, 'promesa rechazada sin manejar'); void cerrar('unhandledRejection', 1) })
  return { cerrar, estaCerrando: () => cerrando !== null }
}
