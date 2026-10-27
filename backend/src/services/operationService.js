import Decimal from 'decimal.js'
import { httpError } from '../middleware/errors.js'
import { createJournal, getAccountIds } from './accountingService.js'
import { withTransaction } from './transactionService.js'

const IVA_RATE = new Decimal('0.21')
const PURCHASE_LINE_ACCOUNT_CODES = new Set([
  '1.2.01', '1.2.02', '1.2.03', '1.2.04', '1.2.05', '1.2.06', '1.2.07',
  '5.2.01', '5.2.03', '5.2.04', '5.2.05', '5.2.06', '5.2.07',
  '5.2.08', '5.2.09', '5.2.10', '5.2.11', '5.2.12',
])
const CREDIT_PAYMENT_CODES = new Set(['CUENTA_CORRIENTE', 'PAGARE', 'CHEQUE_DIFERIDO'])

// Convierte importes a Decimal y centavos para evitar errores de redondeo de Number.
function money(value, label) {
  try {
    const amount = new Decimal(String(value))
    if (!amount.isFinite() || amount.isNegative()) throw new Error()
    return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  } catch {
    throw httpError(400, `${label} debe ser un importe válido mayor o igual a cero.`)
  }
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'La operación debe incluir al menos un producto.')
  }
  const productIds = new Set()
  for (const item of items) {
    const id = Number(item.producto_id)
    const quantity = Number(item.cantidad)
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, 'Cada producto debe tener un identificador y una cantidad entera mayor a cero.')
    }
    if (productIds.has(id)) throw httpError(400, 'No repita productos; consolide las cantidades en un solo renglón.')
    productIds.add(id)
  }
  // El orden estable reduce conflictos si dos operaciones bloquean varios productos.
  return [...items].sort((left, right) => Number(left.producto_id) - Number(right.producto_id))
}

// Bloquea filas hasta confirmar la transaccion para impedir que ventas concurrentes usen el mismo stock.
async function lockProducts(client, items) {
  const products = new Map()
  for (const item of items) {
    const { rows } = await client.query(
      'SELECT id, nombre, stock, costo_unitario, precio_venta FROM productos WHERE id = $1 AND activo = TRUE FOR UPDATE',
      [item.producto_id],
    )
    if (!rows[0]) throw httpError(404, `No existe el producto ${item.producto_id}.`)
    products.set(Number(item.producto_id), rows[0])
  }
  return products
}

// Calcula neto, IVA y costo de cada renglon con precios decimales exactos.
function calculateLines(items, products, isSale, taxRate = IVA_RATE) {
  return items.map((item) => {
    const product = products.get(Number(item.producto_id))
    const unitPrice = item.precio_unitario === undefined
      ? new Decimal(isSale ? product.precio_venta : product.costo_unitario)
      : money(item.precio_unitario, 'El precio unitario')
    const net = unitPrice.mul(item.cantidad).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    const tax = net.mul(taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    return {
      productoId: Number(item.producto_id),
      cantidad: Number(item.cantidad),
      precioUnitario: unitPrice,
      costoUnitario: new Decimal(product.costo_unitario),
      neto: net,
      iva: tax,
      total: net.plus(tax),
    }
  })
}

function sum(lines, property) {
  return lines.reduce((total, line) => total.plus(line[property]), new Decimal(0))
}

async function validatePayments(client, payments, total, operation) {
  if (!Array.isArray(payments) || payments.length === 0) {
    throw httpError(400, 'Debe indicar al menos una forma de pago.')
  }
  const normalized = payments.map((payment) => {
    const pct = new Decimal(payment.recargo_porcentaje || 0)
    if (!pct.isFinite() || pct.isNegative() || pct.gt(1000)) throw httpError(400, 'El recargo debe ser un porcentaje entre 0 y 1000.')
    return {
      formaPagoId: Number(payment.forma_pago_id),
      importe: money(payment.importe, 'El importe del pago'),
      recargoPorcentaje: pct,
    }
  })
  if (normalized.some((payment) => !Number.isInteger(payment.formaPagoId) || payment.formaPagoId <= 0
    || payment.importe.isZero())) {
    throw httpError(400, 'Cada pago debe incluir una forma válida y un importe mayor a cero.')
  }
  if (!sum(normalized, 'importe').equals(total)) {
    throw httpError(400, 'La suma de las formas de pago debe coincidir con el total de la operación.')
  }

  // La cuenta asociada depende de si se cobra una venta o se paga una compra.
  for (const payment of normalized) {
    const { rows } = await client.query(
      `SELECT fp.id, fp.codigo, fp.cuenta_${operation}_id AS cuenta_id
       FROM formas_pago fp WHERE fp.id = $1 AND fp.activo = TRUE`,
      [payment.formaPagoId],
    )
    if (!rows[0]?.cuenta_id) throw httpError(400, 'La forma de pago no es válida para esta operación.')
    payment.cuentaId = rows[0].cuenta_id
    payment.codigo = rows[0].codigo
    // El recargo se suma al importe efectivamente cobrado/pagado; la factura conserva su total.
    payment.recargo = payment.importe.mul(payment.recargoPorcentaje).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    payment.cobrado = payment.importe.plus(payment.recargo)
  }
  return normalized
}

async function savePayments(client, payments, saleId, purchaseId) {
  const savedPayments = []
  for (const payment of payments) {
    const { rows } = await client.query(
      `INSERT INTO pagos_operacion (venta_id, compra_id, forma_pago_id, importe, recargo_porcentaje, recargo_importe)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [saleId ?? null, purchaseId ?? null, payment.formaPagoId, payment.importe.toFixed(2),
        payment.recargoPorcentaje.toFixed(2), payment.recargo.toFixed(2)],
    )
    savedPayments.push({ ...payment, id: rows[0].id })
  }
  return savedPayments
}

async function writeStockMovement(client, { product, item, date, type, referenceId, unitCost }) {
  const previousStock = Number(product.stock)
  const nextStock = type === 'VENTA' ? previousStock - item.cantidad : previousStock + item.cantidad
  if (nextStock < 0) throw httpError(400, 'No existe stock suficiente para realizar la venta.')
  await client.query(
    'UPDATE productos SET stock = $1, costo_unitario = COALESCE($2, costo_unitario), updated_at = NOW() WHERE id = $3',
    [nextStock, unitCost?.toFixed(2) ?? null, product.id],
  )
  await client.query(
    `INSERT INTO movimientos_stock
       (producto_id, fecha, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, venta_id, compra_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [product.id, date, type, item.cantidad, previousStock, nextStock,
      type === 'VENTA' ? referenceId : null, type === 'COMPRA' ? referenceId : null],
  )
}

// Venta de servicios: calcula comprobante e IVA y registra pagos, sin inventario ni CMV.
export async function createSale(input, userId) {
  const items = validateItems(input.items)
  if (!input.cliente_id || !input.fecha) throw httpError(400, 'Cliente y fecha son obligatorios.')

  return withTransaction(async (client) => {
    const { rows: clientRows } = await client.query(
      'SELECT id, condicion_iva FROM clientes WHERE id = $1 AND activo = TRUE', [input.cliente_id],
    )
    const customer = clientRows[0]
    if (!customer) throw httpError(404, 'El cliente no existe o está inactivo.')

    const products = await lockProducts(client, items)

    // Un emisor monotributista siempre factura C sin IVA; si no, la condición del cliente define A o B.
    const monotributo = input.emisor_monotributista === true
    // Un responsable inscripto o un monotributista receptor recibe Factura A; el resto, Factura B.
    const invoiceType = monotributo ? 'FACTURA_C'
      : ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA'].includes(customer.condicion_iva) ? 'FACTURA_A' : 'FACTURA_B'
    // Las ventas de un emisor monotributista son Factura C y no generan IVA.
    const lines = calculateLines(items, products, true, monotributo ? new Decimal(0) : IVA_RATE)
    const net = sum(lines, 'neto')
    const tax = sum(lines, 'iva')
    const total = net.plus(tax)
    const payments = await validatePayments(client, input.pagos, total, 'venta')
    const { rows } = await client.query(
      `INSERT INTO ventas (cliente_id, fecha, tipo_comprobante, neto, iva, total, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [customer.id, input.fecha, invoiceType, net.toFixed(2), tax.toFixed(2), total.toFixed(2), userId],
    )
    const sale = rows[0]

    for (const line of lines) {
      await client.query(
        `INSERT INTO detalle_ventas
           (venta_id, producto_id, cantidad, precio_unitario, costo_unitario_snapshot, neto, iva, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sale.id, line.productoId, line.cantidad, line.precioUnitario.toFixed(2),
          line.costoUnitario.toFixed(2), line.neto.toFixed(2), line.iva.toFixed(2), line.total.toFixed(2)],
      )
    }

    await savePayments(client, payments, sale.id, null)
    const accounts = await getAccountIds(client)
    const surcharge = sum(payments, 'recargo')
    if (!surcharge.isZero() && !accounts['4.2.01']) {
      throw httpError(500, 'Falta la cuenta 4.2.01; ejecute database/migrations/003_cheque_diferido_recargos.sql.')
    }
    const invoiceLines = payments.map((payment) => ({ cuentaId: payment.cuentaId, debe: payment.cobrado }))
    invoiceLines.push(
      { cuentaId: accounts['4.1.02'], haber: net },
      { cuentaId: accounts['2.1.04'], haber: tax },
      { cuentaId: accounts['4.2.01'], haber: surcharge },
    )
    await createJournal(client, {
      fecha: input.fecha, descripcion: `Venta según ${invoiceType} ${sale.numero_comprobante}`,
      tipo: 'VENTA', reference: { ventaId: sale.id }, userId, lines: invoiceLines,
    })

    return { ...sale, costo_mercaderias_vendidas: '0.00' }
  })
}

export async function reverseJournal(client, journal, userId, description, date) {
  const { rows } = await client.query(
    'SELECT cuenta_id, debe, haber FROM detalle_asientos WHERE asiento_id = $1 ORDER BY id',
    [journal.id],
  )
  const reference = journal.cancelacion_id
    ? { cancelacionId: journal.cancelacion_id }
    : { ventaId: journal.venta_id }
  await createJournal(client, {
    fecha: date,
    descripcion: description,
    tipo: journal.tipo_operacion,
    reference,
    userId,
    lines: rows.map((line) => ({ cuentaId: line.cuenta_id, debe: line.haber, haber: line.debe })),
  })
}

async function replaceSaleStock(client, saleId, oldItems, lines, date) {
  const productIds = [...new Set([
    ...oldItems.map((item) => Number(item.producto_id)),
    ...lines.map((item) => item.productoId),
  ])].sort((left, right) => left - right)
  const products = await lockProducts(client, productIds.map((producto_id) => ({ producto_id })))
  const { rows: oldMovements } = await client.query(
    `SELECT id, producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, fecha, venta_id
     FROM movimientos_stock WHERE producto_id = ANY($1::BIGINT[]) ORDER BY producto_id, fecha, id FOR UPDATE`,
    [productIds],
  )
  const historyByProduct = new Map()
  for (const productId of productIds) {
    const history = oldMovements.filter((movement) => Number(movement.producto_id) === productId)
    const product = products.get(productId)
    const lastMovement = history.at(-1)
    if (lastMovement && Number(lastMovement.stock_nuevo) !== Number(product.stock)) {
      throw httpError(409, `El historial de stock de ${product.nombre} no coincide con su existencia actual; no se puede editar la venta de forma segura.`)
    }
    const saleMovements = history.filter((movement) => Number(movement.venta_id) === Number(saleId))
    const oldSaleItems = oldItems.filter((item) => Number(item.producto_id) === productId)
    if (saleMovements.length > 0 && saleMovements.length !== oldSaleItems.length) {
      throw httpError(409, `Falta un movimiento de stock de la venta para ${product.nombre}; no se puede editarla de forma segura.`)
    }
    historyByProduct.set(productId, {
      openingStock: history.length ? Number(history[0].stock_anterior) : Number(product.stock),
      adjustmentDeltas: new Map(history.map((movement) => [
        Number(movement.id),
        Number(movement.stock_nuevo) - Number(movement.stock_anterior),
      ])),
    })
  }

  const oldSaleMovements = oldMovements.filter((movement) => Number(movement.venta_id) === Number(saleId))
  const saleMovementByProduct = new Map(oldSaleMovements.map((movement) => [Number(movement.producto_id), movement]))
  const linesByProduct = new Map(lines.map((line) => [line.productoId, line]))
  for (const movement of oldSaleMovements) {
    if (!linesByProduct.has(Number(movement.producto_id))) {
      await client.query('DELETE FROM movimientos_stock WHERE id = $1', [movement.id])
    }
  }
  for (const line of lines) {
    const oldMovement = saleMovementByProduct.get(line.productoId)
    if (oldMovement) {
      await client.query(
        `UPDATE movimientos_stock SET fecha = $1, cantidad = $2,
         stock_anterior = $2, stock_nuevo = 0 WHERE id = $3`,
        [date, line.cantidad, oldMovement.id],
      )
    } else {
      await client.query(
        `INSERT INTO movimientos_stock
         (producto_id, fecha, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, venta_id)
         VALUES ($1, $2, 'VENTA', $3, $3, 0, $4)`,
        [line.productoId, date, line.cantidad, saleId],
      )
    }
  }

  const { rows: newMovements } = await client.query(
    `SELECT id, producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, fecha, venta_id
     FROM movimientos_stock WHERE producto_id = ANY($1::BIGINT[]) ORDER BY producto_id, fecha, id`,
    [productIds],
  )
  for (const productId of productIds) {
    const history = newMovements.filter((movement) => Number(movement.producto_id) === productId)
    const { openingStock, adjustmentDeltas } = historyByProduct.get(productId)
    let balance = openingStock
    for (const movement of history) {
      let delta
      if (movement.tipo_movimiento === 'AJUSTE') {
        delta = adjustmentDeltas.get(Number(movement.id))
        if (delta === undefined) delta = Number(movement.stock_nuevo) - Number(movement.stock_anterior)
      } else {
        delta = Number(movement.cantidad) * (movement.tipo_movimiento === 'COMPRA' ? 1 : -1)
      }
      const nextBalance = balance + delta
      if (nextBalance < 0) {
        throw httpError(400, `La edición dejaría el stock de ${products.get(productId).nombre} negativo en ${movement.fecha}.`)
      }
      await client.query(
        'UPDATE movimientos_stock SET stock_anterior = $1, stock_nuevo = $2 WHERE id = $3',
        [balance, nextBalance, movement.id],
      )
      balance = nextBalance
    }
    await client.query(
      'UPDATE productos SET stock = $1, updated_at = NOW() WHERE id = $2',
      [balance, productId],
    )
  }
  return products
}

export function allocateSettlements(settlements, payments) {
  const creditPayments = payments.filter((payment) => CREDIT_PAYMENT_CODES.has(payment.codigo))
    .map((payment) => ({ payment, remaining: payment.cobrado }))
  const assignments = []
  const orderedSettlements = [...settlements].sort((left, right) => (
    new Date(left.fecha) - new Date(right.fecha) || Number(left.id) - Number(right.id)
  ))

  for (const settlement of orderedSettlements) {
    const amount = new Decimal(settlement.importe)
    const candidate = creditPayments
      .filter(({ remaining }) => remaining.gte(amount))
      .sort((left, right) => left.remaining.minus(amount).cmp(right.remaining.minus(amount)))[0]
    if (!candidate) {
      throw httpError(400, 'Los cobros registrados no caben en los nuevos saldos a crédito. Ajuste las formas de pago para conservar capacidad suficiente.')
    }
    candidate.remaining = candidate.remaining.minus(amount)
    assignments.push({ settlement, payment: candidate.payment })
  }
  return assignments
}

export async function updateSale(saleId, input, userId) {
  const items = validateItems(input.items)
  if (!input.cliente_id || !input.fecha) throw httpError(400, 'Cliente y fecha son obligatorios.')

  return withTransaction(async (client) => {
    const { rows: saleRows } = await client.query(
      'SELECT * FROM ventas WHERE id = $1 FOR UPDATE', [saleId],
    )
    const sale = saleRows[0]
    if (!sale) throw httpError(404, 'La venta no existe.')
    const { rows: closedPeriods } = await client.query(
      `SELECT mes, anio FROM liquidaciones_iva
       WHERE (mes = EXTRACT(MONTH FROM $1::DATE) AND anio = EXTRACT(YEAR FROM $1::DATE))
          OR (mes = EXTRACT(MONTH FROM $2::DATE) AND anio = EXTRACT(YEAR FROM $2::DATE))
       LIMIT 1`,
      [sale.fecha, input.fecha],
    )
    if (closedPeriods.length) {
      throw httpError(409, 'No se puede editar la venta porque su período actual o el nuevo ya tiene una liquidación de IVA.')
    }

    const { rows: customerRows } = await client.query(
      'SELECT id, condicion_iva FROM clientes WHERE id = $1 AND activo = TRUE', [input.cliente_id],
    )
    const customer = customerRows[0]
    if (!customer) throw httpError(404, 'El cliente no existe o está inactivo.')

    const { rows: oldItems } = await client.query(
      `SELECT producto_id, cantidad, costo_unitario_snapshot
       FROM detalle_ventas WHERE venta_id = $1 ORDER BY producto_id FOR UPDATE`,
      [saleId],
    )
    const products = await lockProducts(client, items)
    const issuerMonotributo = input.emisor_monotributista === undefined
      ? sale.tipo_comprobante === 'FACTURA_C'
      : input.emisor_monotributista === true
    const invoiceType = issuerMonotributo ? 'FACTURA_C'
      : ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA'].includes(customer.condicion_iva) ? 'FACTURA_A' : 'FACTURA_B'
    const lines = calculateLines(items, products, true, issuerMonotributo ? new Decimal(0) : IVA_RATE)
    const oldCostByProduct = new Map(oldItems.map((item) => [
      Number(item.producto_id), new Decimal(item.costo_unitario_snapshot),
    ]))
    for (const line of lines) {
      if (oldCostByProduct.has(line.productoId)) {
        line.costoUnitario = oldCostByProduct.get(line.productoId)
      }
    }
    const net = sum(lines, 'neto')
    const tax = sum(lines, 'iva')
    const total = net.plus(tax)
    const payments = await validatePayments(client, input.pagos, total, 'venta')
    const accounts = await getAccountIds(client)

    const { rows: settlements } = await client.query(
      `SELECT c.id, c.fecha, c.importe, c.forma_pago_id, c.numero
       FROM cancelaciones c
       JOIN pagos_operacion po ON po.id = c.pago_operacion_id
       WHERE po.venta_id = $1 AND c.tipo = 'COBRO'
       ORDER BY c.fecha, c.id
       FOR UPDATE OF c, po`,
      [saleId],
    )
    const assignments = allocateSettlements(settlements, payments)

    const { rows: oldJournals } = await client.query(
      `SELECT id, tipo_operacion, venta_id, cancelacion_id, fecha
       FROM asientos WHERE venta_id = $1 ORDER BY id FOR UPDATE`,
      [saleId],
    )
    for (const journal of oldJournals) {
      await reverseJournal(client, journal, userId, `Reversión por edición de venta ${sale.numero_comprobante}`, todayDate())
    }
    for (const settlement of settlements) {
      const { rows: journals } = await client.query(
        `SELECT id, tipo_operacion, venta_id, cancelacion_id, fecha
         FROM asientos WHERE cancelacion_id = $1 ORDER BY id FOR UPDATE`,
        [settlement.id],
      )
      for (const journal of journals) {
        await reverseJournal(client, journal, userId, `Reversión por edición del cobro ${settlement.numero}`, todayDate())
      }
    }

    await replaceSaleStock(client, saleId, oldItems, [], input.fecha)
    await client.query('DELETE FROM detalle_ventas WHERE venta_id = $1', [saleId])
    for (const line of lines) {
      await client.query(
        `INSERT INTO detalle_ventas
         (venta_id, producto_id, cantidad, precio_unitario, costo_unitario_snapshot, neto, iva, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [saleId, line.productoId, line.cantidad, line.precioUnitario.toFixed(2),
          line.costoUnitario.toFixed(2), line.neto.toFixed(2), line.iva.toFixed(2), line.total.toFixed(2)],
      )
    }
    await client.query(
      `UPDATE ventas SET cliente_id = $1, fecha = $2, tipo_comprobante = $3,
       neto = $4, iva = $5, total = $6 WHERE id = $7`,
      [customer.id, input.fecha, invoiceType, net.toFixed(2), tax.toFixed(2), total.toFixed(2), saleId],
    )

    const newPayments = await savePayments(client, payments, saleId, null)
    const savedPaymentByInput = new Map(payments.map((payment, index) => [payment, newPayments[index]]))
    for (const { settlement, payment } of assignments) {
      await client.query(
        'UPDATE cancelaciones SET pago_operacion_id = $1 WHERE id = $2',
        [savedPaymentByInput.get(payment).id, settlement.id],
      )
    }
    await client.query('DELETE FROM pagos_operacion WHERE venta_id = $1 AND id <> ALL($2::BIGINT[])',
      [saleId, newPayments.map((payment) => payment.id)])

    const surcharge = sum(payments, 'recargo')
    if (!surcharge.isZero() && !accounts['4.2.01']) {
      throw httpError(500, 'Falta la cuenta 4.2.01; ejecute database/migrations/003_cheque_diferido_recargos.sql.')
    }
    const invoiceLines = payments.map((payment) => ({ cuentaId: payment.cuentaId, debe: payment.cobrado }))
    invoiceLines.push(
      { cuentaId: accounts['4.1.02'], haber: net },
      { cuentaId: accounts['2.1.04'], haber: tax },
      { cuentaId: accounts['4.2.01'], haber: surcharge },
    )
    await createJournal(client, {
      fecha: input.fecha, descripcion: `Venta según ${invoiceType} ${sale.numero_comprobante}`,
      tipo: 'VENTA', reference: { ventaId: saleId }, userId, lines: invoiceLines,
    })

    const { rows: settlementMethods } = await client.query(
      `SELECT id, codigo, cuenta_venta_id AS cuenta_id
       FROM formas_pago WHERE id = ANY($1::BIGINT[])`,
      [settlements.map((settlement) => settlement.forma_pago_id)],
    )
    const methodsById = new Map(settlementMethods.map((method) => [Number(method.id), method]))
    for (const { settlement, payment } of assignments) {
      const method = methodsById.get(Number(settlement.forma_pago_id))
      if (!method?.cuenta_id) throw httpError(409, `No se pudo resolver el medio del cobro ${settlement.numero}.`)
      await createJournal(client, {
        fecha: settlement.fecha,
        descripcion: `Reaplicación del cobro ${settlement.numero} s/ factura ${sale.numero_comprobante}`,
        tipo: 'COBRO',
        reference: { cancelacionId: settlement.id },
        userId,
        lines: [
          { cuentaId: method.cuenta_id, debe: settlement.importe },
          { cuentaId: payment.cuentaId, haber: settlement.importe },
        ],
      })
    }

    return { ...sale, cliente_id: customer.id, fecha: input.fecha, tipo_comprobante: invoiceType,
      neto: net.toFixed(2), iva: tax.toFixed(2), total: total.toFixed(2),
      costo_mercaderias_vendidas: '0.00' }
  })
}

function todayDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// Compra: registra comprobante o gasto sin factura, guarda pagos y contabiliza el impacto contable.
export async function createPurchase(input, userId) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw httpError(400, 'La operación debe incluir al menos un producto.')
  }
  // Los renglones libres solo llevan descripción y precio: no tocan el catálogo ni el stock.
  const freeInput = input.items.filter((item) => !item.producto_id)
  const catalogInput = input.items.filter((item) => item.producto_id)
  const freeItems = freeInput.map((item) => {
    const description = String(item.descripcion ?? '').trim()
    const quantity = Number(item.cantidad)
    const accountCode = String(item.cuenta_codigo ?? '5.2.01')
    if (!description || description.length > 180 || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, 'Cada renglón libre necesita una descripción (hasta 180 caracteres) y una cantidad entera mayor a cero.')
    }
    if (!PURCHASE_LINE_ACCOUNT_CODES.has(accountCode)) {
      throw httpError(400, 'La cuenta del renglón de compra no es válida.')
    }
    return {
      descripcion: description, cantidad: quantity, cuentaCodigo: accountCode,
      precioUnitario: money(item.precio_unitario, 'El precio unitario'),
    }
  })
  const items = catalogInput.length ? validateItems(catalogInput) : []
  if (!input.proveedor_id || !input.fecha) {
    throw httpError(400, 'Proveedor y fecha son obligatorios.')
  }

  const invoiceType = input.tipo_comprobante ?? 'FACTURA_A'
  const noInvoice = invoiceType === 'SIN_COMPROBANTE'
  if (!['FACTURA_A', 'FACTURA_B', 'SIN_COMPROBANTE'].includes(invoiceType)) {
    throw httpError(400, 'El tipo de comprobante debe ser FACTURA_A, FACTURA_B o SIN_COMPROBANTE.')
  }
  const invoiceNumber = noInvoice ? null : String(input.numero_comprobante ?? '').trim()
  if (!noInvoice && !invoiceNumber) {
    throw httpError(400, 'El número de factura es obligatorio.')
  }

  return withTransaction(async (client) => {
    const { rows: providerRows } = await client.query(
      'SELECT id FROM proveedores WHERE id = $1 AND activo = TRUE', [input.proveedor_id],
    )
    if (!providerRows[0]) throw httpError(404, 'El proveedor no existe o está inactivo.')

    const products = await lockProducts(client, items)
    // La Factura B no discrimina IVA, por lo que no genera crédito fiscal.
    const taxRate = invoiceType === 'FACTURA_A' ? IVA_RATE : new Decimal(0)
    const lines = calculateLines(items, products, false, taxRate)
    const freeLines = freeItems.map((item) => {
      const net = item.precioUnitario.mul(item.cantidad).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      const tax = net.mul(taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      return { ...item, neto: net, iva: tax, total: net.plus(tax) }
    })
    const stockNet = sum(lines, 'neto')
    const freeNet = sum(freeLines, 'neto')
    const net = stockNet.plus(freeNet)
    const tax = sum(lines, 'iva').plus(sum(freeLines, 'iva'))
    const total = net.plus(tax)
    const payments = await validatePayments(client, input.pagos, total, 'compra')
    const { rows } = await client.query(
      `INSERT INTO compras (proveedor_id, fecha, tipo_comprobante, numero_comprobante, neto, iva, total, creado_por)
       VALUES ($1, $2, $8, $3, $4, $5, $6, $7) RETURNING *`,
      [input.proveedor_id, input.fecha, invoiceNumber,
        net.toFixed(2), tax.toFixed(2), total.toFixed(2), userId, invoiceType],
    )
    const purchase = rows[0]
    const accounts = await getAccountIds(client)
    const freeAccountTotals = new Map()
    for (const line of freeLines) {
      const accountId = accounts[line.cuentaCodigo]
      if (!accountId) throw httpError(500, `Falta la cuenta ${line.cuentaCodigo} en el plan contable.`)
      const current = freeAccountTotals.get(accountId) ?? new Decimal(0)
      freeAccountTotals.set(accountId, current.plus(line.neto))
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO detalle_compras (compra_id, producto_id, cantidad, precio_unitario, neto, iva, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [purchase.id, line.productoId, line.cantidad, line.precioUnitario.toFixed(2),
          line.neto.toFixed(2), line.iva.toFixed(2), line.total.toFixed(2)],
      )
      await writeStockMovement(client, {
        product: products.get(line.productoId), item: line, date: input.fecha,
        type: 'COMPRA', referenceId: purchase.id, unitCost: line.precioUnitario,
      })
    }
    for (const line of freeLines) {
      await client.query(
        `INSERT INTO detalle_compras (compra_id, producto_id, descripcion, cuenta_id, cantidad, precio_unitario, neto, iva, total)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)`,
        [purchase.id, line.descripcion, accounts[line.cuentaCodigo], line.cantidad, line.precioUnitario.toFixed(2),
          line.neto.toFixed(2), line.iva.toFixed(2), line.total.toFixed(2)],
      )
    }

    await savePayments(client, payments, null, purchase.id)
    const surcharge = sum(payments, 'recargo')
    if (!surcharge.isZero() && !accounts['5.2.02']) {
      throw httpError(500, 'Falta la cuenta 5.2.02; ejecute database/migrations/003_cheque_diferido_recargos.sql.')
    }
    const purchaseLines = [
      { cuentaId: accounts['1.1.03'], debe: stockNet },
      ...[...freeAccountTotals].map(([cuentaId, importe]) => ({ cuentaId, debe: importe })),
      { cuentaId: accounts['1.1.05'], debe: tax },
      { cuentaId: accounts['5.2.02'], debe: surcharge },
      ...payments.map((payment) => ({ cuentaId: payment.cuentaId, haber: payment.cobrado })),
    ]
    await createJournal(client, {
      fecha: input.fecha,
      descripcion: noInvoice ? `Gasto sin comprobante - ${freeLines[0]?.descripcion || 'compra'}`.slice(0, 240)
        : `Compra según factura ${purchase.numero_comprobante}`,
      tipo: 'COMPRA', reference: { compraId: purchase.id }, userId, lines: purchaseLines,
    })
    return purchase
  })
}