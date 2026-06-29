import * as cheerio from "cheerio";
import { createClient, assertOk, cleanText } from "../lib/http-client.js";
import { errorContent, searchContent, successContent } from "../lib/mcp-output.js";

/**
 * Conector: Sistema de Información de la Jurisprudencia de la Corte Suprema de Justicia
 * Fuente: https://www.csj.gov.py/jurisprudencia/
 *
 * Fallos de las Salas de la CSJ y tribunales desde 1995, sumarizados e
 * indizados por el Instituto de Investigaciones Jurídicas (IIJ).
 * Equivalente funcional a JUBA/SAIJ/SCBA del hub argentino.
 *
 * ESTADO:
 *   - la página de criterios carga por GET normal y se pudo confirmar en vivo
 *     con listas reales y extensas de filtros.
 *   - la búsqueda real hace POST a /jurisprudencia/Home/Busqueda con token
 *     antifalsificación y luego consulta /jurisprudencia/Jurisprudencias/GetData.
 */

const BASE_URL = "https://www.csj.gov.py";
const PATH = "/jurisprudencia/Home/Criterios";

function client() {
  return createClient(BASE_URL);
}

function formUrlEncoded(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of entries) body.append(key, value ?? "");
  return body;
}

function extractCsjToken(html) {
  return html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1] ?? null;
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return "";
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.map((cookie) => cookie.split(";")[0]).join("; ");
  }
  return setCookieHeader.split(";")[0];
}

export function parseJurisprudenciaRows(data) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((row) => ({
    codigo: row.CodigoJurisprudencia ?? null,
    tipo_resolucion: row.TipoResolucionJudicial?.DescripcionTipoResolucionJudicial ?? null,
    numero: row.NoResolucionJudicial ?? null,
    anio: row.FechaResolucionJudicial ?? null,
    caratula: row.CaratulaPublicacion ?? null,
    sala: row.Sala?.DescripcionSala ?? null,
  }));
}

export function registerCsjJurisprudenciaTools(server, { z }) {
  server.tool(
    "jurisprudencia__listar_filtros",
    "Lista los valores disponibles para filtrar la jurisprudencia de la CSJ: Salas, Materias, " +
      "Tipo de Resolución, Preopinantes (ministros), Acción Resuelta y Resultado de la Acción. " +
      "Útil para saber qué valores exactos usar antes de armar una búsqueda.",
    {},
    async () => {
      const http = client();
      const res = await http.get(PATH);
      assertOk(res, "CSJ Jurisprudencia - listar filtros");

      const $ = cheerio.load(res.data);
      const opciones = [];
      $("option").each((_, el) => {
        const t = cleanText($(el).text());
        if (t && !/seleccione/i.test(t)) opciones.push(t);
      });

      return successContent({
        source: `${BASE_URL}${PATH}`,
        aviso:
          "Listado extraído en vivo de los <select> de la página de criterios. " +
          "Incluye Salas, Materias, Tipo de Resolución, Preopinante, Acción Resuelta, " +
          "Resultado de la Acción y Tribunal de Origen mezclados (no se pudo separar por " +
          "categoría sin ver los atributos 'name'/'id' reales del <select> en el navegador).",
        total: opciones.length,
        valores: opciones,
      });
    }
  );

  server.tool(
    "jurisprudencia__buscar",
    "Busca fallos en el Sistema de Jurisprudencia de la CSJ por texto, año, sala y filtros relacionados.",
    {
      texto: z.string().optional().describe("Palabras a buscar en el texto del fallo"),
      anio: z.number().optional().describe("Año de la resolución, ej: 2023"),
      sala: z.string().optional().describe("Sala o tribunal, ej: 'SALA PENAL'"),
      materia: z.string().optional().describe("Materia, ej: 'Constitucional'"),
      tipoResolucion: z.string().optional().describe("Tipo de resolución, ej: 'Acuerdo y Sentencia'"),
      preopinante: z.string().optional().describe("Ministro preopinante"),
      accionResuelta: z.string().optional().describe("Acción resuelta"),
      instancia: z.string().optional().describe("Resultado de la acción"),
      tribunalOrigen: z.string().optional().describe("Tribunal de origen"),
      normasReferencia: z.string().optional().describe("Palabras en normas de referencia"),
      limit: z.number().optional().describe("Cantidad máxima de resultados a devolver (por defecto 10)"),
    },
    async ({
      texto,
      anio,
      sala,
      materia,
      tipoResolucion,
      preopinante,
      accionResuelta,
      instancia,
      tribunalOrigen,
      normasReferencia,
      limit = 10,
    }) => {
      const http = client();
      const criterioRes = await http.get(PATH);
      assertOk(criterioRes, "CSJ Jurisprudencia - cargar criterios");
      const token = extractCsjToken(criterioRes.data);
      if (!token) {
        throw new Error("CSJ Jurisprudencia: no se pudo obtener el token antifalsificación.");
      }
      const cookie = extractCookie(criterioRes.headers?.["set-cookie"]);

      const postBody = formUrlEncoded([
        ["__RequestVerificationToken", token],
        ["PalabrasTexto", texto ?? ""],
        ["TipoResolucion", tipoResolucion ?? ""],
        ["Numero", ""],
        ["Anno", anio ? String(anio) : ""],
        ["RangoFecha", ""],
        ["Materias", materia ?? ""],
        ["Salas", sala ?? ""],
        ["Preopinantes", preopinante ?? ""],
        ["AccionesResueltas", accionResuelta ?? ""],
        ["Instancias", instancia ?? ""],
        ["TribunalesOrigen", tribunalOrigen ?? ""],
        ["NormasReferencia", normasReferencia ?? texto ?? ""],
      ]);

      const busquedaRes = await http.post("/jurisprudencia/Home/Busqueda", postBody, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: `${BASE_URL}${PATH}`,
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cookie,
        },
      });
      assertOk(busquedaRes, "CSJ Jurisprudencia - buscar criterios");

      const pageHtml = cheerio.load(busquedaRes.data);
      const tableScript = cleanText(pageHtml("script").last().text());
      const ajaxMatch = tableScript.match(/url\s*:\s*"\/jurisprudencia\/Jurisprudencias\/GetData"/);
      if (!ajaxMatch) {
        return errorContent("La página respondió, pero no se pudo confirmar el DataTable de resultados.", {
          source: `${BASE_URL}${PATH}`,
          texto: texto ?? "",
          anio: anio ?? null,
          sala: sala ?? "",
        });
      }

      const dataRes = await http.post(
        "/jurisprudencia/Jurisprudencias/GetData",
        formUrlEncoded([
          ["draw", "1"],
          ["start", "0"],
          ["length", String(limit)],
          ["search[value]", ""],
          ["search[regex]", "false"],
          ["order[0][column]", "0"],
          ["order[0][dir]", "asc"],
          ["columns[0][data]", "CodigoJurisprudencia"],
          ["columns[0][name]", ""],
          ["columns[0][searchable]", "true"],
          ["columns[0][orderable]", "true"],
          ["columns[0][search][value]", ""],
          ["columns[0][search][regex]", "false"],
          ["columns[1][data]", "TipoResolucionJudicial.DescripcionTipoResolucionJudicial"],
          ["columns[1][name]", ""],
          ["columns[1][searchable]", "true"],
          ["columns[1][orderable]", "true"],
          ["columns[1][search][value]", ""],
          ["columns[1][search][regex]", "false"],
          ["columns[2][data]", "NoResolucionJudicial"],
          ["columns[2][name]", ""],
          ["columns[2][searchable]", "true"],
          ["columns[2][orderable]", "true"],
          ["columns[2][search][value]", ""],
          ["columns[2][search][regex]", "false"],
          ["columns[3][data]", "FechaResolucionJudicial"],
          ["columns[3][name]", ""],
          ["columns[3][searchable]", "true"],
          ["columns[3][orderable]", "true"],
          ["columns[3][search][value]", ""],
          ["columns[3][search][regex]", "false"],
          ["columns[4][data]", "CaratulaPublicacion"],
          ["columns[4][name]", ""],
          ["columns[4][searchable]", "true"],
          ["columns[4][orderable]", "true"],
          ["columns[4][search][value]", ""],
          ["columns[4][search][regex]", "false"],
          ["columns[5][data]", "Sala.DescripcionSala"],
          ["columns[5][name]", ""],
          ["columns[5][searchable]", "true"],
          ["columns[5][orderable]", "true"],
          ["columns[5][search][value]", ""],
          ["columns[5][search][regex]", "false"],
        ]),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer: `${BASE_URL}/jurisprudencia/Home/Busqueda`,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookie,
          },
        }
      );
      assertOk(dataRes, "CSJ Jurisprudencia - get data");

      const payload = typeof dataRes.data === "string" ? JSON.parse(dataRes.data) : dataRes.data;
      const resultados = parseJurisprudenciaRows(payload);

      if (resultados.length > 0) {
        return searchContent({
          source: `${BASE_URL}${PATH}`,
          texto: texto ?? "",
          anio: anio ?? null,
          sala: sala ?? "",
          materia: materia ?? "",
          tipo_resolucion: tipoResolucion ?? "",
          preopinante: preopinante ?? "",
          accion_resuelta: accionResuelta ?? "",
          instancia: instancia ?? "",
          tribunal_origen: tribunalOrigen ?? "",
          total: resultados.length,
          resultados,
        });
      }

      return errorContent("El endpoint respondió pero no devolvió filas.", {
        source: `${BASE_URL}${PATH}`,
        texto: texto ?? "",
        anio: anio ?? null,
        sala: sala ?? "",
        materia: materia ?? "",
        tipo_resolucion: tipoResolucion ?? "",
        preopinante: preopinante ?? "",
        accion_resuelta: accionResuelta ?? "",
        instancia: instancia ?? "",
        tribunal_origen: tribunalOrigen ?? "",
        total: 0,
        resultados: [],
      });
    }
  );
}
