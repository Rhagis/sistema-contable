import Decimal from 'decimal.js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_WIDTH = 842
const PAGE_HEIGHT = 595
const MARGIN = 40
const ROW_HEIGHT = 32
const COLUMNS = [
  { label: 'FECHA', x: MARGIN, width: 72 },
  { label: 'ASIENTO', x: 112, width: 68 },
  { label: 'CONCEPTO / CUENTA', x: 180, width: 330 },
  { label: 'DEBE', x: 510, width: 135, right: true },
  { label: 'HABER', x: 645, width: 157, right: true },
]

const money = (value) => Number(value || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function dateLabel(value) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}/${month}/${year}` : date
}

function periodLabel({ desde, hasta, tipo }) {
  const dates = desde && hasta
    ? `Período: ${dateLabel(desde)} al ${dateLabel(hasta)}`
    : desde ? `Desde: ${dateLabel(desde)}`
      : hasta ? `Hasta: ${dateLabel(hasta)}`
        : 'Todos los períodos'
  return tipo ? `${dates} · Tipo: ${tipo}` : dates
}

function fittedText(value, font, size, maxWidth) {
  let text = String(value ?? '')
  while (text && font.widthOfTextAtSize(text, size) > maxWidth) text = `${text.slice(0, -2)}…`
  return text
}

export async function renderJournalPdf(rows, filters = {}) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.13, 0.17, 0.26)
  const muted = rgb(0.4, 0.45, 0.52)
  const line = rgb(0.87, 0.89, 0.92)
  const debit = rows.reduce((total, row) => total.plus(row.debe || 0), new Decimal(0))
  const credit = rows.reduce((total, row) => total.plus(row.haber || 0), new Decimal(0))
  let page
  let y

  const drawHeader = (pageNumber) => {
    page.drawText('LIBRO DIARIO', { x: MARGIN, y: 548, size: 18, font: bold, color: ink })
    page.drawText(periodLabel(filters), { x: MARGIN, y: 530, size: 9, font, color: muted })
    page.drawText(`Página ${pageNumber}`, { x: PAGE_WIDTH - MARGIN - 55, y: 548, size: 9, font, color: muted })
    page.drawLine({ start: { x: MARGIN, y: 518 }, end: { x: PAGE_WIDTH - MARGIN, y: 518 }, thickness: 1, color: line })
    COLUMNS.forEach(({ label, x, width, right }) => {
      const textWidth = bold.widthOfTextAtSize(label, 8)
      page.drawText(label, { x: right ? x + width - textWidth : x, y: 503, size: 8, font: bold, color: muted })
    })
    page.drawLine({ start: { x: MARGIN, y: 495 }, end: { x: PAGE_WIDTH - MARGIN, y: 495 }, thickness: 0.7, color: line })
    y = 480
  }

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    drawHeader(pdf.getPageCount())
  }

  addPage()
  if (!rows.length) {
    page.drawText('No hay asientos para los filtros seleccionados.', {
      x: MARGIN, y, size: 10, font, color: muted,
    })
  }

  rows.forEach((row) => {
    if (y < 100) addPage()
    const values = [
      dateLabel(row.fecha),
      `#${String(row.asiento_id).padStart(5, '0')}`,
      fittedText(row.descripcion, font, 9, COLUMNS[2].width - 4),
      money(row.debe),
      money(row.haber),
    ]
    values.forEach((value, index) => {
      const column = COLUMNS[index]
      const face = index === 1 ? bold : font
      const size = index === 0 || index === 1 ? 8 : 9
      const displayed = fittedText(value, face, size, column.width - 4)
      const textWidth = face.widthOfTextAtSize(displayed, size)
      page.drawText(displayed, {
        x: column.right ? column.x + column.width - textWidth : column.x,
        y,
        size,
        font: face,
        color: ink,
      })
    })
    page.drawText(
      fittedText(`${row.cuenta_codigo} · ${row.cuenta}`, font, 7, COLUMNS[2].width - 4),
      { x: COLUMNS[2].x, y: y - 10, size: 7, font, color: muted },
    )
    y -= ROW_HEIGHT
    page.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 10 }, thickness: 0.4, color: line })
  })

  if (y < 75) addPage()
  page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 4 }, thickness: 0.8, color: ink })
  page.drawText('TOTALES', { x: COLUMNS[2].x, y: y - 10, size: 9, font: bold, color: ink })
  const debitText = money(debit)
  const creditText = money(credit)
  page.drawText(debitText, {
    x: COLUMNS[3].x + COLUMNS[3].width - font.widthOfTextAtSize(debitText, 9),
    y: y - 10, size: 9, font: bold, color: ink,
  })
  page.drawText(creditText, {
    x: COLUMNS[4].x + COLUMNS[4].width - font.widthOfTextAtSize(creditText, 9),
    y: y - 10, size: 9, font: bold, color: ink,
  })
  return pdf.save()
}
