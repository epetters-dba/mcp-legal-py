import axios from "axios";

/**
 * Cliente HTTP compartido por todos los conectores.
 *
 * Las fuentes oficiales paraguayas suelen:
 *  - bloquear user-agents de bots (axios/node por defecto a veces es rechazado)
 *  - depender de cookies de sesión / ViewState (sitios .NET WebForms o MVC clásicos)
 *  - devolver HTML para renderizar en el navegador, no JSON
 *
 * Por eso usamos un user-agent de navegador real y mantenemos cookies entre
 * llamadas dentro de una misma búsqueda cuando el conector lo necesite.
 */
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "es-PY,es;q=0.9,en;q=0.8",
};

export function createClient(baseURL, opts = {}) {
  const client = axios.create({
    baseURL,
    timeout: opts.timeout ?? 20000,
    headers: { ...DEFAULT_HEADERS, ...(opts.headers || {}) },
    // Algunos sitios públicos paraguayos presentan certificados con cadena
    // incompleta (mismo caso que SCBA en el hub argentino). Si hace falta,
    // se puede desactivar la verificación TLS SOLO para ese cliente puntual,
    // nunca de forma global. Por defecto queda activada.
    validateStatus: () => true,
  });
  return client;
}

export function assertOk(response, context) {
  if (response.status >= 400) {
    throw new Error(
      `${context}: el sitio respondió HTTP ${response.status}. ` +
        `Puede que esté caído, haya cambiado de estructura, o esté bloqueando la solicitud.`
    );
  }
}

/** Recorta y limpia espacios/saltos de línea repetidos de un texto extraído de HTML. */
export function cleanText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Resuelve una URL relativa contra una base, devolviendo siempre absoluta. */
export function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}
