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

function tituloDesdeTexto(texto) {
  const lineas = cleanText(texto)
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  return (
    lineas.find((linea) => /^(ley|decreto|resoluci[oó]n|constituci[oó]n|acuerdo|ordenanza|disposici[oó]n|reglamento)\b/i.test(linea)) ??
    lineas[0] ??
    null
  );
}

function descripcionDesdeTexto(texto, titulo) {
  const limpio = cleanText(texto);
  if (!limpio) return null;
  if (titulo && limpio.startsWith(titulo)) {
    const resto = limpio.slice(titulo.length).trim();
    return resto || null;
  }
  return limpio;
}

function esRuidoDigesto(texto) {
  return /^(‹|›|anterior|siguiente|10 por página|ordenar por|título a-z|^\d+$|no se han encontrado resultados)$/i.test(
    cleanText(texto)
  );
}

function pareceNormaDigesto(titulo, descripcion, url) {
  const combo = [titulo, descripcion].filter(Boolean).join(" ").trim();
  if (!combo) return false;
  const tituloOk = /^(ley|decreto|resoluci[oó]n|constituci[oó]n|acuerdo|ordenanza|disposici[oó]n|reglamento)\b/i.test(
    cleanText(combo)
  );
  const urlOk = !url || /\/detalles&id=\d+|\/[0-9]+-[a-z0-9-]+\/[0-9]+/i.test(url);
  return tituloOk && urlOk;
}

function extraerItemDesdeNodo($, el) {
  const $el = $(el);
  const texto = cleanText($el.text());
  if (!texto) return null;

  const enlace = $el.find("a[href]").filter((_, a) => /\/detalles|\/detalle_publicacion|\/[0-9]+-[a-z0-9-]+\/[0-9]+/i.test($(a).attr("href") || "")).first();
  const href = enlace.attr("href") ?? $el.attr("href") ?? null;
  const url = href ? resolveUrl(BASE_URL, href) : null;

  const titulo =
    cleanText($el.find(".title").first().text()) ||
    cleanText($el.find("h1, h2, h3, h4, strong, b").first().text()) ||
    cleanText(enlace.text()) ||
    tituloDesdeTexto(texto);

  const descripcion =
    cleanText($el.find(".desc, .description, .detalle, .subtitle").first().text()) ||
    descripcionDesdeTexto(texto, titulo);

  if (!titulo || esRuidoDigesto(titulo) || esRuidoDigesto(texto)) return null;
  if (descripcion && esRuidoDigesto(descripcion)) return null;
  if (!pareceNormaDigesto(titulo, descripcion, url)) return null;

  return {
    titulo,
    descripcion: descripcion || null,
    url,
    texto,
  };
}

export function extraerResultadosBusqueda($) {
  const items = [];
  const vistos = new Set();
  const candidatos = $("table tr, .list-item, .box, .result, .resultado, li, article, section").toArray();

  for (const el of candidatos) {
    const item = extraerItemDesdeNodo($, el);
    if (!item) continue;

    const clave = item.url ? `url:${item.url}` : `titulo:${item.titulo}|${item.descripcion ?? ""}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    items.push(item);
  }

  if (items.length > 0) return items;

  const textoPlano = cleanText($("body").text());
  const lineas = textoPlano
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean)
    .filter((linea) => !esRuidoDigesto(linea));

  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (!/^(ley|decreto|resoluci[oó]n|constituci[oó]n|acuerdo|ordenanza|disposici[oó]n|reglamento)\b/i.test(linea)) {
      continue;
    }
    const descripcion = lineas[i + 1] && !esRuidoDigesto(lineas[i + 1]) ? lineas[i + 1] : null;
    const matchUrl = textoPlano.match(/\/detalles&id=\d+/i)?.[0] ?? null;
    items.push({
      titulo: linea,
      descripcion,
      url: matchUrl ? resolveUrl(BASE_URL, matchUrl) : null,
      texto: linea + (descripcion ? `\n${descripcion}` : ""),
    });
    if (items.length > 25) break;
  }

  return items.filter((item) => pareceNormaDigesto(item.titulo, item.descripcion, item.url));
}

function esHrefCategoria(href) {
  if (!href) return false;
  return /\/\d+-[a-z0-9-]+\/\d+(?:\/[a-z0-9-]+)?\/?$/i.test(href) || /\/\d+-[a-z0-9-]+\/\d+\/?/i.test(href);
}

export function extraerCategorias($) {
  const categorias = [];
  const vistos = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!esHrefCategoria(href)) return;

    const $el = $(el);
    const texto =
      cleanText($el.text()) ||
      cleanText($el.attr("title")) ||
      cleanText($el.attr("aria-label")) ||
      cleanText($el.closest("li, .box, .item, .card, .row, .col, div").text());

    const url = resolveUrl(BASE_URL, href);
    const clave = url;
    if (vistos.has(clave)) return;
    vistos.add(clave);

    categorias.push({
      nombre: texto || null,
      url,
    });
  });

  if (categorias.length > 0) return categorias.filter((item) => item.url && item.nombre);

  const fallback = [];
  const fallbackVistos = new Set();
  const candidatos = $("li, .card, .box, .item, .row, .col, div").toArray();

  for (const el of candidatos) {
    const texto = cleanText($(el).text());
    if (!texto) continue;
    const link = $(el)
      .find("a[href]")
      .filter((_, a) => esHrefCategoria($(a).attr("href")))
      .first();
    const href = link.attr("href") ?? null;
    if (!href) continue;
    const url = resolveUrl(BASE_URL, href);
    const nombre = cleanText(link.text()) || tituloDesdeTexto(texto);
    const clave = url;
    if (fallbackVistos.has(clave) || !nombre) continue;
    fallbackVistos.add(clave);
    fallback.push({ nombre, url });
  }

  if (fallback.length > 0) return fallback;

  const enlacesPlano = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!esHrefCategoria(href)) return;
    const nombre = cleanText($(el).text());
    if (!nombre || esRuidoDigesto(nombre)) return;
    enlacesPlano.push({
      nombre,
      url: resolveUrl(BASE_URL, href),
    });
  });

  return enlacesPlano;
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
      const categorias = extraerCategorias($);
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

      return errorContent("No se detectaron resultados parseables en la respuesta de búsqueda.", {
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
