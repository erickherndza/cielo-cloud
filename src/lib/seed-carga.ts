// Carga de PRUEBA de volumen: 25 empleados y 100 pagos quincenales (50 meses, sep-2022 → oct-2026),
// todos procesados, cerrados y pagados, calculados con el mismo motor que usa la nómina real.
// Sirve para ver cómo se comportan los reportes (autodeterminación TSS, DGT) con mucha historia.
// Datos 100% ficticios. Reemplaza empleados, períodos, aumentos, vacaciones y liquidaciones de la empresa.

import { storage } from './storage'
import { scopedKey, parseFechaLocal } from './utils'
import { calcularCesantia, calcularPreaviso, contarDiasLaborables } from './dominican-labor'
import { calcularParaPeriodo, resultadoRegalia } from './nomina-shared'
import type {
  Empleado, Empresa, PeriodoNomina, AjusteLinea, RegistroAumento, DisfruteVacaciones,
  RegistroLiquidacion, ResultadoNomina,
} from '@/types'

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const r2 = (n: number) => Math.round(n * 100) / 100

function prng(seed: number) {   // determinista: la misma carga siempre da lo mismo
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// [nombre, apellido, sexo, ingreso, salario inicial, cargo, departamento, ocupación MT, descripción, contrato]
type Fila = [string, string, 'M' | 'F', string, number, string, string, string, string, Empleado['tipoContrato']]
const OC = {
  conta: ['5980', 'CONTABLES / CONTADOR'], admin: ['6597', 'SECRETARIOS ADMINISTRATIVOS Y EJECUTIVOS / ASISTENTE ADMINISTRATIVO'],
  aux: ['6838', 'OFICINISTAS GENERALES / AUXILIAR ADMINISTRATIVO'], recep: ['6916', 'RECEPCIONISTAS (FUNCIONES GENERALES) / AUXILIAR DE RECEPCIÓN'],
  super: ['6963', 'EMPLEADOS DE CONTROL DE ABASTECIMIENTOS E INVENTARIO / SUPERVISOR DE ALMACÉN Y SUMINISTRO'],
  mens: ['8028', 'CONDUCTORES DE MOTOCICLETAS / MOTORISTA MENSAJERO'], chofer: ['8037', 'CONDUCTORES DE AUTOBUSES, MINIBUSES Y TRANVÍAS / CHOFER DE AUTOBÚS'],
  cajero: ['7153', 'CAJEROS DE COMERCIOS Y VENDEDORES DE BOLETAS / CAJERO DE ALMACÉN'], analista: ['6540', 'AGENTES DE COMPRAS / ANALISTA DE COMPRAS Y CONTRATACIONES'],
  conserje: ['7075', 'CONSERJES / CONSERJE DE EDIFICIO'],
} as const
const o = (k: keyof typeof OC) => [OC[k][0], OC[k][1]] as [string, string]

const PLANTILLA: Fila[] = [
  ['Ricardo', 'Almánzar Peña', 'M', '2015-03-09', 95000, 'Gerente General', 'Gerencia', ...o('admin'), 'fijo'],
  ['Marisol', 'De los Santos Vega', 'F', '2016-07-04', 78000, 'Contadora', 'Contabilidad', ...o('conta'), 'fijo'],
  ['Julián', 'Tejada Rosario', 'M', '2017-01-16', 52000, 'Analista de Compras', 'Compras', ...o('analista'), 'fijo'],
  ['Yocasta', 'Beltré Ramírez', 'F', '2018-05-21', 41000, 'Asistente Administrativa', 'Administración', ...o('admin'), 'fijo'],
  ['Wilfredo', 'Cuevas Núñez', 'M', '2018-09-10', 36000, 'Supervisor de Almacén', 'Almacén', ...o('super'), 'fijo'],
  ['Altagracia', 'Mercedes Polanco', 'F', '2019-02-18', 33000, 'Recepcionista', 'Administración', ...o('recep'), 'fijo'],
  ['Pedro', 'Guzmán Féliz', 'M', '2019-06-24', 29000, 'Mensajero', 'Logística', ...o('mens'), 'fijo'],
  ['Nelsy', 'Rodríguez Báez', 'F', '2019-11-11', 31000, 'Auxiliar Administrativa', 'Administración', ...o('aux'), 'fijo'],   // renuncia 2024
  ['Fernando', 'Castillo Mejía', 'M', '2020-02-03', 45000, 'Vendedor Senior', 'Ventas', ...o('cajero'), 'fijo'],
  ['Dayanara', 'Lora Santana', 'F', '2020-08-17', 38000, 'Cajera', 'Ventas', ...o('cajero'), 'fijo'],
  ['Moisés', 'Ureña Díaz', 'M', '2021-01-25', 27000, 'Chofer', 'Logística', ...o('chofer'), 'fijo'],
  ['Yissel', 'Pimentel Cruz', 'F', '2021-04-12', 34000, 'Auxiliar Contable', 'Contabilidad', ...o('aux'), 'fijo'],
  ['Cristian', 'Valdez Henríquez', 'M', '2021-09-06', 26000, 'Almacenista', 'Almacén', ...o('super'), 'fijo'],   // despido 2025
  ['Rosanna', 'Ortiz Taveras', 'F', '2022-02-14', 58000, 'Coordinadora de RRHH', 'Recursos Humanos', ...o('admin'), 'fijo'],
  ['Eddy', 'Mateo Santos', 'M', '2022-06-20', 30000, 'Vendedor', 'Ventas', ...o('cajero'), 'fijo'],
  ['Gladys', 'Montero Pérez', 'F', '2022-08-08', 22000, 'Conserje', 'Servicios', ...o('conserje'), 'fijo'],
  ['Kelvin', 'Acosta Reyes', 'M', '2022-08-22', 35000, 'Técnico de Sistemas', 'Tecnología', ...o('aux'), 'fijo'],
  ['Lissette', 'Adames Jiménez', 'F', '2022-11-07', 40000, 'Ejecutiva de Cuentas', 'Ventas', ...o('cajero'), 'fijo'],
  ['Hanoi', 'Sención Medina', 'M', '2026-10-05', 28000, 'Mensajero', 'Logística', ...o('mens'), 'fijo'],
  ['Karina', 'Batista Olivo', 'F', '2026-10-07', 47000, 'Analista Legal', 'Legal', ...o('analista'), 'fijo'],
  ['Jean', 'Baptiste Louis', 'M', '2023-09-25', 24000, 'Auxiliar de Almacén', 'Almacén', ...o('super'), 'estacional'],
  ['Maribel', 'Carrasco Peña', 'F', '2026-10-12', 32000, 'Cajera', 'Ventas', ...o('cajero'), 'fijo'],
  ['Ángel', 'Soto Gómez', 'M', '2024-05-20', 23000, 'Auxiliar de Almacén', 'Almacén', ...o('super'), 'estacional'],
  ['Elena', 'Vásquez Rondón', 'F', '2024-10-14', 21000, 'Auxiliar Administrativa', 'Administración', ...o('aux'), 'ocasional'],
  ['Samuel', 'Paulino Brito', 'M', '2025-03-17', 25000, 'Repartidor', 'Logística', ...o('mens'), 'ocasional'],
]
const SALIDAS: Record<number, { fecha: string; motivo: RegistroLiquidacion['motivo'] }> = {
  7: { fecha: '2024-08-09', motivo: 'renuncia' },
  // Octubre 2026 concentra 3 ingresos (Hanoi, Karina, Maribel) y 3 salidas, para ver los formularios con varias filas
  5: { fecha: '2026-10-13', motivo: 'mutuo_acuerdo' },
  12: { fecha: '2026-10-09', motivo: 'despido_sin_causa' },
  14: { fecha: '2026-10-20', motivo: 'renuncia' },
}
// Aumentos aplicados: (índice, fecha efectiva, %)
const AUMENTOS: [number, string, number][] = [
  [0, '2023-01-01', 8], [1, '2023-01-01', 8], [3, '2023-01-01', 8], [6, '2023-01-01', 8], [9, '2023-01-01', 8],
  [0, '2024-03-01', 6], [2, '2024-03-01', 6], [4, '2024-03-01', 6], [8, '2024-03-01', 6], [10, '2024-03-01', 6], [13, '2024-03-01', 6],
  [1, '2025-07-01', 10], [5, '2025-07-01', 10], [9, '2025-07-01', 10], [11, '2025-07-01', 10], [14, '2025-07-01', 10],
]
const VACACIONES: [number, string, string][] = [
  [0, '2023-07-10', '2023-07-21'], [1, '2024-01-15', '2024-01-26'], [2, '2024-08-05', '2024-08-16'], [4, '2025-02-10', '2025-02-21'],
  [8, '2025-07-14', '2025-07-25'], [13, '2025-12-01', '2025-12-12'], [3, '2026-03-02', '2026-03-13'], [9, '2026-06-08', '2026-06-19'],
]

export interface ResumenCarga { empleados: number; periodos: number; regalias: number; liquidaciones: number }

export function cargarDatosCarga50Meses(uid?: string | null): ResumenCarga {
  const rnd = prng(2022)
  const k = (base: string) => scopedKey(base, uid)

  // ── Empleados ──────────────────────────────────────────────────────────────
  const factorAumento = (i: number) => AUMENTOS.filter(a => a[0] === i).reduce((f, a) => f * (1 + a[2] / 100), 1)
  const empleados: Empleado[] = PLANTILLA.map((f, i) => {
    const [nombre, apellido, sexo, ingreso, sal0, cargo, depto, ocup, ocupDesc, contrato] = f
    const extranjero = i === 20 || i === 23
    const salida = SALIDAS[i]
    return {
      id: `carga-${i + 1}`,
      nombre, apellido,
      cedula: extranjero ? `PA${700000 + i * 137}` : `00${String(100000000 + i * 7919123).slice(0, 9)}`,
      tipoDocumento: extranjero ? 'pasaporte' : 'cedula',
      nacionalidad: i === 20 ? 'HT' : i === 23 ? 'VE' : 'DO',
      nacionalidadMT: i === 20 ? '5' : i === 23 ? '18' : '1',
      fechaNacimiento: iso(1975 + (i * 3) % 25, 1 + (i * 5) % 12, 1 + (i * 7) % 27),
      sexo,
      cargo, departamento: depto,
      fechaIngreso: ingreso,
      salarioBase: Math.round((sal0 * factorAumento(i)) / 50) * 50,
      tipoContrato: contrato,
      activo: !salida,
      email: `${nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${i + 1}@ejemplo.com.do`,
      banco: (['Banco Popular', 'BanReservas', 'BHD León', 'Scotiabank'] as const)[i % 4],
      numeroCuenta: `7${String(10000000 + i * 3331)}`,
      categoriaRiesgo: 'I',
      ocupacionMT: ocup, ocupacionMTDescripcion: ocupDesc,
      turnoId: '1', establecimientoRNL: '1234',
      nivelEducativoMT: ['4748', '4751', '4754', '4755'][i % 4], discapacidadesMT: ['4714'],
      saldosInicialesRevisado: true,
      registradoEn: `${ingreso}T12:00:00.000Z`,
    }
  })

  // ── Aumentos aplicados (histórico real de salario) ─────────────────────────
  const aumentos: RegistroAumento[] = []
  const salarioEn = new Map<number, number>(PLANTILLA.map((f, i) => [i, f[4]]))
  for (const [i, fecha, pct] of [...AUMENTOS].sort((a, b) => a[1].localeCompare(b[1]))) {
    const anterior = salarioEn.get(i)!
    const nuevo = Math.round((anterior * (1 + pct / 100)) / 50) * 50
    salarioEn.set(i, nuevo)
    aumentos.push({
      id: `carga-aum-${aumentos.length + 1}`, empleadoId: empleados[i].id,
      salarioAnterior: anterior, salarioNuevo: nuevo, tipoAjuste: 'porcentaje', valorAjuste: pct,
      motivo: 'Ajuste anual por desempeño', fechaSolicitud: `${fecha}T09:00:00.000Z`, origen: 'manual',
      estado: 'aplicado', fechaAprobacion: `${fecha}T10:00:00.000Z`, aprobadoPor: 'Gerencia',
      fechaAplicacion: `${fecha}T11:00:00.000Z`, fechaEfectiva: fecha,
    })
  }
  // el salario final de cada empleado = el del último aumento (consistente con el histórico)
  empleados.forEach((e, i) => { e.salarioBase = salarioEn.get(i)! })

  const disfrutes: DisfruteVacaciones[] = VACACIONES.map(([i, ini, fin], n) => ({
    id: `carga-vac-${n + 1}`, empleadoId: empleados[i].id, fechaInicio: ini, fechaFin: fin,
    diasLaborables: contarDiasLaborables(parseFechaLocal(ini), parseFechaLocal(fin)),
    tipo: 'disfrute', fechaRegistro: `${ini}T08:00:00.000Z`,
  }))

  // ── 100 quincenas (50 meses) ───────────────────────────────────────────────
  const periodos: PeriodoNomina[] = []
  const emps = (i: number) => {
    const e = { ...empleados[i] }
    const s = SALIDAS[i]
    if (s) { e.salidaPendiente = true; e.fechaSalidaPendiente = s.fecha; e.motivoSalidaPendiente = s.motivo; e.pagoDiasTrabajadosPendiente = 'nomina' }
    return e
  }
  const base = empleados.map((_, i) => emps(i))
  let id = 0
  for (let anio = 2022, mes = 9; anio < 2026 || mes <= 10; mes === 12 ? (anio++, mes = 1) : mes++) {
    const ultimo = new Date(anio, mes, 0).getDate()
    for (const q of [1, 2] as const) {
      const inicio = parseFechaLocal(iso(anio, mes, q === 1 ? 1 : 16))
      const fin = parseFechaLocal(iso(anio, mes, q === 1 ? 15 : ultimo))
      const ajustesPorEmpleado: Record<string, AjusteLinea[]> = {}
      const resultados: Record<string, ResultadoNomina> = {}
      const procesados: string[] = []
      let bruto = 0, descuentos = 0, neto = 0, aportes = 0, isr = 0, costo = 0
      for (let i = 0; i < base.length; i++) {
        const e = base[i]
        if (parseFechaLocal(e.fechaIngreso) >= fin) continue            // aún no ingresa (o ingresa en el corte)
        const s = SALIDAS[i]
        if (s && parseFechaLocal(s.fecha) < inicio) continue            // ya salió
        const ajustes: AjusteLinea[] = []
        const x = rnd()
        if (x < 0.14) ajustes.push({ id: `a${id}-${i}-he`, tipo: 'ingreso', concepto: 'horas_extras_35', descripcion: 'Horas extras', valor: 3 + Math.floor(rnd() * 10) })
        else if (x < 0.19) ajustes.push({ id: `a${id}-${i}-bo`, tipo: 'ingreso', concepto: 'bono', descripcion: 'Bono por desempeño', valor: (1 + Math.floor(rnd() * 5)) * 1000 })
        else if (x < 0.22 && i % 2 === 0) ajustes.push({ id: `a${id}-${i}-co`, tipo: 'ingreso', concepto: 'comision', descripcion: 'Comisión de ventas', valor: (2 + Math.floor(rnd() * 8)) * 1000 })
        const r = calcularParaPeriodo(e, ajustes, { mes, anio, tipo: 'quincenal', quincena: q }, disfrutes, [], aumentos, periodos)
        if (ajustes.length) ajustesPorEmpleado[e.id] = ajustes
        resultados[e.id] = r
        procesados.push(e.id)
        bruto += r.totalBruto; descuentos += r.totalDescuentos; neto += r.salarioNeto
        aportes += r.totalAportesEmpleador; isr += r.isrMensual; costo += r.totalCostoEmpleador
      }
      id++
      const fechaFin = iso(anio, mes, q === 1 ? 15 : ultimo)
      periodos.push({
        id: `carga-q-${anio}-${mes}-${q}`, tipo: 'quincenal', quincena: q, mes, anio, estado: 'cerrada',
        fechaGeneracion: `${fechaFin}T09:00:00.000Z`, totalEmpleados: procesados.length,
        totales: { bruto: r2(bruto), descuentos: r2(descuentos), neto: r2(neto), aportes: r2(aportes), isr: r2(isr), costoTotal: r2(costo) },
        ajustesPorEmpleado, empleadosProcesados: procesados, resultadosPorEmpleado: resultados,
        pagada: true, fechaPago: fechaFin,
      })
    }
  }

  // ── Regalía Pascual de cada diciembre (2022–2025), pagada el 18 ───────────
  let regalias = 0
  for (const anio of [2022, 2023, 2024, 2025]) {
    const montos: Record<string, number> = {}
    const resultados: Record<string, ResultadoNomina> = {}
    for (let i = 0; i < empleados.length; i++) {
      const e = empleados[i]
      const ing = parseFechaLocal(e.fechaIngreso)
      const s = SALIDAS[i]
      if (ing > new Date(anio, 11, 18) || (s && parseFechaLocal(s.fecha) < new Date(anio, 11, 1))) continue
      const desde = ing.getFullYear() === anio ? ing.getMonth() + (ing.getDate() > 15 ? 1 : 0) : 0
      const meses = Math.max(0, Math.min(12, 12 - desde))
      const sal = [...aumentos].filter(a => a.empleadoId === e.id && a.fechaEfectiva! <= iso(anio, 12, 31)).sort((a, b) => a.fechaEfectiva!.localeCompare(b.fechaEfectiva!)).pop()?.salarioNuevo ?? PLANTILLA[i][4]
      const monto = r2((sal / 12) * meses)
      if (monto <= 0) continue
      montos[e.id] = monto
      resultados[e.id] = resultadoRegalia(e.id, monto, Math.max(0, (new Date(anio, 11, 18).getTime() - ing.getTime()) / (365.25 * 24 * 3600 * 1000)))
    }
    const total = Object.values(montos).reduce((s, v) => s + v, 0)
    periodos.push({
      id: `carga-regalia-${anio}`, tipo: 'regalia', mes: 12, anio, estado: 'cerrada',
      fechaGeneracion: `${anio}-12-15T09:00:00.000Z`, totalEmpleados: Object.keys(montos).length,
      totales: { bruto: r2(total), descuentos: 0, neto: r2(total), aportes: 0, isr: 0, costoTotal: r2(total) },
      montosRegalia: montos, empleadosProcesados: Object.keys(montos), resultadosPorEmpleado: resultados,
      pagada: true, fechaPago: iso(anio, 12, 18),
    })
    regalias++
  }
  periodos.sort((a, b) => b.anio - a.anio || b.mes - a.mes || (b.quincena ?? 0) - (a.quincena ?? 0))

  // ── Liquidaciones de las 4 salidas ────────────────────────────────────────
  const liquidaciones: RegistroLiquidacion[] = Object.entries(SALIDAS).map(([idx, s], n) => {
    const e = empleados[Number(idx)]
    const anos = (parseFechaLocal(s.fecha).getTime() - parseFechaLocal(e.fechaIngreso).getTime()) / (365.25 * 24 * 3600 * 1000)
    const sinCausa = s.motivo === 'despido_sin_causa'
    const cesantia = sinCausa ? r2(calcularCesantia(e.salarioBase, anos)) : 0
    const preaviso = sinCausa ? r2(calcularPreaviso(e.salarioBase, anos)) : 0
    const vacaciones = r2((e.salarioBase / 23.83) * 7)
    const regalia = r2((e.salarioBase / 12) * 10)
    return {
      id: `carga-liq-${n + 1}`, empleadoId: e.id, motivo: s.motivo, fechaTerminacion: s.fecha,
      fechaRegistro: `${s.fecha}T16:00:00.000Z`, anosServicio: r2(anos), cesantia, preaviso, asistenciaEconomica: 0,
      vacaciones, regalia, totalPrestamosDescontados: 0, totalPagado: r2(cesantia + preaviso + vacaciones + regalia),
      metodoPago: 'transferencia',
    }
  })

  // ── Empresa: conserva sus datos, pasa a quincenal y deja valores DGT por defecto ──
  let empresa: Empresa
  try { empresa = JSON.parse(storage.getItem(k('cielo-empresa')) ?? '') as Empresa } catch { empresa = {} as Empresa }
  if (!empresa || !empresa.nombre) {
    empresa = {
      nombre: 'Comercial Quisqueya, S.R.L.', rnc: '101-52847-3', direccion: 'Av. 27 de Febrero #350', ciudad: 'Santo Domingo',
      telefono: '809-555-0100', email: 'info@quisqueya.com.do', representanteLegal: 'Ricardo Almánzar Peña',
      categoriaEmpresa: 'pequeña', sectorEmpresa: 'oficinas_comercio', numeroEmpleadosAprox: '20-49', zonaFranca: false,
      rolUsuario: 'dueño', onboardingCompleto: true, configuracionInicialOfrecida: true,
    } as Empresa
  }
  empresa = { ...empresa, modalidadNomina: 'quincenal', onboardingCompleto: true, configuracionInicialOfrecida: true, dgtEstablecimientoRNL: '1234', dgtTurnoId: '1', numeroEmpleadosAprox: '20-49' }

  storage.setItem(k('cielo-empresa'), JSON.stringify(empresa))
  storage.setItem(k('cielo-empleados'), JSON.stringify(empleados))
  storage.setItem(k('cielo-periodos'), JSON.stringify(periodos))
  storage.setItem(k('cielo-aumentos'), JSON.stringify(aumentos))
  storage.setItem(k('cielo-disfrutes-vacaciones'), JSON.stringify(disfrutes))
  storage.setItem(k('cielo-liquidaciones'), JSON.stringify(liquidaciones))
  storage.setItem(k('cielo-prestamos'), JSON.stringify([]))
  storage.setItem(k('cielo-licencias'), JSON.stringify([]))
  return { empleados: empleados.length, periodos: periodos.filter(p => p.tipo === 'quincenal').length, regalias, liquidaciones: liquidaciones.length }
}
