import * as cheerio from "cheerio";
import { createClient, assertOk, cleanText } from "../lib/http-client.js";
import { errorContent, searchContent, successContent } from "../lib/mcp-output.js";

/**
 * Conector: Base Legislativa de la Corte Suprema de Justicia
 * Fuente: https://www.csj.gov.py/legislacion
 *
 * Convenio CSJ-Presidencia: leyes, decretos, resoluciones, decretos-ley y la
 * Constitución desde 1869. Equivalente funcional al "InfoLEG" argentino,
 * pero con cobertura histórica mucho más profunda.
 *
 * Confirmado con navegador real:
 *   - el formulario libre frmBusquedaLibre hace POST a
 *     /legislacion/Consulta/Resultado usando jquery.form/ajaxForm
 *   - el resultado vuelve como HTML server-side con items .list-item.box.
 */

const BASE_URL = "https://www.csj.gov.py";
const PATH = "/legislacion";

function client() {
  return createClient(BASE_URL);
}

export function formUrlEncoded(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of entries) body.append(key, value ?? "");
  return body;
}

function tituloDesdeNodo($, el) {
  const $el = $(el);
  return (
    cleanText($el.find(".title").first().text()) ||
    cleanText($el.find("h1, h2, h3, h4, strong, b").first().text()) ||
    cleanText($el.find("a[href]").first().text()) ||
    cleanText($el.text())
  );
}

function esRuidoCSJ(texto) {
  const limpio = texto ? cleanText(texto) : "";
  return /^(10 por página|ordenar por|título a-z|no se han encontrado resultados|anterior|siguiente|\d+|\.\.\.)$/i.test(
    limpio
  );
}

function pareceNormaCSJ(titulo, descripcion, gaceta) {
  const combo = [titulo, descripcion, gaceta].filter(Boolean).join(" ").trim();
  if (!combo) return false;
  return /^(ley|decreto|resoluci[oó]n|constituci[oó]n|decreto ley|acuerdo|ordenanza|reglamento)\b/i.test(
    cleanText(combo)
  );
}

export function extraerResultados($, limit = 25) {
  const resultados = [];
  const vistos = new Set();
  const candidatos = $(".list-item.box, .list-item, .box, .result, .resultado, article, tr, li").toArray();

  for (const el of candidatos) {
    const $el = $(el);
    const titulo = tituloDesdeNodo($, el);
    const descripcion =
      cleanText($el.find(".desc, .description, .detalle, .subtitle").first().text()) ||
      null;
    const institucion =
      cleanText($el.find(".ministerio, .institution, .organo").first().text()) ||
      null;
    const gaceta = cleanText($el.find(".date, .fecha, time").first().text()) || null;
    const href = $el.find("a[href]").first().attr("href") ?? null;
    const ruido =
      esRuidoCSJ(titulo) ||
      esRuidoCSJ(descripcion) ||
      esRuidoCSJ(institucion) ||
      esRuidoCSJ(gaceta) ||
      !pareceNormaCSJ(titulo, descripcion, gaceta);

    if (ruido) continue;

    const clave = [titulo, descripcion ?? "", institucion ?? "", gaceta ?? "", href ?? ""].join("|");
    if (!titulo || vistos.has(clave)) continue;
    vistos.add(clave);
    resultados.push({
      id: $el.attr("id") ?? null,
      gaceta,
      titulo,
      descripcion,
      institucion,
      url: href ?? null,
    });
  }

  return resultados.slice(0, limit);
}

export function registerCsjLegislacionTools(server, { z }) {
  server.tool(
    "csjleyes__listar_filtros",
    "Lista los valores válidos para filtrar la Base Legislativa de la CSJ: tipos de normativa " +
      "(Ley, Decreto, Resolución, etc.), materias (Civil, Tributaria, Laboral, etc.) e instituciones " +
      "(ministerios). Útil antes de armar una búsqueda específica.",
    {},
    async () => {
      const http = client();
      const res = await http.get(PATH);
      assertOk(res, "CSJ Legislación - listar filtros");

      const $ = cheerio.load(res.data);

      const extraerLista = (encabezadoRegex) => {
        const valores = [];
        $("a, li").each((_, el) => {
          const t = cleanText($(el).text());
          if (t && t.length > 1 && t.length < 80 && !encabezadoRegex.test(t)) {
            valores.push(t);
          }
        });
        return valores;
      };

      // Nota: esta extracción es deliberadamente amplia (toma <a>/<li> de
      // toda la página) porque el árbol de colapsables (Tipo de Normativa /
      // Materias / Instituciones) no tiene IDs estables visibles desde el
      // HTML extraído. Si devuelve ruido de navegación, hay que acotar el
      // selector a los contenedores #collapseOne / #collapseTwo /
      // #consultaInstituciones una vez confirmados en el navegador.
      const items = extraerLista(/seleccione|consulta|inicio|contáctenos/i);

      return successContent({
        source: `${BASE_URL}${PATH}`,
        aviso:
          "Extracción heurística de valores de filtro. Puede incluir ruido de navegación; " +
          "verificar contra https://www.csj.gov.py/legislacion en el navegador.",
        valores: items.slice(0, 200),
      });
    }
  );

  server.tool(
    "csjleyes__buscar",
    "Busca normativa (leyes, decretos, resoluciones, decretos-ley y Constitución) en la Base Legislativa de la CSJ.",
    {
      query: z.string().describe("Palabra(s) clave a buscar en el nombre de la normativa"),
      limit: z.number().optional().describe("Cantidad máxima de resultados a devolver (por defecto 25)"),
    },
    async ({ query, limit = 25 }) => {
      const http = client();
      const res = await http.post(
        "/legislacion/Consulta/Resultado",
        formUrlEncoded([
          ["Palabras", query],
          ["BusquedaEnTexto", "false"],
          ["Materias", "[]"],
          ["Fuentes", "[]"],
          ["Temas", "[]"],
          ["Instituciones", "[]"],
          // El formulario real serializa dos hidden con el mismo nombre.
          ["BusquedaEnTexto", ""],
          ["Numero", ""],
          ["AnnoGaceta", "0"],
          ["Texto", ""],
        ]),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: `${BASE_URL}${PATH}`,
          },
        }
      );
      assertOk(res, "CSJ Legislación - buscar");

      const $ = cheerio.load(res.data);
      const resultados = extraerResultados($, limit);

      if (resultados.length > 0) {
        return searchContent({
          source: `${BASE_URL}${PATH}`,
          query,
          total_mostrado: resultados.length,
          resultados,
          endpoint: `${BASE_URL}/legislacion/Consulta/Resultado`,
          total: resultados.length,
        });
      }

      return errorContent("La búsqueda no devolvió resultados parseables o el HTML cambió de estructura.", {
        source: `${BASE_URL}${PATH}`,
        query,
        total_mostrado: 0,
        resultados: [],
      });
    }
  );
}
