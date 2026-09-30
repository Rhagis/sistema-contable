import 'dotenv/config'
import app from './app.js'
import { pool } from './config/db.js'

const port = Number(process.env.PORT || 3000)

app.listen(port, () => {
  console.log(`API APEX SOFTWARE disponible en http://localhost:${port}`)
})

process.on('SIGTERM', async () => {
  await pool.end()
  process.exit(0)
})