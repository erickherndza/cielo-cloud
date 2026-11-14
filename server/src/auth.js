import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

const MAX_TOKEN_LEN = 4096

// Verifica el ID token de Firebase Auth (firma RS256, emisor, audiencia,
// expiración). Devuelve también si el correo está verificado: la API se lo
// exige al usuario (las cuentas de Google/Microsoft llegan ya verificadas).
export async function verificarToken(token, projectId) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LEN) throw new Error('token inválido')
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
    clockTolerance: 5,
  })
  if (!payload.sub) throw new Error('token sin sub')
  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
  }
}
