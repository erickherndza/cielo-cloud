// Reglas de integridad de la colección «periodos», aplicadas en el SERVIDOR.
//
// Antes, que un período cerrado fuera inmutable solo se garantizaba en el navegador
// (src/lib/periodos-context.tsx): un usuario con permiso de escritura que llamara a la
// API directamente podía alterar una nómina ya cerrada o pagada. Estas reglas repiten esos
// mismos candados donde no se pueden saltar. Son una función pura (existentes, nuevos) →
// mensaje de error o null, fácil de probar.
//
// Qué se permite sobre un período que YA estaba procesado o cerrado:
//   · quedar igual;
//   · marcar / desmarcar el pago (solo cambian `pagada` y `fechaPago`);
//   · procesada → cerrada (cambia solo `estado`);
//   · reabrirlo (desposteo): vuelve a en_proceso, nunca si ya está pagado, y deja una entrada
//     más en `bitacoraDesposteos` con el estado anterior;
//   · eliminar uno procesado (el cliente lo permite); uno cerrado nunca se elimina.
// Todo lo demás (cambiar montos, empleados, ajustes, snapshots, fechas…) se rechaza.

const CAMPOS_DE_PAGO = new Set(['pagada', 'fechaPago'])

// JSON canónico: claves ordenadas, sin depender del orden en que jsonb las devuelve.
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

function sinCampos(p, omitir) {
  const o = {}
  for (const k of Object.keys(p)) if (!omitir.has(k)) o[k] = p[k]
  return o
}

const etiqueta = (p) => `${p.tipo ?? 'período'} ${p.mes ?? ''}/${p.anio ?? ''}${p.quincena ? ` Q${p.quincena}` : ''}`.trim()

/** @returns {string|null} mensaje si el cambio viola una regla; null si es válido. */
export function validarPeriodos(existentes, nuevos) {
  if (!Array.isArray(existentes)) return null               // sin datos previos o formato desconocido: nada que proteger
  if (!Array.isArray(nuevos)) return 'La colección de períodos debe ser una lista'
  const porId = new Map(nuevos.map(p => [p?.id, p]))
  if (porId.size !== nuevos.length) return 'Hay períodos con id repetido o sin id'

  for (const E of existentes) {
    if (!E || (E.estado !== 'procesada' && E.estado !== 'cerrada')) continue   // en_proceso se edita libremente
    const N = porId.get(E.id)
    const nombre = etiqueta(E)

    if (!N) {
      if (E.estado === 'cerrada') return `El período ${nombre} está cerrado y no se puede eliminar`
      continue                                              // procesada: el cliente permite eliminarla
    }

    // Igual salvo el estado de pago → válido (marcar o deshacer el pago).
    if (canonico(sinCampos(E, CAMPOS_DE_PAGO)) === canonico(sinCampos(N, CAMPOS_DE_PAGO))) continue

    // procesada → cerrada: cambia solo `estado`.
    if (E.estado === 'procesada' && N.estado === 'cerrada'
      && canonico(sinCampos(E, new Set([...CAMPOS_DE_PAGO, 'estado']))) === canonico(sinCampos(N, new Set([...CAMPOS_DE_PAGO, 'estado'])))) continue

    // Reapertura (desposteo).
    if (N.estado === 'en_proceso') {
      if (E.pagada) return `El período ${nombre} está pagado: primero hay que deshacer el pago antes de reabrirlo`
      const bitE = E.bitacoraDesposteos ?? [], bitN = N.bitacoraDesposteos ?? []
      const ultimo = bitN[bitN.length - 1]
      if (bitN.length !== bitE.length + 1 || ultimo?.estadoAnterior !== E.estado) {
        return `Reabrir el período ${nombre} debe quedar registrado en la bitácora de desposteos`
      }
      if (canonico(bitN.slice(0, -1)) !== canonico(bitE)) return `No se puede alterar la bitácora de desposteos de ${nombre}`
      const identidad = ['id', 'tipo', 'mes', 'anio', 'quincena']
      if (identidad.some(k => canonico(E[k]) !== canonico(N[k]))) return `Al reabrir ${nombre} no se puede cambiar su identidad`
      continue
    }

    return `El período ${nombre} está ${E.estado === 'cerrada' ? 'cerrado' : 'procesado'} y no se puede modificar; reábrelo primero`
  }
  return null
}
