import { pool } from '../config/db.js'
import { httpError } from '../middleware/errors.js'
import { createPurchase, createSale } from '../services/operationService.js'

// El controlador mantiene el contrato HTTP y delega reglas y persistencia al servicio transaccional.
export async function addSale(request, response, next) {
  try {
    response.status(201).json(await createSale(request.body, request.user.id))
  } catch (error) {
    next(error)
  }
}

export async function addPurchase(request, response, next) {
  try {
    response.status(201).json(await createPurchase(request.body, request.user.id))
  } catch (error) {
    next(error)
  }
}

export async function listOperations(request, response, next) {
  try {
    // El tipo determina las tablas relacionadas; el id opcional cambia lista por detalle.
    const isSale = request.params.type === 'ventas'
    const table = isSale ? 'ventas' : 'compras'
    const party = isSale ? 'clientes' : 'proveedores'
    const partyId = isSale ? 'cliente_id' : 'proveedor_id'
    const partyName = isSale ? 'razon_social' : 'razon_social'
    const operationId = request.params.id ? Number(request.params.id) : null
    if (operationId !== null && (!Number.isSafeInteger(operationId) || operationId < 1)) {
      throw httpError(400, 'El identificador de operación no es válido.')
    }
    const { rows } = await pool.query(
      `SELECT o.*, p.${partyName} AS contraparte,
          COALESCE(json_agg(json_build_object(
            'producto_id', d.producto_id, 'producto', pr.nombre, 'cantidad', d.cantidad,
            'precio_unitario', d.precio_unitario, 'neto', d.neto, 'iva', d.iva, 'total', d.total
          )) FILTER (WHERE d.id IS NOT NULL), '[]') AS detalle,
          COALESCE((SELECT json_agg(json_build_object(
            'forma_pago', fp.nombre, 'importe', po.importe
          )) FROM pagos_operacion po JOIN formas_pago fp ON fp.id = po.forma_pago_id
          WHERE po.${isSale ? 'venta_id' : 'compra_id'} = o.id), '[]') AS pagos
       FROM ${table} o JOIN ${party} p ON p.id = o.${partyId}
       LEFT JOIN ${isSale ? 'detalle_ventas' : 'detalle_compras'} d ON d.${isSale ? 'venta_id' : 'compra_id'} = o.id
       LEFT JOIN productos pr ON pr.id = d.producto_id
       WHERE ($1::BIGINT IS NULL OR o.id = $1)
       GROUP BY o.id, p.${partyName}
       ORDER BY o.fecha DESC, o.id DESC LIMIT 200`, [operationId],
    )
    if (operationId !== null && !rows[0]) throw httpError(404, 'Operación no encontrada.')
    response.json(operationId === null ? rows : rows[0])
  } catch (error) {
    next(error)
  }
}