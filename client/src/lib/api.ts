// src/lib/api.ts
import axios from "axios"
import { APP_OFFSET } from "@/lib/dateUtils"

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true
})

api.interceptors.request.use((config) => {
  config.headers["X-Timezone-Offset"] = String(APP_OFFSET)
  return config
})