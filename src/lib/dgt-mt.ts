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

export type TipoDGT = 'DGT3' | 'DGT4'
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
}): ResultadoDGT {
  const { tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio } = args
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

export function lineasDGT(rnc: string, tipo: TipoDGT, mes: number, anio: number, filas: FilaDGT[]): string[] {
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
