// src/lib/api.ts
import axios from "axios"

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000",
  withCredentials: true
})

api.interceptors.request.use((config) => {
  config.headers["X-Timezone-Offset"] = String(new Date().getTimezoneOffset())
  return config
})