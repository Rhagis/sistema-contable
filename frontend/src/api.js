import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
})

export function errorMessage(error) {
  return error.response?.data?.message || 'No fue posible completar la solicitud.'
}

export default api