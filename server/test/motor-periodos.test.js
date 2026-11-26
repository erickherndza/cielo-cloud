// Evaluación de los prorrateos de nómina (calcularParaPeriodo): ingreso, salida, suspensión,
// licencia, vacaciones, reajuste salarial y días pendientes.
//
// Regla vigente: se prorratea por DÍAS LABORABLES (sin domingos). Julio 2026 tiene 4 domingos
// (5, 12, 19 y 26): la 1ª quincena (1–15) = 13 laborables, la 2ª (16–31) = 14, el mes = 27.
// Los valores esperados están calculados a mano; ninguno sale de la salida del motor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularParaPeriodo, diasIngresoPendientes } from '../../src/lib/nomina-shared.ts'

const emp = (extra = {}) => ({ id: 'e1', salarioBase: 40_000, fechaIngreso: '2020-01-01', categoriaRiesgo: 'I', ...extra })
const cerca = (real, esperado, msg, tol = 0.006) =>
  assert.ok(Math.abs(real - esperado) <= tol, `${msg}: esperado ${esperado}, real ${real}`)
const TARIFA = 40_000 / 23.83                       // tarifa diaria legal (÷23.83)
const JUL = { mes: 7, anio: 2026, tipo: 'mensual' }
const JUL_Q1 = { mes: 7, anio: 2026, tipo: 'quincenal', quincena: 1 }
const JUL_Q2 = { mes: 7, anio: 2026, tipo: 'quincenal', quincena: 2 }
const calc = (e, p, d = [], l = [], a = [], ps = []) => calcularParaPeriodo(e, [], p, d, l, a, ps)

test('sin ninguna novedad: el período completo, mensual y quincenal', () => {
  cerca(calc(emp(), JUL).salarioBruto, 40_000, 'mensual')
  cerca(calc(emp(), JUL_Q1).salarioBruto, 20_000, 'quincena 1')
  cerca(calc(emp(), JUL_Q2).salarioBruto, 20_000, 'quincena 2')
})

test('ingreso a mitad de período: días laborables trabajados ÷ días laborables del período', () => {
  cerca(calc(emp({ fechaIngreso: '2026-07-16' }), JUL).salarioBruto, 40_000 * 14 / 27, 'mensual: ingresó el 16 → 14 de 27')
  cerca(calc(emp({ fechaIngreso: '2026-07-02' }), JUL_Q1).salarioBruto, 40_000 * (12 / 13) / 2, 'quincena 1: ingresó el 2 → 12 de 13')
  cerca(calc(emp({ fechaIngreso: '2026-07-14' }), JUL_Q1).salarioBruto, 40_000 * (2 / 13) / 2, 'quincena 1: ingresó el 14 → 2 de 13')
})

test('ingreso en el corte (último día del período): no cobra ese período, se arrastra al siguiente a tarifa legal', () => {
  // Ingresó el miércoles 15: la 2ª quincena paga la completa + ese día a ÷23.83
  const q2 = calc(emp({ fechaIngreso: '2026-07-15' }), JUL_Q2)
  cerca(q2.salarioBruto, 20_000, 'sueldo normal de la quincena 2')
  cerca(q2.diasIngresoPendientes, TARIFA, '1 día pendiente a RD$40,000 ÷ 23.83')
  cerca(q2.totalBruto, 20_000 + TARIFA, 'bruto = quincena + día pendiente')
  assert.ok(q2.salarioNeto > 0, 'el neto nunca es negativo (el problema original del prorrateo con ÷23.83)')
  // Mensual: ingresó el viernes 31-jul → agosto paga completo + 1 día
  const ago = calc(emp({ fechaIngreso: '2026-07-31' }), { mes: 8, anio: 2026, tipo: 'mensual' })
  cerca(ago.totalBruto, 40_000 + TARIFA, 'agosto')
})

test('días pendientes: se acota al período inmediato anterior (un empleado con historial no genera huecos de años)', () => {
  assert.equal(diasIngresoPendientes(emp({ fechaIngreso: '2020-01-01' }), [], 7, 2026, 'quincenal', 2), null)
  assert.equal(diasIngresoPendientes(emp({ fechaIngreso: '2026-07-16' }), [], 7, 2026, 'quincenal', 2), null) // ingresa dentro del período, no antes
  const r = diasIngresoPendientes(emp({ fechaIngreso: '2026-07-13' }), [], 7, 2026, 'quincenal', 2)          // lun 13, mar 14, mié 15
  assert.equal(r.diasLaborables, 3)
})

test('suspensión desde una fecha: paga solo los días laborables previos', () => {
  cerca(calc(emp({ suspendido: true, fechaSuspension: '2026-07-10' }), JUL).salarioBruto, 40_000 * 9 / 27, '1–10 jul = 9 laborables de 27')
})

test('salida pendiente pagada por nómina: paga hasta la fecha de salida', () => {
  const e = emp({ salidaPendiente: true, pagoDiasTrabajadosPendiente: 'nomina', fechaSalidaPendiente: '2026-07-20' })
  cerca(calc(e, JUL).salarioBruto, 40_000 * 17 / 27, '1–20 jul = 17 laborables de 27')
  // si la salida se paga con la liquidación, la nómina NO prorratea
  cerca(calc({ ...e, pagoDiasTrabajadosPendiente: 'liquidacion' }, JUL).salarioBruto, 40_000, 'con liquidación no prorratea')
})

test('licencia de enfermedad/accidente SIN disfrute de sueldo reduce los días; con disfrute o de otro tipo, no', () => {
  const lic = (extra) => [{ empleadoId: 'e1', tipo: 'enfermedad_comun', fechaInicio: '2026-07-20', fechaFin: '2026-07-25', ...extra }]
  cerca(calc(emp(), JUL, [], lic({})).salarioBruto, 40_000 * 21 / 27, 'sin disfrute: 6 laborables menos')
  cerca(calc(emp(), JUL, [], lic({ disfruteSueldo: true })).salarioBruto, 40_000, 'con disfrute: completo')
  cerca(calc(emp(), JUL, [], lic({ tipo: 'maternidad' })).salarioBruto, 40_000, 'maternidad: completo (la empresa paga 100%)')
  cerca(calc(emp(), JUL, [], lic({ tipo: 'matrimonial' })).salarioBruto, 40_000, 'matrimonial: completo')
  cerca(calc(emp(), JUL, [], lic({ tipo: 'accidente_laboral' })).salarioBruto, 40_000 * 21 / 27, 'accidente laboral sin disfrute')
})

test('vacaciones disfrutadas: reducen los días y se pagan aparte a tarifa legal (con AFP/SFS/ISR)', () => {
  // 20–26 jul = lun a dom → 6 laborables
  const d = [{ id: 'v', empleadoId: 'e1', fechaInicio: '2026-07-20', fechaFin: '2026-07-26', diasLaborables: 6, tipo: 'disfrute' }]
  const r = calc(emp(), JUL, d)
  cerca(r.salarioBruto, 40_000 * 21 / 27, 'sueldo de los 21 días trabajados')
  cerca(r.vacacionesGoce, 6 * TARIFA, 'goce = 6 días × tarifa')
  cerca(r.totalBruto, 40_000 * 21 / 27 + 6 * TARIFA, 'bruto total')
  assert.ok(r.afpEmpleado > 0 && r.isrMensual >= 0, 'el goce cotiza como salario ordinario')
})

test('venta de vacaciones: NO reduce los días trabajados; se paga además del sueldo completo', () => {
  const d = [{ id: 'v', empleadoId: 'e1', fechaInicio: '2026-07-15', fechaFin: '2026-07-15', diasLaborables: 5, tipo: 'venta' }]
  const r = calc(emp(), JUL, d)
  cerca(r.salarioBruto, 40_000, 'sueldo completo')
  cerca(r.vacacionesVendidas, 5 * TARIFA, '5 días vendidos')
  cerca(r.totalBruto, 40_000 + 5 * TARIFA, 'bruto total')
})

test('quincenal: el goce de vacaciones de la quincena se paga completo (no a la mitad)', () => {
  // 20–25 jul (Q2): 6 laborables
  const d = [{ id: 'v', empleadoId: 'e1', fechaInicio: '2026-07-20', fechaFin: '2026-07-25', diasLaborables: 6, tipo: 'disfrute' }]
  const r = calc(emp(), JUL_Q2, d)
  cerca(r.vacacionesGoce, 6 * TARIFA, 'goce de la quincena íntegro')
  cerca(r.salarioBruto, 40_000 * (8 / 14) / 2, 'sueldo: 8 de 14 días laborables de la quincena')
})

test('reajuste salarial a mitad de período: salario ponderado por días laborables', () => {
  const aum = [{ empleadoId: 'e1', estado: 'aplicado', fechaEfectiva: '2026-07-16', salarioAnterior: 50_000, salarioNuevo: 55_000 }]
  cerca(calc(emp({ salarioBase: 55_000 }), JUL, [], [], aum).salarioBruto, (13 * 50_000 + 14 * 55_000) / 27, 'mensual: 13 días al anterior + 14 al nuevo')
  const aum2 = [{ empleadoId: 'e1', estado: 'aplicado', fechaEfectiva: '2026-07-24', salarioAnterior: 44_000, salarioNuevo: 50_000 }]
  cerca(calc(emp({ salarioBase: 50_000 }), JUL_Q2, [], [], aum2).salarioBruto, ((7 * 44_000 + 7 * 50_000) / 14) / 2, 'quincena 2: 7 y 7 días')
})

test('reajuste salarial: períodos posteriores usan el salario nuevo; anteriores, el anterior; pendientes/rechazados no cuentan', () => {
  const aum = [{ empleadoId: 'e1', estado: 'aplicado', fechaEfectiva: '2026-07-16', salarioAnterior: 50_000, salarioNuevo: 55_000 }]
  cerca(calc(emp({ salarioBase: 55_000 }), { mes: 8, anio: 2026, tipo: 'mensual' }, [], [], aum).salarioBruto, 55_000, 'agosto: salario nuevo')
  cerca(calc(emp({ salarioBase: 55_000 }), { mes: 6, anio: 2026, tipo: 'mensual' }, [], [], aum).salarioBruto, 50_000, 'junio: salario anterior')
  const noAplicado = [{ ...aum[0], estado: 'aprobado' }]
  cerca(calc(emp({ salarioBase: 50_000 }), JUL, [], [], noAplicado).salarioBruto, 50_000, 'aprobado pero sin aplicar: no cambia nada')
})

test('quincenal: el ISR de la 2ª se calcula sobre lo devengado en el mes (ingreso a mitad de mes)', () => {
  // Ingresó el 15: no devengó nada en la 1ª quincena → su ISR de la 2ª es el de ~1 quincena, no el del mes completo
  const e = emp({ salarioBase: 90_000, fechaIngreso: '2026-07-15' })
  const q1 = { id: 'q1', tipo: 'quincenal', quincena: 1, mes: 7, anio: 2026, estado: 'cerrada', empleadosProcesados: [], resultadosPorEmpleado: {} }
  const conSinQ1 = calc(e, JUL_Q2, [], [], [], [q1])
  const completo = calc(emp({ salarioBase: 90_000 }), JUL_Q2)
  assert.ok(conSinQ1.isrMensual < completo.isrMensual, 'menos ISR: no se le retiene como si hubiera ganado el mes completo')
})

test('invariantes de los prorrateos con 2,000 combinaciones aleatorias', () => {
  let a = 987654321 >>> 0
  const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const per = [JUL, JUL_Q1, JUL_Q2, { mes: 2, anio: 2026, tipo: 'mensual' }, { mes: 12, anio: 2025, tipo: 'quincenal', quincena: 2 }]
  for (let i = 0; i < 2_000; i++) {
    const p = per[Math.floor(r() * per.length)]
    const dia = 1 + Math.floor(r() * 28)
    const ing = `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    const e = emp({ salarioBase: Math.round(15_000 + r() * 200_000), fechaIngreso: r() < 0.5 ? ing : '2020-01-01',
      ...(r() < 0.2 ? { suspendido: true, fechaSuspension: ing } : {}) })
    const x = calc(e, p)
    const ctx = `${JSON.stringify(p)} ingreso ${e.fechaIngreso} salario ${e.salarioBase}`
    assert.ok(Number.isFinite(x.salarioNeto) && Number.isFinite(x.totalBruto), `${ctx}: sin NaN`)
    assert.ok(x.salarioBruto >= -1e-9, `${ctx}: bruto no negativo`)
    const mitad = p.tipo === 'quincenal' ? e.salarioBase / 2 : e.salarioBase
    assert.ok(x.salarioBruto <= mitad + 0.01, `${ctx}: el sueldo del período nunca supera el sueldo completo del período (${x.salarioBruto} > ${mitad})`)
    assert.ok(x.salarioNeto >= -0.01, `${ctx}: el neto nunca es negativo (${x.salarioNeto})`)
  }
})
