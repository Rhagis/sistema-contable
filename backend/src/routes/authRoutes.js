import { Router } from 'express'
import { currentUser, login, logout } from '../controllers/authController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Permite iniciar/cerrar sesion y restaurar la identidad al recargar la aplicacion.
router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, currentUser)

export default router