import jwt from 'jsonwebtoken'

// Lee el JWT de la cookie, verifica firma y vencimiento, y adjunta su contenido a la solicitud.
export function requireAuth(request, response, next) {
  const token = request.cookies.token

  if (!token) {
    return response.status(401).json({ message: 'Debe iniciar sesión.' })
  }

  try {
    request.user = jwt.verify(token, process.env.JWT_SECRET)
    return next()
  } catch {
    return response.status(401).json({ message: 'La sesión no es válida o expiró.' })
  }
}