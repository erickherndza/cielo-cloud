// Formularios DGT del Ministerio de Trabajo (carga por SIRLA, sirla.mt.gob.do).
// Implementados: DGT-3 (novedades de ingreso) y DGT-4 (salidas y cambios, incluye
// vacaciones). Estructura tomada de la macro de la "Plantilla General" oficial
// (Ver. 3.4.9): E + tipo (T3/T4) + RNC(11) + MMAAAA, detalle D…, sumario S.
//
// Pendientes (necesitan datos que el sistema aún no captura): DGT-2 (horas extras
// día por día), DGT-5 (días trabajados × salario por día), DGT-11 (temporada),
// DGT-12 (localidad).

import type { Empleado, Empresa, RegistroLiquidacion, RegistroAumento, DisfruteVacaciones } from '@/types'
import { parseFechaLocal } from '@/lib/utils'
import { separarApellidos } from '@/lib/tss-autodeterminacion'
import {
  padN, padTexto, padTextoDerecha, monto16, fechaDDMMAAAA, clave11,
  periodoMMAAAA, limpiarDocumento, textoLatin1,
} from '@/lib/ancho-fijo'

export type TipoDGT = 'DGT2' | 'DGT3' | 'DGT4' | 'DGT5' | 'DGT11' | 'DGT12'
export type TipoNovedad = 'NI' | 'NS' | 'NC'

export interface CatalogosMT {
  nac: [string, string][]   // [texto, código]
  ocup: [string, string][]
  disc: [string, string][]
  edu: [string, string][]
}

// ISO 3166-1 alpha-2 → código de nacionalidad del catálogo del Ministerio.
// Solo los países comunes, verificados contra el catálogo; el resto se elige a mano.
export const NACIONALIDAD_MT_POR_ISO: Record<string, string> = {
  DO: '1', US: '2', CA: '3', MX: '4', HT: '5', CU: '6', JM: '7', AR: '8', BO: '9', BR: '10',
  CL: '11', CO: '12', EC: '13', PY: '14', PE: '15', SV: '16', UY: '17', VE: '18', CR: '19',
  HN: '20', NI: '21', PA: '22', GT: '23', DE: '24', ES: '29', FR: '31', NL: '33', GB: '35',
  IT: '38', PT: '40', RU: '42', CH: '44', TR: '45', IL: '50', LB: '53', SY: '55', CN: '60',
  JP: '63', KR: '64', TW: '68',
}

export function nacionalidadMTDe(emp: Empleado): string {
  return emp.nacionalidadMT || NACIONALIDAD_MT_POR_ISO[emp.nacionalidad ?? 'DO'] || ''
}

export interface FilaDGT {
  empleado: Empleado
  tipoNov: TipoNovedad
  etiqueta: string          // texto para la tabla: "Ingreso", "Salida", "Cambio de salario", "Vacaciones"
  tipoDoc: 'C' | 'P' | 'M'
  documento: string
  nombres: string
  apellido1: string
  apellido2: string
  sexo: string
  fechaNac: string
  salario: number
  fechaIngreso: string
  fechaSalida: string
  ocupacion: string
  ocupacionDesc: string
  inicioVac: string
  finVac: string
  turno: string
  establecimiento: string
  nacionalidad: string
  fechaCambio: string
  nivelEdu: string
  discapacidades: string
  errores: string[]
  avisos: string[]
  // Solo según el formulario
  dias?: number              // DGT-5: días trabajados
  salarioDia?: number        // DGT-5: salario por día
  localidad?: string         // DGT-12
  valorHora?: number         // DGT-2
  causa?: string             // DGT-2: letras A–E separadas por coma
  horasDia?: Record<string, { h: number; pct: number }>  // DGT-2
}

export interface ResultadoDGT {
  tipo: TipoDGT
  mes: number
  anio: number
  filas: FilaDGT[]
  erroresGlobales: string[]
}

function enMes(iso: string | undefined, mes: number, anio: number): boolean {
  if (!iso) return false
  const d = parseFechaLocal(iso)
  return !isNaN(d.getTime()) && d.getMonth() + 1 === mes && d.getFullYear() === anio
}

function solapaMes(inicio: string, fin: string, mes: number, anio: number): boolean {
  const a = parseFechaLocal(inicio), b = parseFechaLocal(fin)
  const ini = new Date(anio, mes - 1, 1), fn = new Date(anio, mes, 0)
  return !isNaN(a.getTime()) && !isNaN(b.getTime()) && a <= fn && b >= ini
}

export function construirDGT(args: {
  tipo: TipoDGT
  empresa: Empresa
  empleados: Empleado[]
  liquidaciones: RegistroLiquidacion[]
  aumentos: RegistroAumento[]
  disfrutes: DisfruteVacaciones[]
  mes: number
  anio: number
  extras?: ExtrasDGT
}): ResultadoDGT {
  const { tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio } = args
  if (tipo !== 'DGT3' && tipo !== 'DGT4') return construirDGTOtros({ ...args, tipo })
  const porId = new Map(empleados.map(e => [e.id, e]))
  const filas: FilaDGT[] = []

  function base(emp: Empleado, tipoNov: TipoNovedad, etiqueta: string): FilaDGT {
    const esCedula = (emp.tipoDocumento ?? 'cedula') === 'cedula'
    const [ap1, ap2] = separarApellidos(emp.apellido)
    const errores: string[] = []
    const avisos: string[] = []
    const documento = limpiarDocumento(emp.cedula)
    if (!documento) errores.push('Sin número de documento')
    else if (esCedula && !/^\d{11}$/.test(documento)) errores.push('La cédula debe tener 11 dígitos')
    if (!emp.sexo) errores.push('Falta el sexo')
    if (!emp.fechaNacimiento) errores.push('Falta la fecha de nacimiento')
    const nacionalidad = nacionalidadMTDe(emp)
    if (!nacionalidad) errores.push('Falta la nacionalidad del catálogo del Ministerio')
    const ocupacion = emp.ocupacionMT ?? ''
    if (!ocupacion) errores.push('Falta la ocupación (catálogo del Ministerio)')
    const turno = emp.turnoId || empresa.dgtTurnoId || ''
    const establecimiento = emp.establecimientoRNL || empresa.dgtEstablecimientoRNL || ''
    if (!turno) errores.push('Falta el ID de turno (en el empleado o por defecto)')
    if (!establecimiento) errores.push('Falta el ID de establecimiento / RNL (en el empleado o por defecto)')
    if (!emp.nivelEducativoMT) avisos.push('Sin nivel educativo')
    return {
      empleado: emp, tipoNov, etiqueta,
      tipoDoc: esCedula ? 'C' : (emp.tipoDocumento === 'pasaporte' ? 'P' : 'M'),
      documento,
      nombres: textoLatin1(emp.nombre), apellido1: textoLatin1(ap1), apellido2: textoLatin1(ap2),
      sexo: emp.sexo ?? '',
      fechaNac: fechaDDMMAAAA(emp.fechaNacimiento),
      salario: emp.salarioBase,
      fechaIngreso: fechaDDMMAAAA(emp.fechaIngreso),
      fechaSalida: '', ocupacion, ocupacionDesc: textoLatin1(emp.ocupacionMTDescripcion ?? emp.cargo),
      inicioVac: '', finVac: '', turno, establecimiento, nacionalidad,
      fechaCambio: '', nivelEdu: emp.nivelEducativoMT ?? '',
      discapacidades: (emp.discapacidadesMT ?? []).filter(Boolean).join(','),
      errores, avisos,
    }
  }

  if (tipo === 'DGT3') {
    for (const e of empleados) {
      if (enMes(e.fechaIngreso, mes, anio)) filas.push(base(e, 'NI', 'Ingreso'))
    }
  } else {
    for (const l of liquidaciones) {
      const e = porId.get(l.empleadoId)
      if (!e || !enMes(l.fechaTerminacion, mes, anio)) continue
      const f = base(e, 'NS', 'Salida')
      f.fechaSalida = fechaDDMMAAAA(l.fechaTerminacion)
      f.fechaIngreso = ''   // la macro oficial exige fecha de ingreso VACÍA en una salida
      filas.push(f)
    }
    // Salidas marcadas en Empleados que todavía no se liquidan: también son novedad de salida.
    const yaConSalida = new Set(filas.filter(f => f.tipoNov === 'NS').map(f => f.empleado.id))
    for (const e of empleados) {
      if (!e.salidaPendiente || yaConSalida.has(e.id) || !enMes(e.fechaSalidaPendiente, mes, anio)) continue
      const f = base(e, 'NS', 'Salida')
      f.fechaSalida = fechaDDMMAAAA(e.fechaSalidaPendiente)
      f.fechaIngreso = ''
      filas.push(f)
    }
    for (const a of aumentos) {
      const e = porId.get(a.empleadoId)
      const fecha = a.fechaEfectiva ?? a.fechaAplicacion
      if (!e || a.estado !== 'aplicado' || !enMes(fecha, mes, anio)) continue
      const f = base(e, 'NC', 'Cambio de salario')
      f.salario = a.salarioNuevo
      f.fechaCambio = fechaDDMMAAAA(fecha)
      filas.push(f)
    }
    for (const d of disfrutes) {
      const e = porId.get(d.empleadoId)
      if (!e || d.tipo === 'venta' || !solapaMes(d.fechaInicio, d.fechaFin, mes, anio)) continue
      const f = base(e, 'NC', 'Vacaciones')
      f.inicioVac = fechaDDMMAAAA(d.fechaInicio)
      f.finVac = fechaDDMMAAAA(d.fechaFin)
      f.fechaCambio = fechaDDMMAAAA(d.fechaInicio)
      filas.push(f)
    }
  }
  filas.sort((a, b) => `${a.apellido1} ${a.nombres}`.localeCompare(`${b.apellido1} ${b.nombres}`, 'es'))

  const erroresGlobales: string[] = []
  const rnc = (empresa.rnc ?? '').replace(/\D/g, '')
  if (rnc.length !== 9 && rnc.length !== 11) erroresGlobales.push('El RNC de la empresa no está completo (9 u 11 dígitos).')
  return { tipo, mes, anio, filas, erroresGlobales }
}

/** Códigos de cero a la izquierda: vacío → todo ceros (igual que la macro). */
const cod = (v: string, n: number) => padN(v || '', n)
/** Fecha DDMMAAAA obligatoria de 8; vacía → ceros. */
const f8 = (v: string) => padN(v || '', 8)

export function lineasDGT(rnc: string, tipo: TipoDGT, mes: number, anio: number, filas: FilaDGT[], extras?: ExtrasDGT): string[] {
  if (tipo !== 'DGT3' && tipo !== 'DGT4') return lineasDGTOtros(rnc, tipo, mes, anio, filas, extras)
  const lineas: string[] = [`E${tipo === 'DGT3' ? 'T3' : 'T4'}${clave11(rnc)}${periodoMMAAAA(mes, anio)}`]
  for (const f of filas) {
    lineas.push(
      'D' +
      padTexto(f.tipoNov, 3) +
      f.tipoDoc +
      padTexto(f.documento, 25) +
      padTexto(f.nombres, 50) +
      padTexto(f.apellido1, 40) +
      padTexto(f.apellido2, 40) +
      f8(f.fechaNac) +
      padTextoDerecha(f.sexo, 1) +
      monto16(f.salario) +
      f8(f.fechaIngreso) +
      (tipo === 'DGT4' ? f8(f.fechaSalida) : '') +   // la macro lo omite por completo en DGT-3
      cod(f.ocupacion, 6) +
      padTexto(f.ocupacionDesc, 150) +
      f8(f.inicioVac) +
      f8(f.finVac) +
      cod(f.turno, 6) +
      cod(f.establecimiento, 6) +
      padTextoDerecha(f.nacionalidad, 3) +
      padTexto(f.fechaCambio, 8) +
      cod(f.nivelEdu, 5) +
      padTextoDerecha(f.discapacidades, 50),
    )
  }
  lineas.push(`S${padN(filas.length + 2, 6)}`)
  return lineas
}

export function nombreArchivoDGT(rnc: string, tipo: TipoDGT, mes: number, anio: number): string {
  return `${(rnc ?? '').replace(/\D/g, '')}_${periodoMMAAAA(mes, anio)}_${tipo}.txt`
}


// ─── DGT-2, DGT-5, DGT-11 y DGT-12 ───────────────────────────────────────────
export interface ExtrasDGT {
  fechaInicioTemporada?: string          // DGT-11 (ISO)
  duracionMeses?: number                 // DGT-11
  diasTrabajados?: Record<string, number>  // DGT-5, por empleado
  salarioPorDia?: Record<string, number>   // DGT-5, por empleado
  incluirIds?: string[]                    // DGT-5 / DGT-11: empleados elegidos a mano además de los del contrato
}

const HORAS_MES = (44 * 52) / 12   // mismo divisor que el motor de nómina (tarifa hora)

export function construirDGTOtros(args: {
  tipo: TipoDGT
  empresa: Empresa
  empleados: Empleado[]
  liquidaciones: RegistroLiquidacion[]
  mes: number
  anio: number
  extras?: ExtrasDGT
}): ResultadoDGT {
  const { tipo, empresa, empleados, liquidaciones, mes, anio, extras } = args
  const filas: FilaDGT[] = []
  const fin = new Date(anio, mes, 0)
  const per = periodoMMAAAA(mes, anio)
  const erroresGlobales: string[] = []
  const rnc = (empresa.rnc ?? '').replace(/\D/g, '')
  if (rnc.length !== 9 && rnc.length !== 11) erroresGlobales.push('El RNC de la empresa no está completo (9 u 11 dígitos).')

  function persona(emp: Empleado, tipoNov: TipoNovedad, etiqueta: string): FilaDGT {
    const esCedula = (emp.tipoDocumento ?? 'cedula') === 'cedula'
    const [ap1, ap2] = separarApellidos(emp.apellido)
    const errores: string[] = []
    const documento = limpiarDocumento(emp.cedula)
    if (!documento) errores.push('Sin número de documento')
    else if (esCedula && !/^\d{11}$/.test(documento)) errores.push('La cédula debe tener 11 dígitos')
    const turno = emp.turnoId || empresa.dgtTurnoId || ''
    const establecimiento = emp.establecimientoRNL || empresa.dgtEstablecimientoRNL || ''
    return {
      empleado: emp, tipoNov, etiqueta,
      tipoDoc: esCedula ? 'C' : (emp.tipoDocumento === 'pasaporte' ? 'P' : 'M'),
      documento, nombres: textoLatin1(emp.nombre), apellido1: textoLatin1(ap1), apellido2: textoLatin1(ap2),
      sexo: emp.sexo ?? '', fechaNac: fechaDDMMAAAA(emp.fechaNacimiento), salario: emp.salarioBase,
      fechaIngreso: fechaDDMMAAAA(emp.fechaIngreso), fechaSalida: '',
      ocupacion: emp.ocupacionMT ?? '', ocupacionDesc: textoLatin1(emp.ocupacionMTDescripcion ?? emp.cargo),
      inicioVac: '', finVac: '', turno, establecimiento, nacionalidad: nacionalidadMTDe(emp),
      fechaCambio: '', nivelEdu: emp.nivelEducativoMT ?? '',
      discapacidades: (emp.discapacidadesMT ?? []).filter(Boolean).join(','),
      errores, avisos: [],
    }
  }
  const completos = (f: FilaDGT) => {
    if (!f.ocupacion) f.errores.push('Falta la ocupación (catálogo del Ministerio)')
    if (!f.turno) f.errores.push('Falta el ID de turno (en el empleado o por defecto)')
    if (!f.establecimiento) f.errores.push('Falta el ID de establecimiento / RNL (en el empleado o por defecto)')
    if (!f.sexo) f.errores.push('Falta el sexo')
    if (!f.fechaNac) f.errores.push('Falta la fecha de nacimiento')
    if (!f.nacionalidad) f.errores.push('Falta la nacionalidad del catálogo del Ministerio')
  }

  if (tipo === 'DGT11') {
    if (!extras?.fechaInicioTemporada) erroresGlobales.push('Indica la fecha de inicio de la temporada.')
    if (!extras?.duracionMeses || extras.duracionMeses < 1 || extras.duracionMeses > 99) erroresGlobales.push('Indica la duración de la temporada en meses (1 a 99).')
    for (const e of empleados) {
      if ((e.tipoContrato !== 'estacional' && !extras?.incluirIds?.includes(e.id)) || !e.activo || parseFechaLocal(e.fechaIngreso) > fin) continue
      const f = persona(e, 'NI', 'Temporada'); completos(f); filas.push(f)
    }
  } else if (tipo === 'DGT5') {
    for (const e of empleados) {
      if ((e.tipoContrato !== 'ocasional' && !extras?.incluirIds?.includes(e.id)) || !e.activo || parseFechaLocal(e.fechaIngreso) > fin) continue
      const f = persona(e, 'NI', 'Móvil / ocasional'); completos(f)
      f.dias = extras?.diasTrabajados?.[e.id]
      f.salarioDia = extras?.salarioPorDia?.[e.id] ?? Math.round((e.salarioBase / 23.83) * 100) / 100
      if (!f.dias || f.dias < 1 || f.dias > 31) f.errores.push('Indica los días trabajados (1 a 31)')
      if (!f.salarioDia || f.salarioDia <= 0) f.errores.push('Indica el salario por día')
      filas.push(f)
    }
  } else if (tipo === 'DGT12') {
    const vistos = new Set<string>()
    const agregar = (e: Empleado | undefined, fechaIso: string | undefined) => {
      if (!e || vistos.has(e.id) || !fechaIso) return
      const d = parseFechaLocal(fechaIso)
      if (isNaN(d.getTime()) || d.getMonth() + 1 !== mes || d.getFullYear() !== anio) return
      vistos.add(e.id)
      const f = persona(e, 'NS', 'Salida')
      f.fechaSalida = fechaDDMMAAAA(fechaIso)
      f.localidad = f.establecimiento
      if (!f.localidad) f.errores.push('Falta el ID de establecimiento / localidad (en el empleado o por defecto)')
      filas.push(f)
    }
    const porId = new Map(empleados.map(e => [e.id, e]))
    for (const l of liquidaciones) agregar(porId.get(l.empleadoId), l.fechaTerminacion)
    for (const e of empleados) if (e.salidaPendiente) agregar(e, e.fechaSalidaPendiente)
  } else if (tipo === 'DGT2') {
    const datos = empresa.horasExtrasDGT2?.[per] ?? {}
    for (const e of empleados) {
      const d = datos[e.id]
      if (!d || Object.keys(d.dias ?? {}).length === 0) continue
      const f = persona(e, 'NC', 'Horas extras')
      f.valorHora = Math.round((e.salarioBase / HORAS_MES) * 100) / 100
      f.horasDia = d.dias
      f.causa = (d.causa ?? '').toUpperCase()
      if (!f.establecimiento) f.errores.push('Falta el ID de establecimiento / RNL (en el empleado o por defecto)')
      if (!/^[A-E]$/.test(f.causa)) f.errores.push('Falta la causa de prolongación (A a E)')
      for (const [dia, v] of Object.entries(d.dias)) {
        if (Number(dia) < 1 || Number(dia) > 31) f.errores.push(`Día ${dia} no válido`)
        if (!(v.h > 0) || v.h >= 100) f.errores.push(`Día ${dia}: horas no válidas`)
        if (!(v.pct > 0) || v.pct >= 1000) f.errores.push(`Día ${dia}: porcentaje no válido`)
      }
      filas.push(f)
    }
    if (filas.length === 0) erroresGlobales.push('Captura las horas extras día por día de al menos un empleado.')
  }
  filas.sort((a, b) => `${a.apellido1} ${a.nombres}`.localeCompare(`${b.apellido1} ${b.nombres}`, 'es'))
  return { tipo, mes, anio, filas, erroresGlobales }
}

/** Formato N2 de la macro DGT-2: entero con ceros a la izquierda + 2 decimales (ancho total n). */
function n2(v: number, ancho: number): string {
  const dig = ancho - 3
  const [ent, dec] = (Number.isFinite(v) && v > 0 ? v : 0).toFixed(2).split('.')
  return ent.slice(-dig).padStart(dig, '0') + '.' + dec
}

export function lineasDGTOtros(rnc: string, tipo: TipoDGT, mes: number, anio: number, filas: FilaDGT[], extras?: ExtrasDGT): string[] {
  const per = periodoMMAAAA(mes, anio)
  const R = clave11(rnc)
  const pie = `S${padN(filas.length + 2, 6)}`
  const out: string[] = []
  if (tipo === 'DGT11') {
    const fi = fechaDDMMAAAA(extras?.fechaInicioTemporada)
    const dur = String(extras?.duracionMeses ?? '').padStart(2, '0')
    out.push(`EG1${R}${per}${fi}${dur}`)
    for (const f of filas) out.push('D' + padTexto('NI', 3) + f.tipoDoc + padTexto(f.documento, 25) + monto16(f.salario) + f8(f.fechaIngreso) + cod(f.ocupacion, 6) + padTexto(f.ocupacionDesc, 150) + cod(f.turno, 6) + cod(f.establecimiento, 6) + cod(f.nivelEdu, 5) + padTextoDerecha(f.discapacidades, 50))
  } else if (tipo === 'DGT5') {
    out.push(`ET5${R}${per}`)
    for (const f of filas) out.push('D' + padTexto('NI', 3) + f.tipoDoc + padTexto(f.documento, 25) + monto16(f.salario) + f8(f.fechaIngreso) + cod(f.ocupacion, 6) + padTexto(f.ocupacionDesc, 150) + cod(f.turno, 6) + cod(f.establecimiento, 6) + padN(String(f.dias ?? 0), 2) + padN((f.salarioDia ?? 0).toFixed(2), 8) + cod(f.nivelEdu, 5) + padTextoDerecha(f.discapacidades, 50))
  } else if (tipo === 'DGT12') {
    out.push(`EG2${R}${per}`)
    for (const f of filas) out.push('D' + f.tipoDoc + padTexto(f.documento, 25) + cod(f.localidad || '000001', 6) + f8(f.fechaSalida))
  } else if (tipo === 'DGT2') {
    out.push(`ET2${R}${per}`)
    for (const f of filas) {
      let dias = ''
      for (let d = 1; d <= 31; d++) { const v = f.horasDia?.[String(d)]; dias += n2(v?.h ?? 0, 5) + n2(v?.pct ?? 0, 6) }
      out.push('D' + padTexto('NC', 3) + f.tipoDoc + padTexto(f.documento, 25) + cod(f.establecimiento, 6) + padN((f.valorHora ?? 0).toFixed(2), 8) + dias + padTexto(f.causa ?? '', 20))
    }
  }
  out.push(pie)
  return out
}
