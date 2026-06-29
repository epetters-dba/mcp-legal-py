import * as cheerio from "cheerio";
import { createClient, assertOk, cleanText, resolveUrl } from "../lib/http-client.js";
import { errorContent, successContent } from "../lib/mcp-output.js";

/**
 * Conector: Gaceta Oficial de la República del Paraguay
 * Fuente: https://www.gacetaoficial.gov.py/
 *
 * Equivalente funcional al "BORA" del hub argentino.
 *
 * Confirmado con navegador real:
 *   - la portada lista gacetas recientes con enlaces /index/detalle_publicacion/{id}
 *   - el formulario "Buscar Contenidos" hace POST a /index/buscarContenidos
 *     con campos tipoPublicacion, numero, contenidoPublicacion, fecha y anho
 *   - los resultados vuelven como HTML server-side en una tabla.
 */

const BASE_URL = "https://www.gacetaoficial.gov.py";

function client() {
  return createClient(BASE_URL);
}

export function extraerGacetasRecientes($) {
  const porUrl = new Map();

  $("a[href*='/index/detalle_publicacion/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const url = resolveUrl(BASE_URL, href);
    const item = porUrl.get(url) ?? { titulo: null, fecha: null, url };

    const texto = cleanText($(el).text());
    const contenedor = $(el).closest(".row, .col-md-12, .col-sm-12, li, div");
    const contexto = cleanText(contenedor.text());

    const titulo = texto && /gaceta/i.test(texto) ? texto : contexto.match(/Gaceta\s*N[°º]?\s*\d+/i)?.[0];
    const fechaTexto = texto.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];
    const fecha = fechaTexto ?? contexto.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];

    if (titulo && !item.titulo) item.titulo = titulo;
    if (fechaTexto || (fecha && !item.fecha)) item.fecha = fecha;
    porUrl.set(url, item);
  });

  return [...porUrl.values()].filter((item) => item.titulo);
}

export function extraerResultadosContenido($) {
  const resultados = [];
  const vistos = new Set();

  $("table tr").each((_, tr) => {
    const celdas = $(tr)
      .find("td")
      .map((__, td) => cleanText($(td).text()))
      .get();

    if (celdas.length < 5) return;

    const href = $(tr).find("a[href*='/index/detalle_publicacion/']").attr("href");
    const url = href ? resolveUrl(BASE_URL, href) : null;
    const key = celdas.join("|");
    if (vistos.has(key)) return;
    vistos.add(key);

    resultados.push({
      numero: celdas[0] || null,
      contenido: celdas[1] || null,
      fecha: celdas[2] || null,
      tipo_publicacion: celdas[3] || null,
      institucion: celdas[4] || null,
      url,
    });
  });

  return resultados;
}

export function extraerEnlacesSiguiente($) {
  return $("a[href*='offset=']")
    .map((_, el) => {
      const texto = cleanText($(el).text());
      const href = $(el).attr("href");
      if (!href) return null;
      return { texto, url: resolveUrl(BASE_URL, href) };
    })
    .get()
    .filter(Boolean);
}

function formUrlEncoded(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, value ?? "");
  }
  return body;
}

function extraerPublicaciones($, baseUrl) {
  const items = [];
  const vistos = new Set();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const texto = cleanText($(el).text());
    if (!texto) return;

    const pareceRelevante =
      /gaceta|ley\s*n|decreto|despacho|aviso|registro oficial/i.test(texto) ||
      /\.pdf($|\?)/i.test(href);

    if (!pareceRelevante) return;

    const url = resolveUrl(baseUrl, href);
    if (vistos.has(url)) return;
    vistos.add(url);

    items.push({ titulo: texto, url });
  });

  return items;
}

export function registerGacetaTools(server, { z }) {
  server.tool(
    "gaceta__listar_recientes",
    "Lista las publicaciones más recientes visibles en la portada de la Gaceta Oficial de Paraguay " +
      "(leyes, decretos, despachos y avisos). Útil para ver qué se publicó últimamente sin necesidad de buscar por palabra clave.",
    {},
    async () => {
      const http = client();
      const res = await http.get("/");
      assertOk(res, "Gaceta Oficial - listar recientes");

      const $ = cheerio.load(res.data);
      const items = extraerGacetasRecientes($);

      if (items.length === 0) {
        return {
          ...errorContent("No detecté publicaciones en la portada con la heurística actual.", {
            source: BASE_URL,
            hint: "Verificá que existan enlaces a /index/detalle_publicacion/{id}.",
          }),
        };
      }

      return successContent({ source: BASE_URL, total: items.length, items });
    }
  );

  server.tool(
    "gaceta__buscar",
    "Busca publicaciones (leyes, decretos, avisos) en la Gaceta Oficial de Paraguay por palabra clave. " +
      "Consulta el formulario oficial 'Buscar Contenidos' y devuelve la tabla de resultados.",
    {
      query: z.string().describe("Palabra(s) clave a buscar"),
    },
    async ({ query }) => {
      const http = client();

      const res = await http.post(
        "/index/buscarContenidos",
        formUrlEncoded({
          tipoPublicacion: "",
          numero: "",
          contenidoPublicacion: query,
          fecha: "",
          anho: "",
          buscarContenidos: "BUSCAR",
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: `${BASE_URL}/`,
          },
        }
      );
      assertOk(res, "Gaceta Oficial - buscar contenidos");

      const $ = cheerio.load(res.data);
      const resultados = extraerResultadosContenido($);
      const paginacion = extraerEnlacesSiguiente($);

      if (resultados.length > 0) {
        return successContent({
          source: BASE_URL,
          query,
          total: resultados.length,
          resultados,
          paginacion,
          endpoint: `${BASE_URL}/index/buscarContenidos`,
        });
      }

      const fallbackItems = extraerPublicaciones($, BASE_URL);
      return errorContent(
        "La búsqueda no devolvió filas en la tabla oficial, o cambió la estructura HTML de /index/buscarContenidos.",
        {
          source: BASE_URL,
          query,
          total: 0,
          resultados: [],
          enlaces_detectados: fallbackItems,
        }
      );
    }
  );
}
