import { rateLimit, ipKeyGenerator } from "express-rate-limit"

// Counters live in this process's memory, which fits the single API instance in production.
// They reset on a restart. Running more than one instance needs a shared store.
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILED_PER_EMAIL_AND_NETWORK = 10
const MAX_ATTEMPTS_PER_NETWORK = 100

const shared = {
  windowMs: WINDOW_MS,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please wait 15 minutes and try again.",
  },
}

const networkKey = (req) => ipKeyGenerator(req.ip)

// Slows guessing one account's password. Keyed by email AND network, so someone elsewhere
// can't lock a real user out by failing on purpose. Only failures count.
export const loginFailureLimiter = rateLimit({
  ...shared,
  limit: MAX_FAILED_PER_EMAIL_AND_NETWORK,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ""
    return `${networkKey(req)}|${email}`
  },
})

// Slows one network trying a password against many different emails. Every attempt counts.
export const loginNetworkLimiter = rateLimit({
  ...shared,
  limit: MAX_ATTEMPTS_PER_NETWORK,
  keyGenerator: networkKey,
})

// TRUST_PROXY_DEBUG=1 logs what the API sees on a login, to find the right TRUST_PROXY_HOPS.
// These lines contain visitors' IP addresses, so turn it off again after checking.
export const logClientIpForProxyCheck = (req, res, next) => {
  if (process.env.TRUST_PROXY_DEBUG === "1") {
    console.log(`[trust-proxy] req.ip=${req.ip} x-forwarded-for=${req.headers["x-forwarded-for"] || "(none)"}`)
  }
  next()
}
