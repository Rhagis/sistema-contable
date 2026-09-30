// Convierte errores de PostgreSQL y de validacion en respuestas HTTP consistentes.
export function notFound(request, response) {
  response.status(404).json({ message: 'Recurso no encontrado.' })
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error)

  if (error.code === '23505') {
    return response.status(409).json({ message: 'Ya existe un registro con esos datos.' })
  }

  if (error.code === '23503') {
    return response.status(400).json({ message: 'La operación referencia un registro inexistente.' })
  }

  if (['23502', '23514', '22P02', '22007'].includes(error.code)) {
    return response.status(400).json({ message: 'Los datos enviados no son válidos.' })
  }

  if (error.status && error.status < 500) {
    return response.status(error.status).json({ message: error.message })
  }

  console.error(error)
  return response.status(500).json({ message: 'Ocurrió un error interno.' })
}

// Crea errores que pueden viajar desde servicios hasta el middleware HTTP sin perder su estado.
export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}