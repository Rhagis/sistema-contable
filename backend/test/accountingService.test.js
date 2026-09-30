import assert from 'node:assert/strict'
import test from 'node:test'
import Decimal from 'decimal.js'
import { createJournal } from '../src/services/accountingService.js'

function fakeClient() {
  // Registra SQL sin conectarse a PostgreSQL y simula el id devuelto al insertar un asiento.
  const queries = []
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values })
      if (sql.includes('INSERT INTO asientos')) return { rows: [{ id: 42 }] }
      return { rows: [] }
    },
  }
}

// Verifica que se persisten lineas efectivas y se conservan los importes con centavos.
test('guarda un asiento balanceado y omite líneas de importe cero', async () => {
  const client = fakeClient()
  const id = await createJournal(client, {
    fecha: '2026-09-05', descripcion: 'Venta', tipo: 'VENTA', reference: { ventaId: 7 }, userId: 1,
    lines: [
      { cuentaId: 1, debe: new Decimal('100.25') },
      { cuentaId: 2, haber: new Decimal('100.25') },
      { cuentaId: 3, debe: new Decimal('0') },
    ],
  })

  assert.equal(id, 42)
  assert.equal(client.queries.filter(({ sql }) => sql.includes('INSERT INTO detalle_asientos')).length, 2)
  assert.equal(client.queries[1].values[2], '100.25')
  assert.equal(client.queries[2].values[3], '100.25')
})

// Un asiento descuadrado debe fallar antes de ejecutar cualquier INSERT.
test('rechaza un asiento descuadrado antes de insertar', async () => {
  const client = fakeClient()
  await assert.rejects(
    createJournal(client, {
      fecha: '2026-09-05', descripcion: 'Descuadrado', tipo: 'VENTA', reference: { ventaId: 7 }, userId: 1,
      lines: [{ cuentaId: 1, debe: new Decimal('100') }, { cuentaId: 2, haber: new Decimal('99.99') }],
    }),
    (error) => error.status === 400 && error.message === 'El asiento contable no está balanceado.',
  )
  assert.equal(client.queries.length, 0)
})

// Evita crear cabeceras contables sin movimientos efectivos.
test('rechaza asientos vacíos aunque tengan renglones en cero', async () => {
  const client = fakeClient()
  await assert.rejects(
    createJournal(client, {
      fecha: '2026-09-05', descripcion: 'Vacío', tipo: 'VENTA', reference: { ventaId: 7 }, userId: 1,
      lines: [{ cuentaId: 1, debe: new Decimal('0'), haber: new Decimal('0') }],
    }),
    (error) => error.status === 400,
  )
  assert.equal(client.queries.length, 0)
})