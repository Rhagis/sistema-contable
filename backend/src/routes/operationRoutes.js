import { Router } from 'express'
import { addPurchase, addSale, listOperations } from '../controllers/operationController.js'
import { accounts, dashboard, journal, ledger, paymentMethods, settleVat, vatSummary } from '../controllers/reportController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)
router.get('/dashboard', dashboard)
router.get('/cuentas', accounts)
router.get('/formas-pago', paymentMethods)
router.post('/ventas', addSale)
router.get('/ventas', (request, response, next) => {
  request.params.type = 'ventas'
  return listOperations(request, response, next)
})
router.get('/ventas/:id', (request, response, next) => {
  request.params.type = 'ventas'
  return listOperations(request, response, next)
})
router.post('/compras', addPurchase)
router.get('/compras', (request, response, next) => {
  request.params.type = 'compras'
  return listOperations(request, response, next)
})
router.get('/compras/:id', (request, response, next) => {
  request.params.type = 'compras'
  return listOperations(request, response, next)
})
router.get('/libro-diario', journal)
router.get('/asientos', journal)
router.get('/asientos/:id', journal)
router.get('/mayor/:cuentaId', ledger)
router.get('/iva', vatSummary)
router.post('/iva/liquidar', settleVat)

export default router