// Archivo de Autodeterminación Mensual (AM) para la TSS / SUIRPLUS.
// Estructura tomada del "Instructivo para construcción de archivos de
// autodeterminación y novedades v6.0" (TSS) y de la macro de la plantilla
// Excel oficial v5.5 (la macro es la referencia del orden real de campos).
//
// Reglas de negocio de Cielo Cloud (interpretación propia, a validar con la TSS
// en el primer envío real):
//  - Salario_SS = todo lo cotizable a TSS del mes: salario (prorrateado), horas
//    extras, recargo nocturno, comisiones, otros ingresos, vacaciones (goce/venta), días
//    pendientes de ingreso, ingresos personalizados con "afecta TSS" y, si hubo
//    liquidación, días trabajados y vacaciones no gozadas (son salario).
//  - Salario_ISR solo se reporta si difiere del Salario_SS.
//  - Otras remuneraciones (ISR) = Bonos, bonificación por utilidades (Art. 223) pagada en el mes y los
//    ingresos personalizados que pagan ISR pero NO cotizan a TSS.
//  - Ingresos exentos: 01 Regalía Pascual, 02 cesantía/preaviso/asistencia
//    económica. 03 (pensión alimenticia) no existe en el sistema.
//  - Se reporta el salario real (sin aplicar topes): la TSS aplica sus topes.

import type { Empleado, Empresa, PeriodoNomina, RegistroLiquidacion, AjusteLinea, ResultadoNomina } from '@/types'
import { calcularConPeriodo } from '@/lib/dominican-labor'
import { parseFechaLocal } from '@/lib/utils'
import {
  padN, padTexto, padTextoDerecha, monto16, montoExento, fechaDDMMAAAA,
  clave11, periodoMMAAAA, limpiarDocumento, textoLatin1,
} from '@/lib/ancho-fijo'

export type TipoIngresoAM = '0001' | '0009' | '0010'

export interface FilaAM {
  empleado: Empleado
  clave: string
  tipoDoc: 'C' | 'N' | 'P'
  documento: string
  nombres: string
  apellido1: string
  apellido2: string
  sexo: string
  fechaNac: string           // DDMMAAAA o ''
  salarioSS: number
  aporteVoluntario: number
  salarioISR: number         // 0 si es igual al Salario_SS
  otrasRemuneraciones: number
  exentoRegalia: number
  exentoIndemnizaciones: number
  tipoIngreso: TipoIngresoAM
  detalleFuentes: string[]
  /** De qué se compone el salario cotizable (siempre en bruto, antes de AFP/SFS/ISR). */
  componentesSS: { concepto: string; monto: number }[]
  errores: string[]
  avisos: string[]
}

export interface ResultadoAM {
  mes: number
  anio: number
  periodosUsados: string[]
  filas: FilaAM[]
  totales: { salarioSS: number; otras: number; exentos: number; empleados: number }
  erroresGlobales: string[]
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'san', 'santa', 'y'])

/** Separa "De los Santos Pérez" en primer y segundo apellido, respetando partículas. */
export function separarApellidos(apellido: string): [string, string] {
  const t = (apellido ?? '').trim().split(/\s+/).filter(Boolean)
  if (t.length === 0) return ['', '']
  let i = 0
  while (i < t.length - 1 && PARTICULAS.has(t[i].toLowerCase())) i++
  const primero = t.slice(0, i + 1).join(' ')
  return [primero, t.slice(i + 1).join(' ')]
}

function mesAnioDe(iso: string | undefined): { mes: number; anio: number } | null {
  if (!iso) return null
  const d = parseFechaLocal(iso)
  return isNaN(d.getTime()) ? null : { mes: d.getMonth() + 1, anio: d.getFullYear() }
}

/** Mes en que se pagó un período especial (regalía / bonificación). */
function mesDePago(p: PeriodoNomina): { mes: number; anio: number } | null {
  return mesAnioDe(p.fechaPago) ?? mesAnioDe(p.fechaGeneracion)
}

function idsProcesados(p: PeriodoNomina, empleados: Empleado[]): string[] {
  if (p.empleadosProcesados?.length) return p.empleadosProcesados
  if (p.estado === 'en_proceso') return []
  const guardados = Object.keys(p.resultadosPorEmpleado ?? p.montosRegalia ?? p.montosBonificacion ?? {})
  if (guardados.length) return guardados
  // Período cerrado sin lista guardada (datos antiguos o demo): empleados vigentes ese mes.
  if (p.tipo !== 'mensual' && p.tipo !== 'quincenal') return []
  const fin = new Date(p.anio, p.mes, 0)
  return empleados.filter(e => e.activo && parseFechaLocal(e.fechaIngreso) <= fin).map(e => e.id)
}

function baseLegado(r: ResultadoNomina): number {
  return r.salarioBruto + r.importeHE35 + r.importeHE100 + r.importeNocturno + r.bonificaciones +
    r.comisiones + r.vacacionesGoce + r.vacacionesVendidas + r.diasIngresoPendientes
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function construirAutodeterminacion(args: {
  empresa: Empresa
  empleados: Empleado[]
  periodos: PeriodoNomina[]
  liquidaciones: RegistroLiquidacion[]
  mes: number
  anio: number
}): ResultadoAM {
  const { empresa, empleados, periodos, liquidaciones, mes, anio } = args
  const porId = new Map(empleados.map(e => [e.id, e]))
  const acc = new Map<string, {
    ss: number; isr: number; vol: number; otras: number; reg: number; ind: number
    fuentes: string[]; salida: boolean; comp: Map<string, number>
  }>()
  const get = (id: string) => {
    let a = acc.get(id)
    if (!a) { a = { ss: 0, isr: 0, vol: 0, otras: 0, reg: 0, ind: 0, fuentes: [], salida: false, comp: new Map() }; acc.set(id, a) }
    return a
  }
  const sumar = (x: { comp: Map<string, number> }, concepto: string, monto: number) => {
    if (Math.abs(monto) > 0.004) x.comp.set(concepto, (x.comp.get(concepto) ?? 0) + monto)
  }
  const periodosUsados: string[] = []

  // 1) Nómina ordinaria del mes (mensual o ambas quincenas)
  for (const p of periodos) {
    if ((p.tipo !== 'mensual' && p.tipo !== 'quincenal') || p.mes !== mes || p.anio !== anio) continue
    const ids = idsProcesados(p, empleados)
    if (ids.length === 0) continue
    periodosUsados.push(p.tipo === 'quincenal' ? `${p.quincena}ª quincena (${p.estado.replace('_', ' ')})` : `Mensual (${p.estado.replace('_', ' ')})`)
    for (const id of ids) {
      const emp = porId.get(id)
      if (!emp) continue
      const ajustes: AjusteLinea[] = p.ajustesPorEmpleado?.[id] ?? []
      const r = p.resultadosPorEmpleado?.[id] ?? calcularConPeriodo(emp, ajustes, p)
      let customTSS = 0, customAmbos = 0, customSoloISR = 0, bonoSum = 0, otroSum = 0
      for (const a of ajustes) {
        if (a.concepto === 'personalizado' && a.tipo === 'ingreso') {
          if (a.afectaTSS) customTSS += a.valor
          if (a.afectaTSS && a.afectaISR) customAmbos += a.valor
          // Paga ISR pero NO cotiza a TSS → «otras remuneraciones» (instructivo TSS), no salario
          if (a.afectaISR && !a.afectaTSS) customSoloISR += a.valor
        }
      }
      for (const a of ajustes) {
        if (a.concepto === 'bono') bonoSum += a.valor
        if (a.concepto === 'otro_ingreso') otroSum += a.valor
      }
      // Bono = otras remuneraciones (no cotiza TSS). Un snapshot viejo (calculado cuando el
      // bono sí cotizaba) lo trae dentro de r.bonificaciones: se saca del salario cotizable.
      const bonosEnLegado = bonoSum > 0 && Math.abs(r.bonificaciones - (otroSum + bonoSum)) < 0.01 ? bonoSum : 0
      const legado = baseLegado(r) - bonosEnLegado
      const x = get(id)
      x.ss += legado + customTSS
      sumar(x, 'Sueldo', r.salarioBruto)
      sumar(x, 'Horas extras', r.importeHE35 + r.importeHE100)
      sumar(x, 'Recargo nocturno', r.importeNocturno)
      sumar(x, 'Comisiones', r.comisiones)
      sumar(x, 'Otros ingresos', r.bonificaciones - bonosEnLegado)
      sumar(x, 'Vacaciones disfrutadas (goce)', r.vacacionesGoce)
      sumar(x, 'Vacaciones vendidas', r.vacacionesVendidas)
      sumar(x, 'Días pendientes de ingreso', r.diasIngresoPendientes)
      sumar(x, 'Ingresos personalizados que cotizan', customTSS)
      x.isr += legado + customAmbos
      x.otras += customSoloISR + bonoSum
      x.vol += (r.aporteVoluntarioAFPEmpleado || 0) + (r.aporteVoluntarioAFPEmpresa || 0)
      x.fuentes.push(p.tipo === 'quincenal' ? `${p.quincena}ª quincena` : 'Nómina mensual')
    }
  }

  // 2) Regalía Pascual y Bonificación pagadas en el mes
  for (const p of periodos) {
    if ((p.tipo !== 'regalia' && p.tipo !== 'bonificacion') || p.estado === 'en_proceso' && !p.empleadosProcesados?.length) continue
    const m = mesDePago(p)
    if (!m || m.mes !== mes || m.anio !== anio) continue
    const ids = idsProcesados(p, empleados)
    if (ids.length === 0) continue
    periodosUsados.push(p.tipo === 'regalia' ? `Regalía Pascual ${p.anio}${p.complemento ? ' (complemento)' : ''}` : `Bonificación utilidades ${p.anio}`)
    for (const id of ids) {
      if (!porId.has(id)) continue
      const x = get(id)
      if (p.tipo === 'regalia') {
        x.reg += p.montosRegalia?.[id] ?? 0
        x.fuentes.push('Regalía Pascual')
      } else {
        x.otras += p.resultadosPorEmpleado?.[id]?.totalBruto ?? p.montosBonificacion?.[id] ?? 0
        x.fuentes.push('Bonificación')
      }
    }
  }

  // 3) Liquidaciones con salida en el mes
  for (const l of liquidaciones) {
    const m = mesAnioDe(l.fechaTerminacion)
    if (!m || m.mes !== mes || m.anio !== anio || !porId.has(l.empleadoId)) continue
    const x = get(l.empleadoId)
    const salarial = (l.salarioDiasTrabajadosBruto ?? 0) + (l.vacacionesBruto ?? 0)
    x.ss += salarial
    x.isr += salarial
    sumar(x, 'Días trabajados pendientes (liquidación, bruto)', l.salarioDiasTrabajadosBruto ?? 0)
    sumar(x, 'Vacaciones no gozadas (liquidación, bruto)', l.vacacionesBruto ?? 0)
    x.ind += (l.cesantia || 0) + (l.preaviso || 0) + (l.asistenciaEconomica || 0)
    x.reg += l.regalia || 0
    x.salida = true
    x.fuentes.push('Liquidación')
  }
  if (liquidaciones.some(l => mesAnioDe(l.fechaTerminacion)?.mes === mes && mesAnioDe(l.fechaTerminacion)?.anio === anio)) {
    periodosUsados.push('Liquidaciones del mes')
  }

  // 4) Filas
  const filas: FilaAM[] = []
  for (const [id, x] of Array.from(acc.entries())) {
    const emp = porId.get(id)!
    if (x.ss + x.isr + x.otras + x.reg + x.ind < 0.005) continue
    const errores: string[] = []
    const avisos: string[] = []
    const esCedula = (emp.tipoDocumento ?? 'cedula') === 'cedula'
    const documento = limpiarDocumento(emp.cedula)
    const tipoDoc: 'C' | 'P' = esCedula ? 'C' : 'P'
    if (!documento) errores.push('Sin número de documento')
    else if (esCedula && !/^\d{11}$/.test(documento)) errores.push('La cédula debe tener 11 dígitos')
    const [ap1, ap2] = separarApellidos(emp.apellido)
    if (!emp.nombre?.trim()) errores.push('Sin nombre')
    if (!ap1) errores.push('Sin apellido')
    if (!esCedula) {
      if (!emp.sexo) errores.push('Extranjero sin cédula: falta el sexo')
      if (!emp.fechaNacimiento) errores.push('Extranjero sin cédula: falta la fecha de nacimiento')
    }
    if (x.ss < 0.005 && (x.reg + x.ind + x.otras) > 0) avisos.push('Solo ingresos exentos o extraordinarios, sin salario cotizable')
    const ingresoEnMes = mesAnioDe(emp.fechaIngreso)
    const tipoIngreso: TipoIngresoAM = x.salida ? '0010'
      : ingresoEnMes && ingresoEnMes.mes === mes && ingresoEnMes.anio === anio ? '0009' : '0001'
    const ss = r2(x.ss), isr = r2(x.isr)
    filas.push({
      empleado: emp,
      clave: '001',
      tipoDoc,
      documento,
      nombres: textoLatin1(emp.nombre),
      apellido1: textoLatin1(ap1),
      apellido2: textoLatin1(ap2),
      sexo: emp.sexo ?? '',
      fechaNac: fechaDDMMAAAA(emp.fechaNacimiento),
      salarioSS: ss,
      aporteVoluntario: r2(x.vol),
      salarioISR: Math.abs(isr - ss) > 0.005 ? isr : 0,
      otrasRemuneraciones: r2(x.otras),
      exentoRegalia: r2(x.reg),
      exentoIndemnizaciones: r2(x.ind),
      tipoIngreso,
      detalleFuentes: Array.from(new Set(x.fuentes)),
      componentesSS: Array.from(x.comp.entries()).map(([concepto, monto]) => ({ concepto, monto: r2(monto) })),
      errores,
      avisos,
    })
  }
  filas.sort((a, b) => `${a.apellido1} ${a.nombres}`.localeCompare(`${b.apellido1} ${b.nombres}`, 'es'))

  const erroresGlobales: string[] = []
  const rncDigitos = (empresa.rnc ?? '').replace(/\D/g, '')
  if (rncDigitos.length !== 9 && rncDigitos.length !== 11) erroresGlobales.push('El RNC de la empresa no está completo (9 u 11 dígitos). Configúralo en Configuración → Empresa.')
  if (filas.length === 0) erroresGlobales.push('No hay nómina procesada ni pagos especiales en este mes.')
  const docs = new Map<string, number>()
  for (const f of filas) docs.set(f.documento, (docs.get(f.documento) ?? 0) + 1)
  for (const f of filas) if (f.documento && (docs.get(f.documento) ?? 0) > 1) f.errores.push('Documento repetido en el archivo')

  return {
    mes, anio, periodosUsados: Array.from(new Set(periodosUsados)), filas,
    totales: {
      salarioSS: r2(filas.reduce((s, f) => s + f.salarioSS, 0)),
      otras: r2(filas.reduce((s, f) => s + f.otrasRemuneraciones, 0)),
      exentos: r2(filas.reduce((s, f) => s + f.exentoRegalia + f.exentoIndemnizaciones, 0)),
      empleados: filas.length,
    },
    erroresGlobales,
  }
}

/** Líneas del archivo AM (o AR, retroactiva): encabezado, detalle y sumario. */
export function lineasAutodeterminacion(rnc: string, mes: number, anio: number, filas: FilaAM[], proceso: 'AM' | 'AR' = 'AM'): string[] {
  const lineas: string[] = [`E${proceso}${clave11(rnc)}${periodoMMAAAA(mes, anio)}`]
  for (const f of filas) {
    lineas.push(
      'D' +
      padN(f.clave, 3) +
      f.tipoDoc +
      padTexto(f.documento, 25) +
      padTexto(f.nombres, 50) +
      padTexto(f.apellido1, 40) +
      padTexto(f.apellido2, 40) +
      padTextoDerecha(f.sexo, 1) +
      padTextoDerecha(f.fechaNac, 8) +
      monto16(f.salarioSS) +
      monto16(f.aporteVoluntario) +
      monto16(f.salarioISR) +
      monto16(f.otrasRemuneraciones) +
      padTextoDerecha('', 11) +          // RNC del agente de retención único (no aplica)
      monto16(0) +                       // remuneraciones de otros empleadores (no aplica)
      monto16(0) +                       // ingresos exentos: va en blanco/ceros y se detalla al final
      monto16(0) +                       // saldo a favor del período
      monto16(0) +                       // salario cotizable INFOTEP (solo si difiere del SS)
      f.tipoIngreso +
      montoExento('01', f.exentoRegalia) +
      montoExento('02', f.exentoIndemnizaciones),
    )
  }
  lineas.push(`S${padN(filas.length + 2, 6)}`)
  return lineas
}

export function nombreArchivoAM(rnc: string, mes: number, anio: number, proceso: 'AM' | 'AR' = 'AM'): string {
  return `${proceso}_${(rnc ?? '').replace(/\D/g, '')}_${periodoMMAAAA(mes, anio)}.txt`
}
