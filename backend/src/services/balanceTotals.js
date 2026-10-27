import Decimal from 'decimal.js'

const FIELDS = ['debe', 'haber', 'saldo_deudor', 'saldo_acreedor', 'activo', 'pasivo', 'resultado_positivo', 'resultado_negativo']

// La diferencia de cada par se coloca bajo la columna de menor valor para igualar ambos totales.
function gap(a, b, nameA, nameB) {
  const difference = a.minus(b).abs()
  const smaller = a.lt(b) ? nameA : nameB
  return { columna: difference.isZero() ? null : smaller, monto: difference.toFixed(2) }
}

export function summarizeBalance(rows) {
  const sums = Object.fromEntries(FIELDS.map((field) => [
    field,
    rows.reduce((total, row) => total.plus(row[field] || 0), new Decimal(0)),
  ]))
  const diferenciaPatrimonial = gap(sums.activo, sums.pasivo, 'activo', 'pasivo')
  const diferenciaResultados = gap(sums.resultado_positivo, sums.resultado_negativo, 'resultado_positivo', 'resultado_negativo')
  return {
    ...Object.fromEntries(FIELDS.map((field) => [field, sums[field].toFixed(2)])),
    diferencia_patrimonial: diferenciaPatrimonial,
    diferencia_resultados: diferenciaResultados,
  }
}
