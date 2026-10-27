import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { renderMonthlyBalancePdf } from '../src/services/monthlyBalancePdfService.js'

const row = (index) => ({
  codigo: `1.1.${String(index).padStart(2, '0')}`,
  nombre: `Cuenta contable ${index}`,
  tipo: index % 2 ? 'ACTIVO' : 'RESULTADO_NEGATIVO',
  debe: '125.50',
  haber: '25.50',
  activo: '100.00',
  pasivo: '0.00',
  saldo_deudor: '100.00',
  saldo_acreedor: '0.00',
  resultado_positivo: '0.00',
  resultado_negativo: '0.00',
})

test('genera un PDF de balance mensual incluso sin movimientos', async () => {
  const bytes = await renderMonthlyBalancePdf([], 9, 2026)
  const pdf = await PDFDocument.load(bytes)

  assert.equal(pdf.getPageCount(), 1)
  assert.ok(bytes.length > 0)
})

test('pagina todas las cuentas del balance', async () => {
  const bytes = await renderMonthlyBalancePdf(Array.from({ length: 60 }, (_, index) => row(index + 1)), 9, 2026)
  const pdf = await PDFDocument.load(bytes)

  assert.ok(pdf.getPageCount() > 1)
})
