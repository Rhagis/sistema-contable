import assert from 'node:assert/strict'
import test from 'node:test'
import { errorHandler } from '../src/middleware/errors.js'

function restoreEnvironment(value) {
  if (value === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = value
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('oculta los detalles del error interno en producción', () => {
  const previousEnvironment = process.env.NODE_ENV
  const previousConsoleError = console.error
  const response = responseRecorder()
  process.env.NODE_ENV = 'production'
  console.error = () => {}

  try {
    errorHandler(new Error('detalle de base de datos'), {}, response, () => {})
    assert.equal(response.statusCode, 500)
    assert.deepEqual(response.body, { message: 'Ocurrió un error interno.' })
  } finally {
    restoreEnvironment(previousEnvironment)
    console.error = previousConsoleError
  }
})

test('devuelve el detalle del error interno fuera de producción', () => {
  const previousEnvironment = process.env.NODE_ENV
  const previousConsoleError = console.error
  const response = responseRecorder()
  delete process.env.NODE_ENV
  console.error = () => {}

  try {
    errorHandler(new Error('detalle de prueba'), {}, response, () => {})
    assert.equal(response.statusCode, 500)
    assert.deepEqual(response.body, { message: 'detalle de prueba' })
  } finally {
    restoreEnvironment(previousEnvironment)
    console.error = previousConsoleError
  }
})
