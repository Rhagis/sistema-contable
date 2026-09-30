import { Router } from 'express'
import { catalogController } from '../controllers/catalogController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const resources = ['productos', 'clientes', 'proveedores']

// Registra el mismo CRUD protegido para cada catalogo; DELETE realiza una baja logica.
for (const resource of resources) {
  const controller = catalogController(resource)
  router.get(`/${resource}`, requireAuth, controller.list)
  router.post(`/${resource}`, requireAuth, controller.create)
  router.get(`/${resource}/:id`, requireAuth, controller.get)
  router.put(`/${resource}/:id`, requireAuth, controller.update)
  router.delete(`/${resource}/:id`, requireAuth, controller.deactivate)
}

export default router