import Decimal from 'decimal.js'
import { pool } from '../config/db.js'
import { httpError } from '../middleware/errors.js'
import { createJournal, getAccountIds, listAccounts } from '../services/accountingService.js'
import { renderMonthlyBalancePdf } from '../services/monthlyBalancePdfService.js'
import { summarizeBalance } from '../services/balanceTotals.js'
import { renderJournalPdf } from '../services/journalPdfService.js'
import { withTransaction } from '../services/transactionService.js'

const validPeriod = (mes, anio) => Number.isInteger(mes) && mes >= 1 && mes <= 12
  && Number.isInteger(anio) && anio >= 2000 && anio <= 9999

async function fetchJournalRows(query) {
    const { desde, hasta, tipo } = query
    const values = []
    const filters = []
    if (query.id) {
      const id = Number(query.id)
      if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, 'El identificador de asiento no es válido.')
      values.push(id)
      filters.push(`a.id = $${values.length}`)
    }
    if (desde) { values.push(desde); filters.push(`a.fecha >= $${values.length}`) }
    if (hasta) { values.push(hasta); filters.push(`a.fecha <= $${values.length}`) }
    if (tipo) { values.push(tipo.toUpperCase()); filters.push(`a.tipo_operacion = $${values.length}`) }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT a.id AS asiento_id, a.fecha, a.descripcion, a.tipo_operacion,
          c.codigo AS cuenta_codigo, c.nombre AS cuenta, d.debe, d.haber
       FROM asientos a JOIN detalle_asientos d ON d.asiento_id = a.id
       JOIN cuentas_contables c ON c.id = d.cuenta_id
       ${where} ORDER BY a.fecha, a.id, d.id`, values,
    )
    return rows
}

// Devuelve lineas del diario con filtros opcionales por asiento, fechas y tipo.
export async function journal(request, response, next) {
  try {
    response.json(await fetchJournalRows({ ...request.query, id: request.params.id }))
  } catch (error) {
    next(error)
  }
}

export async function journalPdf(request, response, next) {
  try {
    const { desde, hasta } = request.query
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    if (!validDate(desde || '') || !validDate(hasta || '') || desde > hasta) {
      throw httpError(400, 'Indique un rango de fechas válido para generar el Libro Diario.')
    }
    const rows = await fetchJournalRows(request.query)
    const bytes = await renderJournalPdf(rows, request.query)
    response.type('application/pdf')
    response.setHeader('Content-Disposition', 'attachment; filename="libro-diario.pdf"')
    response.send(Buffer.from(bytes))
  } catch (error) {
    next(error)
  }
}

async function fetchMonthlyBalance(mes, anio) {
  if (!validPeriod(mes, anio)) throw httpError(400, 'Mes y año deben ser válidos.')
  const start = `${anio}-${String(mes).padStart(2, '0')}-01`
  const endMonth = mes === 12 ? 1 : mes + 1
  const endYear = mes === 12 ? anio + 1 : anio
  const end = `${String(endYear).padStart(4, '0')}-${String(endMonth).padStart(2, '0')}-01`
  const { rows } = await pool.query(
    `SELECT c.codigo, c.nombre, c.tipo,
        COALESCE(SUM(d.debe), 0) AS debe_acumulado,
        COALESCE(SUM(d.haber), 0) AS haber_acumulado
     FROM cuentas_contables c
     LEFT JOIN (
       SELECT d.cuenta_id, d.debe, d.haber
       FROM detalle_asientos d JOIN asientos a ON a.id = d.asiento_id
       WHERE a.fecha >= $1::DATE AND a.fecha < $2::DATE
     ) d ON d.cuenta_id = c.id
     WHERE c.activo = TRUE
     GROUP BY c.id
     HAVING COALESCE(SUM(d.debe), 0) <> 0 OR COALESCE(SUM(d.haber), 0) <> 0
     ORDER BY c.codigo`, [start, end],
  )
  return rows.map((row) => {
    const balance = new Decimal(row.debe_acumulado).minus(row.haber_acumulado)
    // Activo y Resultado negativo son deudores; Pasivo (incluye Patrimonio Neto) y Resultado positivo, acreedores.
    const column = {
      ACTIVO: 'activo',
      PASIVO: 'pasivo',
      PATRIMONIO_NETO: 'pasivo',
      RESULTADO_POSITIVO: 'resultado_positivo',
      RESULTADO_NEGATIVO: 'resultado_negativo',
    }[row.tipo] ?? 'resultado_positivo'
    const natural = ['activo', 'resultado_negativo'].includes(column) ? balance : balance.negated()
    const amounts = { activo: '0.00', pasivo: '0.00', resultado_positivo: '0.00', resultado_negativo: '0.00' }
    amounts[column] = natural.toFixed(2)
    return {
      codigo: row.codigo,
      nombre: row.nombre,
      tipo: row.tipo,
      debe: new Decimal(row.debe_acumulado).toFixed(2),
      haber: new Decimal(row.haber_acumulado).toFixed(2),
      saldo_deudor: balance.isPositive() ? balance.toFixed(2) : '0.00',
      saldo_acreedor: balance.isNegative() ? balance.abs().toFixed(2) : '0.00',
      ...amounts,
    }
  })
}

export async function monthlyBalance(request, response, next) {
  try {
    const mes = Number(request.query.mes)
    const anio = Number(request.query.anio)
    const cuentas = await fetchMonthlyBalance(mes, anio)
    response.json({ mes, anio, cuentas, totales: summarizeBalance(cuentas) })
  } catch (error) {
    next(error)
  }
}

export async function monthlyBalancePdf(request, response, next) {
  try {
    const mes = Number(request.query.mes)
    const anio = Number(request.query.anio)
    const rows = await fetchMonthlyBalance(mes, anio)
    const bytes = await renderMonthlyBalancePdf(rows, mes, anio)
    response.type('application/pdf')
    response.setHeader('Content-Disposition', `attachment; filename="balance-${anio}-${String(mes).padStart(2, '0')}.pdf"`)
    response.send(Buffer.from(bytes))
  } catch (error) {
    next(error)
  }
}

// Acumula movimientos y calcula el saldo segun la naturaleza de la cuenta contable.
export async function ledger(request, response, next) {
  try {
    const { cuentaId } = request.params
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo, c.nombre, c.tipo,
          a.fecha, a.descripcion, d.debe, d.haber
       FROM cuentas_contables c
       LEFT JOIN detalle_asientos d ON d.cuenta_id = c.id
       LEFT JOIN asientos a ON a.id = d.asiento_id
       WHERE c.id = $1 AND c.activo = TRUE
       ORDER BY a.fecha NULLS FIRST, a.id, d.id`, [cuentaId],
    )
    if (!rows.length) throw httpError(404, 'La cuenta contable no existe.')
    const isDebit = ['ACTIVO', 'RESULTADO_NEGATIVO'].includes(rows[0].tipo)
    let balance = new Decimal(0)
    response.json({
      cuenta: { id: rows[0].id, codigo: rows[0].codigo, nombre: rows[0].nombre },
      movimientos: rows.filter((row) => row.fecha).map((row) => {
        const debe = new Decimal(row.debe)
        const haber = new Decimal(row.haber)
        balance = balance.plus(isDebit ? debe.minus(haber) : haber.minus(debe))
        return { fecha: row.fecha, descripcion: row.descripcion, debe: row.debe, haber: row.haber, saldo: balance.toFixed(2) }
      }),
    })
  } catch (error) {
    next(error)
  }
}

// Calcula debito menos credito del periodo y consulta si ya existe una liquidacion.
export async function vatSummary(request, response, next) {
  try {
    const mes = Number(request.query.mes)
    const anio = Number(request.query.anio)
    if (!validPeriod(mes, anio)) throw httpError(400, 'Mes y año deben ser válidos.')
    const { rows } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(iva) FROM ventas WHERE EXTRACT(MONTH FROM fecha) = $1 AND EXTRACT(YEAR FROM fecha) = $2), 0) AS iva_debito,
         COALESCE((SELECT SUM(iva) FROM compras WHERE EXTRACT(MONTH FROM fecha) = $1 AND EXTRACT(YEAR FROM fecha) = $2), 0) AS iva_credito,
         l.id AS liquidacion_id
       FROM (SELECT 1) periodo
       LEFT JOIN liquidaciones_iva l ON l.mes = $1 AND l.anio = $2`, [mes, anio],
    )
    const debit = new Decimal(rows[0].iva_debito)
    const credit = new Decimal(rows[0].iva_credito)
    const balance = debit.minus(credit)
    response.json({
      mes, anio, iva_debito: debit.toFixed(2), iva_credito: credit.toFixed(2), saldo: balance.toFixed(2),
      resultado: balance.isPositive() ? 'A_PAGAR' : balance.isNegative() ? 'SALDO_A_FAVOR' : 'SIN_SALDO',
      liquidada: rows[0].liquidacion_id !== null, liquidacion_id: rows[0].liquidacion_id,
    })
  } catch (error) {
    next(error)
  }
}

// Cierra el periodo en una transaccion: resumen, liquidacion y asiento de cierre.
export async function settleVat(request, response, next) {
  try {
    const mes = Number(request.body.mes)
    const anio = Number(request.body.anio)
    if (!validPeriod(mes, anio)) throw httpError(400, 'Mes y año deben ser válidos.')

    const settlement = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT
           COALESCE((SELECT SUM(iva) FROM ventas WHERE EXTRACT(MONTH FROM fecha) = $1 AND EXTRACT(YEAR FROM fecha) = $2), 0) AS iva_debito,
           COALESCE((SELECT SUM(iva) FROM compras WHERE EXTRACT(MONTH FROM fecha) = $1 AND EXTRACT(YEAR FROM fecha) = $2), 0) AS iva_credito`,
        [mes, anio],
      )
      const debit = new Decimal(rows[0].iva_debito)
      const credit = new Decimal(rows[0].iva_credito)
      const balance = debit.minus(credit)
      // El signo del saldo define el resultado y la cuenta de contrapartida del asiento.
      const resultado = balance.isPositive() ? 'A_PAGAR' : balance.isNegative() ? 'SALDO_A_FAVOR' : 'SIN_SALDO'
      const { rows: inserted } = await client.query(
        `INSERT INTO liquidaciones_iva (mes, anio, iva_debito, iva_credito, saldo, resultado, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [mes, anio, debit.toFixed(2), credit.toFixed(2), balance.toFixed(2), resultado, request.user.id],
      )
      const liquidation = inserted[0]
      const accounts = await getAccountIds(client)
      const lines = []
      if (!debit.isZero()) lines.push({ cuentaId: accounts['2.1.04'], debe: debit })
      if (!credit.isZero()) lines.push({ cuentaId: accounts['1.1.05'], haber: credit })
      if (balance.isNegative()) {
        lines.push({ cuentaId: accounts['1.1.07'], debe: balance.abs() })
      } else if (balance.isPositive()) {
        lines.push({ cuentaId: accounts['2.1.03'], haber: balance })
      }
      if (lines.length) {
        await createJournal(client, {
          fecha: new Date(anio, mes, 0).toISOString().slice(0, 10),
          descripcion: `Liquidacion de IVA ${String(mes).padStart(2, '0')}/${anio}`,
          tipo: 'LIQUIDACION_IVA', reference: { liquidacionId: liquidation.id },
          userId: request.user.id, lines,
        })
      }
      return liquidation
    })
    response.status(201).json(settlement)
  } catch (error) {
    next(error)
  }
}

// Agrupa indicadores del mes, alertas de stock y operaciones recientes para la pantalla inicial.
export async function dashboard(request, response, next) {
  try {
    const [sales, purchases, lowStock, recent] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(neto), 0) AS neto, COALESCE(SUM(iva), 0) AS iva
        FROM ventas WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)`),
      pool.query(`SELECT COALESCE(SUM(neto), 0) AS neto, COALESCE(SUM(iva), 0) AS iva
        FROM compras WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)`),
      pool.query('SELECT id, nombre, stock FROM productos WHERE activo = TRUE AND stock <= 3 ORDER BY stock, nombre LIMIT 8'),
      pool.query(`SELECT fecha, 'VENTA' AS tipo, numero_comprobante AS comprobante, total
        FROM ventas UNION ALL SELECT fecha, 'COMPRA', COALESCE(numero_comprobante, 'Gasto sin factura'), total FROM compras
        ORDER BY fecha DESC LIMIT 8`),
    ])
    const salesVat = new Decimal(sales.rows[0].iva)
    const purchaseVat = new Decimal(purchases.rows[0].iva)
    const balance = salesVat.minus(purchaseVat)
    response.json({
      ventas_netas: sales.rows[0].neto, compras_netas: purchases.rows[0].neto,
      iva_debito: salesVat.toFixed(2), iva_credito: purchaseVat.toFixed(2),
      saldo_iva: balance.toFixed(2), resultado_iva: balance.isPositive() ? 'A_PAGAR' : balance.isNegative() ? 'SALDO_A_FAVOR' : 'SIN_SALDO',
      bajo_stock: lowStock.rows, operaciones_recientes: recent.rows,
    })
  } catch (error) {
    next(error)
  }
}

// Catalogos auxiliares que la interfaz usa para formularios y movimientos contables.
export async function accounts(request, response, next) {
  try {
    response.json(await listAccounts(pool))
  } catch (error) {
    next(error)
  }
}

export async function paymentMethods(request, response, next) {
  try {
    const { rows } = await pool.query(
      'SELECT id, codigo, nombre FROM formas_pago WHERE activo = TRUE ORDER BY id',
    )
    response.json(rows)
  } catch (error) {
    next(error)
  }
}