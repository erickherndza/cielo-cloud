// Evaluación automática del motor de nómina y las prestaciones.
//
// Los valores esperados se calcularon A MANO con las tasas y artículos citados
// (no copiando la salida del motor), así una regresión del cálculo hace fallar la
// prueba. Cada caso indica su fuente. Los que dicen «POR CONFIRMAR» reflejan el
// criterio actual del sistema, pendiente de validar con el contable/abogado.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularNomina, calcularNominaQuincenal, calcularISRAnual, ajustesToParams,
  calcularCesantia, calcularPreaviso, getDiasPreavisoRequeridos, getDiasVacacionesAnuales,
  calcularDiasVacacionesAcumulados, vacacionesPendientes, contarDiasLaborables,
  calcularAsistenciaEconomica, motivoGenera, prorratearMontoFijo, aplicarSaldoISRFavor,
  TOPE_COTIZABLE_AFP, TOPE_COTIZABLE_SFS, TOPE_COTIZABLE_SRL,
} from '../../src/lib/dominican-labor.ts'

const emp = (salarioBase, extra = {}) => ({
  id: 'e1', salarioBase, fechaIngreso: '2020-01-01', categoriaRiesgo: 'I', ...extra,
})
const cerca = (real, esperado, msg, tol = 0.005) =>
  assert.ok(Math.abs(real - esperado) <= tol, `${msg}: esperado ${esperado}, real ${real}`)
const DIV = 23.83

// ── ISR anual por tramo (DGII, Ley 11-92 art. 296) ───────────────────────────
test('ISR anual: tramos y fronteras', () => {
  assert.equal(calcularISRAnual(0), 0)
  assert.equal(calcularISRAnual(416_220), 0)                       // frontera exenta
  cerca(calcularISRAnual(500_000), (500_000 - 416_220) * 0.15, 'tramo 15%')
  cerca(calcularISRAnual(624_329), (624_329 - 416_220) * 0.15, 'tope tramo 15%')
  cerca(calcularISRAnual(700_000), 31_216 + (700_000 - 624_329) * 0.20, 'tramo 20%')
  cerca(calcularISRAnual(867_123), 31_216 + (867_123 - 624_329) * 0.20, 'tope tramo 20%')
  cerca(calcularISRAnual(1_000_000), 79_776 + (1_000_000 - 867_123) * 0.25, 'tramo 25%')
})

// ── Nómina mensual: casos de oro ──────────────────────────────────────────────
test('CASO ORO RD$40,000 (confirmado por el contable): AFP+SFS 2,364.00, ISR 442.65, neto 37,193.35', () => {
  const r = calcularNomina(emp(40_000))
  cerca(r.afpEmpleado, 1_148.00, 'AFP 2.87%')
  cerca(r.sfsEmpleado, 1_216.00, 'SFS 3.04%')
  cerca(r.isrMensual, 442.65, 'ISR: ((40000-2364)×12 − 416220) × 15% ÷ 12')
  cerca(r.salarioNeto, 37_193.35, 'neto')
  // Aportes del empleador
  cerca(r.afpEmpleador, 2_840.00, 'AFP empleador 7.10%')
  cerca(r.sfsEmpleador, 2_836.00, 'SFS empleador 7.09%')
  cerca(r.srlEmpleador, 440.00, 'SRL categoría I 1.10%')
  cerca(r.infotepEmpleador, 400.00, 'Infotep 1%')
})

test('RD$100,000: ISR en el tramo del 25%', () => {
  const r = calcularNomina(emp(100_000))
  cerca(r.afpEmpleado, 2_870.00, 'AFP')
  cerca(r.sfsEmpleado, 3_040.00, 'SFS')
  // base mensual 94,090 → anual 1,129,080 → 79,776 + (1,129,080 − 867,123) × 25% = 145,265.25 → ÷12
  cerca(r.isrMensual, 145_265.25 / 12, 'ISR mensual')
  cerca(r.salarioNeto, 100_000 - 2_870 - 3_040 - 145_265.25 / 12, 'neto')
})

test('RD$30,000: bajo el mínimo exento, no paga ISR', () => {
  const r = calcularNomina(emp(30_000))
  cerca(r.afpEmpleado, 861.00, 'AFP'); cerca(r.sfsEmpleado, 912.00, 'SFS')
  assert.equal(r.isrMensual, 0)
  cerca(r.salarioNeto, 30_000 - 861 - 912, 'neto')
})

test('topes cotizables TSS: AFP 20×, SFS 10×, SRL 4× el salario mínimo cotizable', () => {
  assert.equal(TOPE_COTIZABLE_AFP, 23_223 * 20)
  assert.equal(TOPE_COTIZABLE_SFS, 23_223 * 10)
  assert.equal(TOPE_COTIZABLE_SRL, 23_223 * 4)
  const r = calcularNomina(emp(600_000))
  cerca(r.afpEmpleado, 464_460 * 0.0287, 'AFP topada')
  cerca(r.sfsEmpleado, 232_230 * 0.0304, 'SFS topada')
  cerca(r.srlEmpleador, 92_892 * 0.011, 'SRL topada')
})

test('categoría de riesgo SRL: I 1.10%, II 1.15%, III 1.20%, IV 1.30%', () => {
  for (const [cat, tasa] of [['I', 0.011], ['II', 0.0115], ['III', 0.012], ['IV', 0.013]]) {
    cerca(calcularNomina(emp(50_000, { categoriaRiesgo: cat })).srlEmpleador, 50_000 * tasa, `SRL ${cat}`)
  }
})

test('horas extras: 35% y 100% sobre la tarifa hora (44 h/semana, Art. 203)', () => {
  const tarifaHora = 44_000 / (44 * 52 / 12)
  const r = calcularNomina(emp(44_000), { horasExtras35: 10, horasExtras100: 4 })
  cerca(r.importeHE35, 10 * tarifaHora * 1.35, 'HE 35%')
  cerca(r.importeHE100, 4 * tarifaHora * 2.0, 'HE 100%')
  cerca(r.totalBruto, 44_000 + 10 * tarifaHora * 1.35 + 4 * tarifaHora * 2.0, 'bruto')
})

test('prorrateo por días: bruto = salario × días ÷ días del período', () => {
  const r = calcularNomina(emp(30_000), { diasTrabajados: 15, diasLaborablesMes: 30 })
  cerca(r.salarioBruto, 15_000, 'bruto prorrateado')
})

test('aporte voluntario AFP y grossing-up no alteran lo retenido a TSS/DGII', () => {
  const base = calcularNomina(emp(55_000))
  const vol = calcularNomina(emp(55_000, { aporteVoluntarioAFPEmpleadoPct: 2, aporteVoluntarioAFPEmpresaPct: 3 }))
  cerca(vol.aporteVoluntarioAFPEmpleado, 1_100, 'voluntario empleado 2%')
  cerca(vol.aporteVoluntarioAFPEmpresa, 1_650, 'voluntario empresa 3%')
  cerca(vol.isrMensual, base.isrMensual, 'el voluntario no reduce la base del ISR')
  const gu = calcularNomina(emp(88_000, { grossingUpPct: 50 }))
  const sin = calcularNomina(emp(88_000))
  cerca(gu.isrMensual, sin.isrMensual, 'grossing-up: misma retención de ISR')
  cerca(gu.afpEmpleado, sin.afpEmpleado, 'grossing-up: misma AFP')
  cerca(gu.grossingUpEmpresa, (sin.afpEmpleado + sin.sfsEmpleado + sin.isrMensual) / 2, 'reembolso = 50%')
})

test('Bono: paga ISR y NO cotiza a TSS; deducción personalizada nunca toca ISR/TSS', () => {
  const sinBono = calcularNomina(emp(55_000))
  const aj = [{ id: 'a', tipo: 'ingreso', concepto: 'bono', descripcion: '', valor: 10_000 }]
  const r = calcularNomina(emp(55_000), ajustesToParams(aj, 'mensual'))
  cerca(r.afpEmpleado, sinBono.afpEmpleado, 'bono sin TSS (AFP igual)')
  cerca(r.sfsEmpleado, sinBono.sfsEmpleado, 'bono sin TSS (SFS igual)')
  assert.ok(r.isrMensual > sinBono.isrMensual, 'el bono sí aumenta el ISR')
  cerca(r.totalBruto, 65_000, 'bruto incluye el bono')
  const ded = calcularNomina(emp(43_000), ajustesToParams([{ id: 'd', tipo: 'deduccion', concepto: 'personalizado', descripcion: '', valor: 2_000 }], 'mensual'))
  const base = calcularNomina(emp(43_000))
  cerca(ded.isrMensual, base.isrMensual, 'deducción: ISR igual')
  cerca(ded.salarioNeto, base.salarioNeto - 2_000, 'deducción: neto baja exacto 2,000')
})

// ── Quincenal ─────────────────────────────────────────────────────────────────
test('quincenal RD$40,000: 1ª sin ISR (anticipo), 2ª con el ISR del mes', () => {
  const q1 = calcularNominaQuincenal(emp(40_000), 1)
  cerca(q1.totalBruto, 20_000, 'q1 bruto'); cerca(q1.afpEmpleado, 574, 'q1 AFP'); cerca(q1.sfsEmpleado, 608, 'q1 SFS')
  assert.equal(q1.isrMensual, 0)
  cerca(q1.salarioNeto, 18_818.00, 'q1 neto')
  const q2 = calcularNominaQuincenal(emp(40_000), 2)
  cerca(q2.isrMensual, 442.65, 'q2 ISR mensual completo')
  cerca(q2.salarioNeto, 20_000 - 574 - 608 - 442.65, 'q2 neto')
})

test('quincenal: ISR de la 2ª sobre lo realmente devengado (ingreso a mitad del mes)', () => {
  const m = calcularNominaQuincenal(emp(90_000), 2, { gravableQuincena1: 0 })
  const completo = calcularNominaQuincenal(emp(90_000), 2)
  assert.ok(m.isrMensual < completo.isrMensual, 'sin 1ª quincena devengada el ISR es menor, no el del mes completo')
})

test('quincenal: 1ª + 2ª reproducen el mes completo (bruto, AFP, SFS, ISR, neto)', () => {
  const m = calcularNomina(emp(75_000)); const q1 = calcularNominaQuincenal(emp(75_000), 1); const q2 = calcularNominaQuincenal(emp(75_000), 2)
  cerca(q1.totalBruto + q2.totalBruto, m.totalBruto, 'bruto')
  cerca(q1.afpEmpleado + q2.afpEmpleado, m.afpEmpleado, 'AFP')
  cerca(q1.sfsEmpleado + q2.sfsEmpleado, m.sfsEmpleado, 'SFS')
  cerca(q1.isrMensual + q2.isrMensual, m.isrMensual, 'ISR')
  cerca(q1.salarioNeto + q2.salarioNeto, m.salarioNeto, 'neto')
})

test('ajustes manuales en quincenal se aplican COMPLETOS (bug RD$1,000 → RD$500)', () => {
  const q = (aj) => calcularNominaQuincenal(emp(40_000), 1, ajustesToParams(aj, 'quincenal'))
  const A = (concepto, valor, extra = {}) => ({ id: 'x', tipo: 'ingreso', concepto, descripcion: '', valor, ...extra })
  cerca(q([A('otro_ingreso', 1_000)]).totalBruto, 21_000, 'otro ingreso 1,000 completo')
  cerca(q([A('comision', 1_000)]).totalBruto, 21_000, 'comisión 1,000 completa')
  cerca(q([A('otro_descuento', 1_000, { tipo: 'deduccion' })]).otrosDescuentos, 1_000, 'otro descuento 1,000 completo')
  cerca(q([A('prestamo', 3_000, { tipo: 'deduccion' })]).otrosDescuentos, 3_000, 'préstamo manual sin registro: 3,000 completo')
})

test('cuota de préstamo registrada: mensual se reparte 50/50; quincenal va íntegra', () => {
  const q = (aj) => calcularNominaQuincenal(emp(40_000), 1, ajustesToParams(aj, 'quincenal'))
  const P = (frecuencia) => ({ id: 'p', tipo: 'deduccion', concepto: 'prestamo', descripcion: '', valor: 1_000, prestamoId: 'pr1', prestamoFrecuencia: frecuencia })
  cerca(q([P('mensual')]).otrosDescuentos, 500, 'cuota mensual → 500 por quincena')
  cerca(q([P('quincenal')]).otrosDescuentos, 1_000, 'cuota quincenal → 1,000 íntegra')
})

test('Dep. SFS adicional: RD$1,919.78 mensual, 959.89 por quincena', () => {
  assert.equal(prorratearMontoFijo(1_919.78, 'mensual'), 1_919.78)
  assert.equal(prorratearMontoFijo(1_919.78, 'quincenal'), 959.89)
})

test('saldo de ISR a favor: descuenta del ISR (nunca de AFP/SFS) y sube el neto', () => {
  const r = calcularNomina(emp(88_000))
  const { resultado: a, montoAplicado } = aplicarSaldoISRFavor(r, 1_000)
  cerca(montoAplicado, 1_000, 'monto aplicado')
  cerca(a.isrMensual, r.isrMensual - 1_000, 'ISR baja 1,000')
  cerca(a.salarioNeto, r.salarioNeto + 1_000, 'neto sube 1,000')
  cerca(a.afpEmpleado, r.afpEmpleado, 'AFP intacta')
  cerca(a.sfsEmpleado, r.sfsEmpleado, 'SFS intacta')
  const { resultado: b, montoAplicado: m2 } = aplicarSaldoISRFavor(r, r.isrMensual + 5_000)
  assert.ok(b.isrMensual >= 0, 'el crédito nunca deja ISR negativo')
  cerca(m2, r.isrMensual, 'solo se consume hasta el ISR del período')
  // Con grossing-up, el reembolso baja en la misma proporción (bug de interacción ya corregido)
  const g = calcularNomina(emp(88_000, { grossingUpPct: 50 }))
  const { resultado: g2 } = aplicarSaldoISRFavor(g, 2_000, 50)
  cerca(g2.grossingUpEmpresa, g.grossingUpEmpresa - 1_000, 'grossing-up baja 50% del crédito')
})

// ── Prestaciones (Código de Trabajo, Ley 16-92) ──────────────────────────────
const dia = 40_000 / DIV
test('Cesantía Art. 80: 3–6 meses = 6 días; 6–12 meses = 13 días; menos de 3 meses = 0', () => {
  assert.equal(calcularCesantia(40_000, 0.2), 0)
  cerca(calcularCesantia(40_000, 0.4), 6 * dia, '6 días')
  cerca(calcularCesantia(40_000, 0.8), 13 * dia, '13 días')
})
test('Cesantía: 1–5 años = 21 días por año completo (RD$40,000, 3 años = 105,749.06)', () => {
  cerca(calcularCesantia(40_000, 3), 63 * dia, '21 × 3 años')
  cerca(calcularCesantia(40_000, 3), 105_749.06, 'cifra confirmada por el contable')
})
test('Cesantía: 5+ años = 23 días por año completo (+ fracción mayor de 3 meses)', () => {
  cerca(calcularCesantia(40_000, 7), 161 * dia, '23 × 7')
  cerca(calcularCesantia(40_000, 7 + 4 / 12), (161 + 6) * dia, '7 años y 4 meses: +6 días (fracción 3–6 meses)')
  cerca(calcularCesantia(40_000, 7 + 8 / 12), (161 + 13) * dia, '7 años y 8 meses: +13 días (fracción 6–12 meses)')
  cerca(calcularCesantia(40_000, 7 + 2 / 12), 161 * dia, '7 años y 2 meses: sin fracción')
})
test('Preaviso Art. 76: 3–6 meses = 7 días, 6–12 = 14, 12+ = 28 fijo (nunca 45)', () => {
  cerca(calcularPreaviso(40_000, 0.3), 7 * dia, '7 días')
  cerca(calcularPreaviso(40_000, 0.8), 14 * dia, '14 días')
  cerca(calcularPreaviso(40_000, 3), 28 * dia, '28 días')
  cerca(calcularPreaviso(40_000, 3), 46_999.58, 'cifra confirmada (RD$40,000, 3 años)')
  cerca(calcularPreaviso(40_000, 20), 28 * dia, '20 años sigue en 28')
  assert.deepEqual([0.1, 0.3, 0.8, 5].map(getDiasPreavisoRequeridos), [0, 7, 14, 28])
})
test('régimen intermitente: la tarifa diaria usa ÷26 en vez de ÷23.83', () => {
  cerca(calcularCesantia(40_000, 3, 26), 63 * 40_000 / 26, 'cesantía ÷26')
})
test('Asistencia económica (Art. 82): 5 / 10 días bajo 1 año; 15 días por año + proporcional mensual', () => {
  cerca(calcularAsistenciaEconomica(40_000, 0.4), 5 * dia, '3–6 meses')
  cerca(calcularAsistenciaEconomica(40_000, 0.8), 10 * dia, '6–12 meses')
  cerca(calcularAsistenciaEconomica(40_000, 3), 45 * dia, '3 años = 15 × 3')
  cerca(calcularAsistenciaEconomica(40_000, 3 + 4 / 12 + 0.001), (45 + 15 / 12 * 4) * dia, '3 años y 4 meses: + 4/12 de 15 días')
})

test('matriz de motivos de terminación (criterio actual — POR CONFIRMAR con el abogado)', () => {
  const m = (x) => ['cesantia', 'preaviso', 'asistencia'].map(p => motivoGenera(x, p))
  assert.deepEqual(m('despido_sin_causa'), [true, true, false])
  assert.deepEqual(m('mutuo_acuerdo'), [true, true, false])
  assert.deepEqual(m('vencimiento_contrato'), [false, false, true])
  assert.deepEqual(m('renuncia'), [false, false, false])
  assert.deepEqual(m('despido_con_causa'), [false, false, false])
})

test('Vacaciones Art. 177: 14 días los años 1 a 4; 18 desde los 5 años cumplidos', () => {
  assert.equal(getDiasVacacionesAnuales(1), 14)
  assert.equal(getDiasVacacionesAnuales(4.99), 14)
  assert.equal(getDiasVacacionesAnuales(5), 18)
  assert.equal(getDiasVacacionesAnuales(12), 18)
})
test('Vacaciones acumuladas compuestas: 7 años = 4×14 + 3×18 = 110; no se descartan años completos', () => {
  assert.equal(calcularDiasVacacionesAcumulados(7), 110)
  cerca(calcularDiasVacacionesAcumulados(1.5), 14 + 14 * 0.5, '1 año y medio')
  assert.equal(calcularDiasVacacionesAcumulados(0, 5), 5)
})
test('Vacaciones pendientes (Arts. 179-180): período del aniversario + escala por la fracción', () => {
  // El caso del contable: 5 años exactos = período de 18 días
  assert.equal(vacacionesPendientes({}, 5).periodoAdquirido, 18)
  assert.equal(vacacionesPendientes({}, 4.99).periodoAdquirido, 14)
  // Escala: ≤5 meses = 0; más de 5 = 6; más de 6 = 7; … más de 11 = 12
  const f = (meses) => vacacionesPendientes({}, 3 + meses / 12).proporcional
  assert.deepEqual([4, 5, 5.5, 6, 6.5, 8.2, 11.5].map(f), [0, 0, 6, 6, 7, 9, 12])
  assert.equal(vacacionesPendientes({ saldoVacacionesInicial: 4 }, 3).total, 14 + 4)
  assert.equal(vacacionesPendientes({}, 0.5).periodoAdquirido, 0)
})

test('días laborables entre fechas excluyen los domingos', () => {
  assert.equal(contarDiasLaborables(new Date(2026, 6, 1), new Date(2026, 6, 31)), 27)  // julio 2026: 4 domingos
  assert.equal(contarDiasLaborables(new Date(2026, 7, 1), new Date(2026, 7, 31)), 26)  // agosto 2026: 5 domingos
  assert.equal(contarDiasLaborables(new Date(2026, 10, 15), new Date(2026, 10, 15)), 0) // 15-nov-2026 es domingo
})

// ── Invariantes con miles de entradas (generador determinista) ───────────────
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

test('invariantes de la nómina mensual con 5,000 casos aleatorios', () => {
  const r = rng(20261125)
  for (let i = 0; i < 5_000; i++) {
    const salario = Math.round(15_000 + r() * 600_000)
    const e = emp(salario, { categoriaRiesgo: ['I', 'II', 'III', 'IV'][Math.floor(r() * 4)], grossingUpPct: r() < 0.2 ? 50 : 0 })
    const p = { horasExtras35: Math.floor(r() * 30), bonificaciones: r() < 0.3 ? Math.round(r() * 20_000) : 0,
      comisiones: r() < 0.3 ? Math.round(r() * 20_000) : 0, otrosDescuentos: r() < 0.3 ? Math.round(r() * 3_000) : 0,
      diasTrabajados: r() < 0.3 ? Math.round(1 + r() * 22) : 23.83 }
    const n = calcularNomina(e, p)
    const ctx = `salario ${salario}`
    // Identidades contables
    cerca(n.totalBruto, n.salarioBruto + n.totalHorasExtras + n.importeNocturno + n.bonificaciones + n.comisiones + n.ingresosPersonalizados + n.vacacionesGoce + n.vacacionesVendidas + n.diasIngresoPendientes, `${ctx}: bruto = suma de ingresos`, 0.01)
    cerca(n.salarioNeto, n.totalBruto - n.totalDescuentos + n.grossingUpEmpresa, `${ctx}: neto = bruto − descuentos (+ grossing-up)`, 0.01)
    cerca(n.totalDescuentos, n.afpEmpleado + n.sfsEmpleado + n.isrMensual + n.sfsDependientes + n.otrosDescuentos + n.aporteVoluntarioAFPEmpleado, `${ctx}: descuentos = suma`, 0.01)
    cerca(n.totalCostoEmpleador, n.totalBruto + n.totalAportesEmpleador, `${ctx}: costo = bruto + aportes`, 0.01)
    // Cotas
    assert.ok(n.afpEmpleado <= TOPE_COTIZABLE_AFP * 0.0287 + 0.001, `${ctx}: AFP bajo su tope`)
    assert.ok(n.sfsEmpleado <= TOPE_COTIZABLE_SFS * 0.0304 + 0.001, `${ctx}: SFS bajo su tope`)
    assert.ok(n.isrMensual >= 0 && n.afpEmpleado >= 0 && n.sfsEmpleado >= 0, `${ctx}: sin retenciones negativas`)
    assert.ok(Number.isFinite(n.salarioNeto) && Number.isFinite(n.totalCostoEmpleador), `${ctx}: sin NaN`)
    // Sin descuentos discrecionales, el neto nunca es negativo ni supera al bruto
    if (p.otrosDescuentos === 0 && !e.grossingUpPct) assert.ok(n.salarioNeto > 0 && n.salarioNeto <= n.totalBruto, `${ctx}: 0 < neto ≤ bruto`)
    // Quincenal reproduce el mes
    const q1 = calcularNominaQuincenal(e, 1, p); const q2 = calcularNominaQuincenal(e, 2, p)
    cerca(q1.totalBruto + q2.totalBruto, n.totalBruto, `${ctx}: q1+q2 bruto`, 0.01)
    cerca(q1.isrMensual + q2.isrMensual, n.isrMensual, `${ctx}: q1+q2 ISR`, 0.01)
    cerca(q1.salarioNeto + q2.salarioNeto, n.salarioNeto, `${ctx}: q1+q2 neto`, 0.02)
  }
})

test('el ISR y el neto nunca bajan al subir el salario (monotonía)', () => {
  let isrPrev = -1, netoPrev = -1
  for (let s = 10_000; s <= 700_000; s += 500) {
    const n = calcularNomina(emp(s))
    assert.ok(n.isrMensual >= isrPrev - 0.001, `ISR bajó en ${s}`)
    assert.ok(n.salarioNeto >= netoPrev - 0.001, `neto bajó en ${s}`)
    isrPrev = n.isrMensual; netoPrev = n.salarioNeto
  }
})

test('cesantía y vacaciones nunca bajan con más antigüedad; preaviso tiene tope', () => {
  let c = -1, v = -1
  for (let a = 0; a <= 40; a += 0.05) {
    const cc = calcularCesantia(40_000, a), vv = calcularDiasVacacionesAcumulados(a)
    assert.ok(cc >= c - 1e-6, `cesantía bajó en ${a.toFixed(2)} años`)
    assert.ok(vv >= v - 1e-6, `vacaciones bajaron en ${a.toFixed(2)} años`)
    assert.ok(calcularPreaviso(40_000, a) <= 28 * dia + 1e-6, `preaviso supera 28 días en ${a.toFixed(2)}`)
    c = cc; v = vv
  }
})
