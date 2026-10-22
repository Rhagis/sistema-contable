import assert from 'node:assert/strict'
import test from 'node:test'
import Decimal from 'decimal.js'
import { pool } from '../src/config/db.js'
import { allocateSettlements, createSale, reverseJournal } from '../src/services/operationService.js'

test('reasigna cobros a los nuevos saldos de crédito en orden cronológico', () => {
  const settlements = [
    { id: 2, fecha: '2026-09-10', importe: '40.00' },
    { id: 1, fecha: '2026-09-05', importe: '60.00' },
  ]
  const payments = [
    { formaPagoId: 4, codigo: 'CUENTA_CORRIENTE', cobrado: new Decimal('60.00') },
    { formaPagoId: 5, codigo: 'PAGARE', cobrado: new Decimal('40.00') },
    { formaPagoId: 1, codigo: 'EFECTIVO', cobrado: new Decimal('100.00') },
  ]

  const assignments = allocateSettlements(settlements, payments)

  assert.deepEqual(assignments.map(({ settlement, payment }) => [settlement.id, payment.formaPagoId]), [
    [1, 4],
    [2, 5],
  ])
})

test('rechaza la edición cuando el nuevo saldo a crédito no cubre los cobros existentes', () => {
  assert.throws(
    () => allocateSettlements(
      [{ id: 1, fecha: '2026-09-05', importe: '60.01' }],
      [{ formaPagoId: 4, codigo: 'CUENTA_CORRIENTE', cobrado: new Decimal('60.00') }],
    ),
    (error) => error.status === 400 && error.message.includes('no caben en los nuevos saldos'),
  )
})

test('revierte un asiento conservando la descripción y referencia', async () => {
  const queries = []
  const client = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (sql.includes('SELECT cuenta_id, debe, haber')) {
        return { rows: [{ cuenta_id: 3, debe: '50.00', haber: '0.00' }, { cuenta_id: 4, debe: '0.00', haber: '50.00' }] }
      }
      if (sql.includes('INSERT INTO asientos')) return { rows: [{ id: 22 }] }
      return { rows: [] }
    },
  }

  await reverseJournal(
    client,
    { id: 19, tipo_operacion: 'VENTA', venta_id: 7, cancelacion_id: null },
    2,
    'Reversión por edición de venta 0001-00000007',
    '2026-10-21',
  )

  const journalInsert = queries.find(({ sql }) => sql.includes('INSERT INTO asientos'))
  assert.equal(journalInsert.values[1], 'Reversión por edición de venta 0001-00000007')
  assert.equal(journalInsert.values[3], 7)
  const detailInserts = queries.filter(({ sql }) => sql.includes('INSERT INTO detalle_asientos'))
  assert.deepEqual(detailInserts.map(({ values }) => values.slice(1, 4)), [
    [3, '0.00', '50.00'],
    [4, '50.00', '0.00'],
  ])
})

test('registra una venta de servicios sin descontar stock ni generar CMV', async (context) => {
  const queries = []
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values })
      if (sql.includes('FROM clientes WHERE')) {
        return { rows: [{ id: 5, condicion_iva: 'RESPONSABLE_INSCRIPTO' }] }
      }
      if (sql.includes('FROM productos WHERE')) {
        return { rows: [{ id: 1, nombre: 'Desarrollo web', stock: 0, costo_unitario: '50.00', precio_venta: '100.00' }] }
      }
      if (sql.includes('FROM formas_pago fp')) {
        return { rows: [{ id: 1, codigo: 'EFECTIVO', cuenta_id: 2 }] }
      }
      if (sql.includes('FROM cuentas_activo')) {
        return { rows: [
          { id: 8, codigo: '2.1.04', nombre: 'IVA Debito Fiscal', tipo: 'PASIVO' },
          { id: 9, codigo: '4.1.02', nombre: 'Ventas de servicios', tipo: 'RESULTADO_POSITIVO' },
          { id: 10, codigo: '4.2.01', nombre: 'Recargos financieros', tipo: 'RESULTADO_POSITIVO' },
        ] }
      }
      if (sql.includes('INSERT INTO ventas')) {
        return { rows: [{
          id: 20, cliente_id: 5, fecha: '2026-10-21', tipo_comprobante: 'FACTURA_A',
          numero_comprobante: '0001-00000020', neto: '100.00', iva: '21.00', total: '121.00',
        }] }
      }
      if (sql.includes('INSERT INTO pagos_operacion')) return { rows: [{ id: 25 }] }
      if (sql.includes('INSERT INTO asientos')) return { rows: [{ id: 30 }] }
      return { rows: [] }
    },
    release() {},
  }
  context.mock.method(pool, 'connect', async () => client)

  const sale = await createSale({
    cliente_id: 5,
    fecha: '2026-10-21',
    items: [{ producto_id: 1, cantidad: 1 }],
    pagos: [{ forma_pago_id: 1, importe: 121 }],
  }, 2)

  assert.equal(sale.costo_mercaderias_vendidas, '0.00')
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO movimientos_stock')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('UPDATE productos SET stock')), false)
  assert.deepEqual(
    queries.filter(({ sql }) => sql.includes('INSERT INTO asientos')).map(({ values }) => values[2]),
    ['VENTA'],
  )
})
