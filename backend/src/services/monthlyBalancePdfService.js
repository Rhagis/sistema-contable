import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { summarizeBalance } from './balanceTotals.js'

const PAGE_WIDTH = 842
const PAGE_HEIGHT = 595
const MARGIN = 32
const ROW_HEIGHT = 24
const COLUMNS = [
  { label: 'CUENTA', x: MARGIN, width: 48 },
  { label: 'NOMBRE', x: 80, width: 118 },
  { label: 'DEBE', x: 198, width: 76, right: true },
  { label: 'HABER', x: 274, width: 76, right: true },
  { label: 'SALDO DEUDOR', x: 350, width: 76, right: true },
  { label: 'SALDO ACREEDOR', x: 426, width: 76, right: true },
  { label: 'ACTIVO', x: 502, width: 76, right: true },
  { label: 'PASIVO + PN', x: 578, width: 76, right: true },
  { label: 'RESULT. POSITIVO', x: 654, width: 76, right: true },
  { label: 'RESULT. NEGATIVO', x: 730, width: 76, right: true },
]
const money = (value) => Number(value || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function fittedText(value, font, size, maxWidth) {
  let text = String(value ?? '')
  while (text && font.widthOfTextAtSize(text, size) > maxWidth) text = `${text.slice(0, -2)}…`
  return text
}

export async function renderMonthlyBalancePdf(rows, mes, anio) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.13, 0.17, 0.26)
  const muted = rgb(0.4, 0.45, 0.52)
  const line = rgb(0.87, 0.89, 0.92)
  const summary = summarizeBalance(rows)
  let page
  let y

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawText('BALANCE MENSUAL DE SUMAS Y SALDOS', {
      x: MARGIN, y: 548, size: 16, font: bold, color: ink,
    })
    page.drawText(`Período: ${String(mes).padStart(2, '0')}/${anio} · Asientos del mes`, {
      x: MARGIN, y: 529, size: 9, font, color: muted,
    })
    page.drawText(`Página ${pdf.getPageCount()}`, {
      x: PAGE_WIDTH - MARGIN - 55, y: 548, size: 9, font, color: muted,
    })
    page.drawLine({
      start: { x: MARGIN, y: 516 }, end: { x: PAGE_WIDTH - MARGIN, y: 516 }, thickness: 1, color: line,
    })
    COLUMNS.forEach(({ label, x, width, right }) => {
      const size = 7
      const textWidth = bold.widthOfTextAtSize(label, size)
      page.drawText(label, { x: right ? x + width - textWidth : x, y: 501, size, font: bold, color: muted })
    })
    page.drawLine({
      start: { x: MARGIN, y: 493 }, end: { x: PAGE_WIDTH - MARGIN, y: 493 }, thickness: 0.7, color: line,
    })
    y = 478
  }

  addPage()
  if (!rows.length) {
    page.drawText('No hay movimientos contables hasta el cierre del período seleccionado.', {
      x: MARGIN, y, size: 10, font, color: muted,
    })
  }
  rows.forEach((row) => {
    if (y < 70) addPage()
    const values = [
      row.codigo,
      row.nombre,
      money(row.debe),
      money(row.haber),
      money(row.saldo_deudor),
      money(row.saldo_acreedor),
      money(row.activo),
      money(row.pasivo),
      money(row.resultado_positivo),
      money(row.resultado_negativo),
    ]
    values.forEach((value, index) => {
      const column = COLUMNS[index]
      const size = index === 1 ? 8 : 7
      const content = fittedText(value, font, size, column.width - 4)
      const textWidth = font.widthOfTextAtSize(content, size)
      page.drawText(content, {
        x: column.right ? column.x + column.width - textWidth : column.x,
        y,
        size,
        font,
        color: ink,
      })
    })
    y -= ROW_HEIGHT
    page.drawLine({
      start: { x: MARGIN, y: y + 7 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 7 }, thickness: 0.35, color: line,
    })
  })

  if (y < 100) addPage()
  page.drawLine({
    start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 4 }, thickness: 0.8, color: ink,
  })
  const FIELD_BY_COLUMN = [null, null, 'debe', 'haber', 'saldo_deudor', 'saldo_acreedor', 'activo', 'pasivo', 'resultado_positivo', 'resultado_negativo']
  const drawSummaryRow = (label, valueFor, offset) => {
    const values = FIELD_BY_COLUMN.map((field, index) => (index === 0 ? label : field ? valueFor(field) : ''))
    values.forEach((value, index) => {
      if (!value) return
      const column = COLUMNS[index]
      const text = index === 0 ? value : money(value)
      const width = bold.widthOfTextAtSize(text, 7)
      page.drawText(text, {
        x: column.right ? column.x + column.width - width : column.x,
        y: y - offset,
        size: 7,
        font: bold,
        color: ink,
      })
    })
  }
  const differences = [summary.diferencia_patrimonial, summary.diferencia_resultados]
  drawSummaryRow('SUMAS', (field) => summary[field], 10)
  const sumColumns = ['debe', 'haber', 'saldo_deudor', 'saldo_acreedor']
  drawSummaryRow('TOTALES', (field) => (sumColumns.includes(field) ? summary[field] : differences.find((item) => item.columna === field)?.monto), 24)
  page.drawText('Totales: la diferencia entre Activo y Pasivo + PN, y entre Resultado positivo y negativo, se ubica bajo la columna de menor valor.', {
    x: MARGIN, y: y - 42, size: 7, font, color: muted,
  })
  return pdf.save()
}
