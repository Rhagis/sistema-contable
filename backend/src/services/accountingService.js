import Decimal from 'decimal.js'
import { httpError } from '../middleware/errors.js'

// Consulta el plan mediante las tablas de clasificación que sincroniza demo_setup.sql.
export async function listAccounts(client) {
  const { rows } = await client.query(
    `SELECT id, codigo, nombre, tipo
     FROM (
       SELECT cuenta_id AS id, codigo, nombre, 'ACTIVO'::VARCHAR(30) AS tipo, activo FROM cuentas_activo
       UNION ALL
       SELECT cuenta_id AS id, codigo, nombre, 'PASIVO'::VARCHAR(30) AS tipo, activo FROM cuentas_pasivo
       UNION ALL
       SELECT cuenta_id AS id, codigo, nombre, 'PATRIMONIO_NETO'::VARCHAR(30) AS tipo, activo FROM cuentas_patrimonio_neto
       UNION ALL
       SELECT cuenta_id AS id, codigo, nombre, tipo, activo FROM cuentas_resultados
     ) cuentas
     WHERE activo = TRUE
     ORDER BY codigo`,
  )
  return rows
}

// Resuelve códigos estables del plan contable a IDs para construir líneas de asiento.
export async function getAccountIds(client) {
  const accounts = await listAccounts(client)
  return Object.fromEntries(accounts.map(({ codigo, id }) => [codigo, id]))
}

// Verifica partida doble antes de escribir cabecera y lineas dentro de la misma transaccion.
export async function createJournal(client, { fecha, descripcion, tipo, reference, userId, lines }) {
  // Omite renglones en cero y evita crear asientos sin movimientos efectivos.
  const validLines = lines.filter((line) => new Decimal(line.debe || 0).gt(0) || new Decimal(line.haber || 0).gt(0))
  if (!validLines.length) {
    throw httpError(400, 'El asiento contable no está balanceado.')
  }

  const totalDebe = validLines.reduce((sum, line) => sum.plus(line.debe || 0), new Decimal(0))
  const totalHaber = validLines.reduce((sum, line) => sum.plus(line.haber || 0), new Decimal(0))
  if (!totalDebe.equals(totalHaber)) {
    throw httpError(400, 'El asiento contable no está balanceado.')
  }

  const { rows } = await client.query(
    `INSERT INTO asientos (fecha, descripcion, tipo_operacion, venta_id, compra_id, liquidacion_iva_id, cancelacion_id, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [fecha, descripcion, tipo, reference.ventaId ?? null, reference.compraId ?? null,
      reference.liquidacionId ?? null, reference.cancelacionId ?? null, userId],
  )
  const journalId = rows[0].id

  for (const line of validLines) {
    await client.query(
      'INSERT INTO detalle_asientos (asiento_id, cuenta_id, debe, haber) VALUES ($1, $2, $3, $4)',
      [journalId, line.cuentaId, new Decimal(line.debe || 0).toFixed(2),
        new Decimal(line.haber || 0).toFixed(2)],
    )
  }

  return journalId
}