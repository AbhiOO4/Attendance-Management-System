import jwt from 'jsonwebtoken'

const VALID_SAME_SITE = ["strict", "lax", "none"]
let warnedInvalidSameSite = false

// Attributes of the `token` auth cookie — shared by login (set) and logout (clear).
// SameSite comes from the SAME_SITE env var so each deployment picks its own:
//   lax  — client and API share a registrable domain (ngdp.online → api.ngdp.online)
//   none — client and API are on different sites (cross-site; forces Secure)
//   unset/invalid — legacy default: "none" in production, "strict" otherwise.
// Read at call time: ESM imports run before dotenv.config() in server.js.
export const authCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === "production"
    const fallback = isProduction ? "none" : "strict"

    const raw = (process.env.SAME_SITE || "").trim().toLowerCase()
    let sameSite = fallback
    if (VALID_SAME_SITE.includes(raw)) {
        sameSite = raw
    } else if (raw && !warnedInvalidSameSite) {
        warnedInvalidSameSite = true
        console.warn(`[cookie] Invalid SAME_SITE "${process.env.SAME_SITE}" — expected strict | lax | none. Using "${fallback}".`)
    }

    return {
        httpOnly: true, //cant be accesed with js avoid xss attacks
        secure: isProduction || sameSite === "none", // browsers reject SameSite=None without Secure
        sameSite,
    }
}

export const generateTokenAndSetCookie = (res, user) => {
    const token = jwt.sign({
    id: user._id,
    role: user.role,
  }, process.env.JWT_SECRET, {expiresIn: '30d'})

    res.cookie('token', token, {
        ...authCookieOptions(),
        maxAge: 30*24*60*60*1000
    });

    return token;
}
