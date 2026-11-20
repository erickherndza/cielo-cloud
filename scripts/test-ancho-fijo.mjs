import assert from 'node:assert/strict'
import { padN, padTexto, monto16, montoExento, fechaDDMMAAAA, clave11, periodoMMAAAA, textoLatin1, aBytesLatin1 } from '../src/lib/ancho-fijo.ts'
assert.equal(monto16(55023.78), '0000000055023.78'); assert.equal(monto16(55023.78).length, 16)
assert.equal(monto16(0), '0000000000000.00'); assert.equal(monto16(-5), '0000000000000.00')
assert.equal(monto16(0.1 + 0.2), '0000000000000.30')
assert.equal(montoExento('01', 40000), '010000000040000.00'); assert.equal(montoExento('01', 40000).length, 18)
assert.equal(montoExento('02', 0), '')
assert.equal(fechaDDMMAAAA('2005-12-31'), '31122005'); assert.equal(fechaDDMMAAAA('2026-11-19T10:00:00Z'), '19112026'); assert.equal(fechaDDMMAAAA(''), '')
assert.equal(clave11('131-12345-6'), '  131123456'); assert.equal(clave11('00111356283'), '00111356283')
assert.equal(periodoMMAAAA(7, 2026), '072026')
assert.equal(padTexto('ab', 5), 'ab   '); assert.equal(padTexto('abcdefg', 5), 'abcde'); assert.equal(padN(7, 3), '007')
assert.equal(textoLatin1('Peña  núñez'), 'PEÑA NÚÑEZ')
const b = aBytesLatin1(['PEÑA']); assert.deepEqual([...b], [80, 69, 209, 65, 13, 10])
console.log('ancho-fijo OK')
