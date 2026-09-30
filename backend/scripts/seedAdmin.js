import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool } from '../src/config/db.js'

// Crea o reactiva al administrador inicial y guarda la contrasena unicamente como hash bcrypt.
try {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Configure ADMIN_NAME, ADMIN_EMAIL y ADMIN_PASSWORD antes de crear el administrador.')
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash)
     VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE
      SET nombre = EXCLUDED.nombre,
          password_hash = EXCLUDED.password_hash,
          activo = TRUE`,
    [ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), passwordHash],
  )
  console.log('Usuario administrador creado o ya existente.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}