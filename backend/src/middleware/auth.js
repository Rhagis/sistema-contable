import jwt from 'jsonwebtoken'

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