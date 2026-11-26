import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS_FIREBASE = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const MAX_TOKEN_LEN = 4096

// Error de la INFRAESTRUCTURA de autenticación (no se pudieron obtener las llaves de Google: red caída,
// tiempo agotado, respuesta inválida). No significa que el token sea malo: la API responde 503 (reintentar)
// y no 401, que el cliente entendería como «tu sesión no vale» y mostraría como cierre de sesión.
export class AuthNoDisponible extends Error {
  constructor(causa) { super('Servicio de autenticación no disponible'); this.name = 'AuthNoDisponible'; this.cause = causa }
}

// ¿El fallo viene de obtener las llaves (red / tiempo / respuesta) y no de un token incorrecto?
function esFallaDeLlaves(err) {
  const c = String(err?.code ?? '')
  if (['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC', 'ERR_JWKS_INVALID'].includes(c)) return true   // tiempo agotado / respuesta no válida o mal formada de las llaves
  if (err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError') return true   // fetch falló
  const red = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']
  return red.includes(String(err?.cause?.code ?? ''))
}

/**
 * Crea un verificador de ID tokens de Firebase Auth (firma RS256, emisor, audiencia, expiración).
 * Las llaves se descargan una vez y se guardan en caché: si Google deja de responder DESPUÉS de eso, los
 * tokens siguen verificándose con las llaves guardadas. Si no responde al arrancar en frío, falla CERRADO
 * (nunca acepta un token sin verificar) con AuthNoDisponible.
 */
export function crearVerificador({ jwksUrl = JWKS_FIREBASE, timeoutDuration = 4_000, cooldownDuration = 30_000, cacheMaxAge = 600_000 } = {}) {
  const JWKS = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge })
  return async function verificarToken(token, projectId) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LEN) throw new Error('token inválido')
    let payload
    try {
      ;({ payload } = await jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }))
    } catch (err) {
      if (esFallaDeLlaves(err)) throw new AuthNoDisponible(err)
      throw err
    }
    if (!payload.sub) throw new Error('token sin sub')
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
    }
  }
}

// Verifica el ID token de Firebase Auth. Devuelve también si el correo está verificado: la API se lo
// exige al usuario (las cuentas de Google/Microsoft llegan ya verificadas).
export const verificarToken = crearVerificador()
