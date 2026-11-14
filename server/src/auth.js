import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

// Verifica el ID token de Firebase Auth (firma, emisor, audiencia, expiración).
export async function verificarToken(token, projectId) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  })
  if (!payload.sub) throw new Error('token sin sub')
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }
}
