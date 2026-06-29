import * as cheerio from "cheerio";
import { createClient, assertOk, cleanText, resolveUrl } from "../lib/http-client.js";
import { errorContent, searchContent, successContent } from "../lib/mcp-output.js";

/**
 * Conector: Digesto Legislativo (Honorable Cámara de Senadores)
 * Fuente: https://digestolegislativo.gov.py/
 *
 * Legislación paraguaya organizada por categoría temática (Administrativa,
 * Civil, Comercial, Tributaria, etc.), con ficha por norma (número, fecha de
 * promulgación/sanción y archivo descargable). Equivalente funcional a
 * "Normativa PBA" del hub argentino, pero a nivel nacional y por materia.
 *
 * ESTADO:
 *   - digesto__listar_categorias: ✅ confirmado en vivo, HTML server-side.
 *   - digesto__obtener_norma: ✅ confirmado en vivo, HTML server-side
 *     (ej: https://digestolegislativo.gov.py/detalles&id=1474).
 *   - digesto__buscar: ✅ el formulario visible usa GET /buscar/buscar y
 *     devuelve la lista de normas ya renderizada en HTML.
 */

const BASE_URL = "https://digestolegislativo.gov.py";

function client() {
  return createClient(BASE_URL);
}

export function searchParams(query, categoria) {
  const params = { action: "ajax", page: "1", buscar: query };
  if (categoria !== undefined) params.categoria = categoria;
  return params;
}

export function extraerResultadosBusqueda($) {
  const items = [];
  const vistos = new Set();

  $(".list-item.box").each((_, el) => {
    const titulo = cleanText($(el).find(".title").first().text());
    const desc = cleanText($(el).find(".desc").first().text());
    const url = $(el).find("a[href]").first().attr("href");
    const href = url ? resolveUrl(BASE_URL, url) : null;
    const clave = [titulo, desc, href].join("|");
    if (!titulo || vistos.has(clave)) return;
    vistos.add(clave);

    items.push({
      titulo,
      descripcion: desc || null,
      url: href,
      texto: cleanText($(el).text()),
    });
  });

  return items;
}

export function registerDigestoTools(server, { z }) {
  server.tool(
    "digesto__listar_categorias",
    "Lista las categorías y subcategorías temáticas del Digesto Legislativo paraguayo " +
      "(Administrativa, Civil, Comercial, Tributaria, Penal, etc.) junto con la cantidad de normas " +
      "en cada una y el ID interno necesario para otras consultas.",
    {},
    async () => {
      const http = client();
      const res = await http.get("/");
      assertOk(res, "Digesto Legislativo - listar categorías");

      const $ = cheerio.load(res.data);
      const categorias = [];

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const texto = cleanText($(el).text());
        if (!href || !texto) return;
        // Las categorías reales tienen el patrón /{slug}/{id}/ con un slug
        // que empieza con número, ej: /1-administrativa/1/ o
        // /16-educacion-y-cultura/305/166-cultura
        if (/^\/\d+-[a-z0-9-]+\/\d+\/?/i.test(href)) {
          categorias.push({
            nombre: texto,
            url: resolveUrl(BASE_URL, href),
          });
        }
      });

      return successContent({ source: BASE_URL, total: categorias.length, categorias });
    }
  );

  server.tool(
    "digesto__obtener_norma",
    "Obtiene la ficha de una norma específica del Digesto Legislativo a partir de su ID interno " +
      "(número de norma en el sistema, no el número de Ley): título, número de norma, fecha de " +
      "promulgación, fecha de sanción y enlace al archivo (Word/PDF) si está disponible.",
    {
      id: z.union([z.string(), z.number()]).describe("ID interno de la norma en digestolegislativo.gov.py"),
    },
    async ({ id }) => {
      const http = client();
      const res = await http.get(`/detalles&id=${encodeURIComponent(id)}`);
      assertOk(res, "Digesto Legislativo - obtener norma");

      const $ = cheerio.load(res.data);
      const titulo = cleanText($("h2").first().text());
      const textoCompleto = cleanText($("body").text());

      const numero = textoCompleto.match(/Número de Norma:\s*([^\n]+?)(?:\s|$)/i)?.[1]?.trim() ?? null;
      const fechaPromulgacion =
        textoCompleto.match(/Fecha de Promulgación:\s*([\d-]+)/i)?.[1] ?? null;
      const fechaSancion = textoCompleto.match(/Fecha de Sanción:\s*([\d-]+)/i)?.[1] ?? null;

      const archivos = [];
      $("a[href*='/ups/']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) archivos.push(resolveUrl(BASE_URL, href));
      });

      if (!titulo) {
        return {
          content: [
            {
              type: "text",
              text: `No se encontró una norma con id=${id}, o cambió la estructura de la ficha. Verificar en ${BASE_URL}/detalles&id=${id}`,
            },
          ],
        };
      }

      return successContent({
        source: BASE_URL,
        id,
        titulo,
        numero,
        fecha_promulgacion: fechaPromulgacion,
        fecha_sancion: fechaSancion,
        archivos,
      });
    }
  );

  server.tool(
    "digesto__buscar",
    "Busca normas en el Digesto Legislativo por título, número, nombre popular o año.",
    {
      query: z.string().describe("Texto, número de norma o nombre popular a buscar"),
      categoria: z.string().optional().describe("Valor de categoría visible en el formulario, si querés acotar la búsqueda"),
    },
    async ({ query, categoria = "" }) => {
      const http = client();
      const res = await http.get("/paginacion/buscar.php", {
        params: searchParams(query, categoria),
      });
      assertOk(res, "Digesto Legislativo - buscar");

      const $ = cheerio.load(res.data);
      const resultados = extraerResultadosBusqueda($);
      const pagina = cleanText($("body").text());

      if (resultados.length > 0) {
        return searchContent({
          source: BASE_URL,
          query,
          categoria,
          total: resultados.length,
          resultados,
          endpoint: `${BASE_URL}/paginacion/buscar.php`,
        });
      }

      return errorContent("No se detectaron filas .list-item.box en la respuesta de búsqueda.", {
        source: BASE_URL,
        query,
        categoria,
        total: 0,
        resultados: [],
        muestra: pagina.slice(0, 2000),
        endpoint: `${BASE_URL}/paginacion/buscar.php`,
      });
    }
  );
}
