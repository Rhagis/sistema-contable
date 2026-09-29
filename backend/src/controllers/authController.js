import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../config/db.js'
import { httpError } from '../middleware/errors.js'

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
})

export async function login(request, response, next) {
  try {
    const { email, password } = request.body
    if (!email || !password) throw httpError(400, 'Email y contraseña son obligatorios.')

    const { rows } = await pool.query(
      'SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1 AND activo = TRUE',
      [email.trim().toLowerCase()],
    )
    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw httpError(401, 'Credenciales incorrectas.')
    }

    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    )
    response.cookie('token', token, cookieOptions())
    return response.json({ user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } })
  } catch (error) {
    return next(error)
  }
}

export function logout(request, response) {
  response.clearCookie('token', { ...cookieOptions(), maxAge: undefined })
  response.status(204).end()
}

export function currentUser(request, response) {
  response.json({ user: request.user })
}