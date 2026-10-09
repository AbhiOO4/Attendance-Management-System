import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Employee company ID: letters/digits in hyphen-separated groups (e.g. "NGDP-105").
// Mirrors COMPANY_ID_RE in server/src/middlewares/validation.js — keep in sync.
export const COMPANY_ID_RE = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/
