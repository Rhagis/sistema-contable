import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import authRoutes from './routes/authRoutes.js'
import catalogRoutes from './routes/catalogRoutes.js'
import operationRoutes from './routes/operationRoutes.js'
import { errorHandler, notFound } from './middleware/errors.js'

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.get('/api/health', (request, response) => response.json({ status: 'ok' }))
app.use('/api/auth', authRoutes)
app.use('/api', catalogRoutes)
app.use('/api', operationRoutes)
app.use(notFound)
app.use(errorHandler)

export default app