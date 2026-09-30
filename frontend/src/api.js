import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
})

export function errorMessage(error) {
  return error.response?.data?.message || 'No fue posible completar la solicitud.'
}

// Las vistas importan el mismo cliente para mantener base URL y sesion coherentes.
export default api