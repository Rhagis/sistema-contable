import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/db.js'
import { monthlyBalance } from '../src/controllers/reportController.js'

test('devuelve los movimientos del mes y los saldos acumulados al cierre', async (context) => {
  let query
  context.mock.method(pool, 'query', async (sql, values) => {
    query = { sql, values }
    return { rows: [
      { codigo: '1.1.01', nombre: 'Caja', tipo: 'ACTIVO', debe_acumulado: '300.00', haber_acumulado: '50.00' },
      { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'PASIVO', debe_acumulado: '0', haber_acumulado: '100.00' },
      { codigo: '4.1.01', nombre: 'Gastos', tipo: 'RESULTADO_NEGATIVO', debe_acumulado: '150.00', haber_acumulado: '0' },
    ] }
  })
  let result

  await monthlyBalance(
    { query: { mes: '9', anio: '2026' } },
    { json(value) { result = value } },
    (error) => { throw error },
  )

  assert.deepEqual(query.values, ['2026-09-01', '2026-10-01'])
  assert.match(query.sql, /a\.fecha >= \$1::DATE AND a\.fecha < \$2::DATE/)
  assert.doesNotMatch(query.sql, /FILTER/)
  const zero = { activo: '0.00', pasivo: '0.00', resultado_positivo: '0.00', resultado_negativo: '0.00' }
  assert.equal(result.totales.diferencia_patrimonial.columna, 'pasivo')
  assert.equal(result.totales.diferencia_patrimonial.monto, '150.00')
  assert.deepEqual(result.cuentas, [
    { codigo: '1.1.01', nombre: 'Caja', tipo: 'ACTIVO', debe: '300.00', haber: '50.00', saldo_deudor: '250.00', saldo_acreedor: '0.00', ...zero, activo: '250.00' },
    { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'PASIVO', debe: '0.00', haber: '100.00', saldo_deudor: '0.00', saldo_acreedor: '100.00', ...zero, pasivo: '100.00' },
    { codigo: '4.1.01', nombre: 'Gastos', tipo: 'RESULTADO_NEGATIVO', debe: '150.00', haber: '0.00', saldo_deudor: '150.00', saldo_acreedor: '0.00', ...zero, resultado_negativo: '150.00' },
  ])
})

test('rechaza meses inválidos al consultar el balance', async () => {
  let responseSent = false

  await monthlyBalance(
    { query: { mes: '13', anio: '2026' } },
    { json() { responseSent = true } },
    (error) => assert.equal(error.status, 400),
  )

  assert.equal(responseSent, false)
})
