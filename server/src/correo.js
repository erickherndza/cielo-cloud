// Envío de correo transaccional con Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sin RESEND_API_KEY no hay envío: el endpoint responde 503 y la app cae al
// método manual (mailto). La llave vive solo en variables de entorno del servidor.

export function crearEnviadorResend({ apiKey, from, fetchFn = fetch }) {
  if (!apiKey || !from) return null
  return async function enviar({ to, subject, text, attachments }) {
    const r = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject, text,
        attachments: attachments?.map(a => ({ filename: a.filename, content: a.content })),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
      const detalle = await r.text().catch(() => '')
      const err = new Error(`Resend ${r.status}`)
      err.detalle = detalle.slice(0, 300)
      throw err
    }
  }
}
