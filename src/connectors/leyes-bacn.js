import * as cheerio from "cheerio";
import { createClient, assertOk, cleanText } from "../lib/http-client.js";
import { errorContent, successContent } from "../lib/mcp-output.js";

/**
 * Conector: Leyes Paraguayas (BACN - Biblioteca y Archivo del Congreso Nacional)
 * Fuente: https://www.bacn.gov.py/leyes-paraguayas
 *
 * Equivalente funcional al "InfoLEG" del hub argentino: base de leyes nacionales
 * con buscador propio.
 *
 * Confirmado con navegador real:
 *   - /buscar/buscar?s=... mezcla resultados con bloques laterales.
 *   - /buscar.php?j=si&s=... devuelve JSON de autocompletado con
 *     titulo_documento, nombre_categoria e id_documento.
 *   - las fichas usan /leyes-paraguayas/{id}/{slug}.
 */

const BASE_URL = "https://www.bacn.gov.py";

function client() {
  return createClient(BASE_URL);
}

export function slugify(text) {
  return cleanText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/nº|n°/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function registerLeyesTools(server, { z }) {
  server.tool(
    "leyes__buscar",
    "Busca leyes paraguayas por palabra clave en la base de la Biblioteca y Archivo del Congreso Nacional (BACN). " +
      "Devuelve título, número de ley y enlace a cada resultado encontrado.",
    {
      query: z.string().describe("Palabra(s) clave a buscar, ej: 'endometriosis' o 'presupuesto general'"),
    },
    async ({ query }) => {
      const http = client();
      const res = await http.get("/buscar.php", { params: { j: "si", s: query } });
      assertOk(res, "BACN - búsqueda de leyes");

      const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      const resultados = data
        .filter((item) => item?.nombre_categoria === "Leyes Paraguayas")
        .map((item) => {
          const titulo = cleanText(item.titulo_documento ?? "");
          const id = String(item.id_documento ?? "");
          const match = titulo.match(/Ley\s*N[°ºo]?\s*([\d.]+(?:\/\d{4})?)/i);

          return {
            id,
            numero: match ? match[1] : null,
            titulo,
            categoria: item.nombre_categoria,
            url: `${BASE_URL}/leyes-paraguayas/${encodeURIComponent(id)}/${slugify(titulo)}`,
          };
        });

      if (resultados.length === 0) {
        return errorContent("No encontré resultados en el autocompletado de BACN.", {
          source: BASE_URL,
          query,
          endpoint: `${BASE_URL}/buscar.php?j=si&s=${encodeURIComponent(query)}`,
        });
      }

      return successContent({ source: BASE_URL, query, total: resultados.length, resultados });
    }
  );

  server.tool(
    "leyes__obtener_ley",
    "Obtiene el texto completo de una ley paraguaya a partir de su URL en bacn.gov.py " +
      "(la que devuelve leyes__buscar).",
    {
      url: z.string().describe("URL completa de la ley en bacn.gov.py, ej: https://www.bacn.gov.py/leyes-paraguayas/3477/..."),
    },
    async ({ url }) => {
      if (!url.includes("bacn.gov.py")) {
        throw new Error("La URL debe ser del dominio bacn.gov.py (obtenida con leyes__buscar).");
      }
      const http = createClient(undefined);
      const res = await http.get(url);
      assertOk(res, "BACN - obtener ley");

      const $ = cheerio.load(res.data);

      // Heurística: nos quedamos con el contenedor que tenga más texto,
      // descartando nav/header/footer/script/style.
      $("script, style, nav, header, footer").remove();
      let mejorTexto = "";
      $("article, main, .content, #content, body").each((_, el) => {
        const t = cleanText($(el).text());
        if (t.length > mejorTexto.length) mejorTexto = t;
      });

      const titulo = cleanText($("h1").first().text()) || cleanText($("title").text());

      return successContent({
        source: BASE_URL,
        titulo,
        url,
        texto: mejorTexto.slice(0, 15000),
        truncado: mejorTexto.length > 15000,
      });
    }
  );
}
