import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { renderJournalPdf } from '../src/services/journalPdfService.js'

const row = (index) => ({
  asiento_id: Math.floor(index / 2) + 1,
  fecha: '2026-09-05',
  descripcion: `Asiento de prueba ${index}`,
  cuenta_codigo: '1.1.01',
  cuenta: 'Caja',
  debe: index % 2 === 0 ? '100.25' : '0',
  haber: index % 2 === 0 ? '0' : '100.25',
})

test('genera un PDF legible para el diario sin movimientos', async () => {
  const bytes = await renderJournalPdf([], { desde: '2026-09-01', hasta: '2026-09-30' })
  const pdf = await PDFDocument.load(bytes)

  assert.equal(pdf.getPageCount(), 1)
  assert.ok(bytes.length > 0)
})

test('pagina todos los movimientos del diario', async () => {
  const bytes = await renderJournalPdf(Array.from({ length: 30 }, (_, index) => row(index)))
  const pdf = await PDFDocument.load(bytes)

  assert.ok(pdf.getPageCount() > 1)
})
