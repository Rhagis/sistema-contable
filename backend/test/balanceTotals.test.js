import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeBalance } from '../src/services/balanceTotals.js'

const row = (values) => ({
  debe: '0', haber: '0', saldo_deudor: '0', saldo_acreedor: '0',
  activo: '0', pasivo: '0', resultado_positivo: '0', resultado_negativo: '0',
  ...values,
})

test('coloca cada diferencia bajo la columna de menor valor', () => {
  const summary = summarizeBalance([
    row({ activo: '100.00', pasivo: '70.00', resultado_positivo: '10.00', resultado_negativo: '40.00' }),
  ])

  assert.deepEqual(summary.diferencia_patrimonial, { columna: 'pasivo', monto: '30.00' })
  assert.deepEqual(summary.diferencia_resultados, { columna: 'resultado_positivo', monto: '30.00' })
})

test('ubica la diferencia bajo el activo cuando es el menor', () => {
  const summary = summarizeBalance([row({ activo: '50.00', pasivo: '80.00' })])

  assert.deepEqual(summary.diferencia_patrimonial, { columna: 'activo', monto: '30.00' })
  assert.equal(summary.diferencia_resultados.columna, null)
})
