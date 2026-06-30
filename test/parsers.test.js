import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

import { extraerGacetasRecientes, extraerResultadosContenido, extraerEnlacesSiguiente } from "../src/connectors/gaceta-oficial.js";
import { extraerCategorias as extraerDigestoCategorias, extraerResultadosBusqueda as extraerDigestoResultados } from "../src/connectors/digesto-legislativo.js";
import { extraerResultados as extraerCsjResultados } from "../src/connectors/csj-legislacion.js";
import { buildBusquedaPayload, parseJurisprudenciaRows } from "../src/connectors/csj-jurisprudencia.js";
import { slugify } from "../src/connectors/leyes-bacn.js";

const fixture = (name) => fs.readFileSync(path.join("test", "fixtures", name), "utf8");

test("gaceta fixtures", () => {
  const $home = cheerio.load(fixture("gaceta-home.html"));
  const recientes = extraerGacetasRecientes($home);
  assert.equal(recientes.length, 3);
  assert.equal(recientes[0].fecha, "26/06/2026");

  const $search = cheerio.load(fixture("gaceta-search.html"));
  const resultados = extraerResultadosContenido($search);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].numero, "3648");
  assert.equal(extraerEnlacesSiguiente($search).length, 1);

  const $empty = cheerio.load(fixture("gaceta-search-empty.html"));
  assert.equal(extraerResultadosContenido($empty).length, 0);
});

test("digesto search fixture", () => {
  const $ = cheerio.load(fixture("digesto-search.html"));
  const resultados = extraerDigestoResultados($);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].titulo, "Ley Nº 3230 del 29 de junio de 2007");

  const $multi = cheerio.load(fixture("digesto-search-multi.html"));
  const multiple = extraerDigestoResultados($multi);
  assert.equal(multiple.length, 2);
  assert.equal(multiple[1].titulo, "Ley Nº 1500 del 12 de agosto de 2008");

  const $generic = cheerio.load(`
    <html>
      <body>
        <table>
          <tr>
            <td>1</td>
            <td><a href="/detalles&id=1474">Ley Nº 1474 del 29 de junio de 2007</a></td>
            <td>Dispone medidas tributarias</td>
          </tr>
        </table>
        <div class="resultado">
          <a href="/detalles&id=1500"><strong>Ley Nº 1500 del 12 de agosto de 2008</strong></a>
          <span class="desc">Actualiza disposiciones administrativas</span>
        </div>
      </body>
    </html>
  `);
  const generic = extraerDigestoResultados($generic);
  assert.equal(generic.length, 2);
  assert.equal(generic[0].titulo, "Ley Nº 1474 del 29 de junio de 2007");
  assert.equal(generic[1].titulo, "Ley Nº 1500 del 12 de agosto de 2008");

  const $noise = cheerio.load(`
    <html>
      <body>
        <div class="pagination">
          <a href="?page=1">‹ Anterior</a>
          <a href="?page=2">1</a>
          <a href="?page=3">Siguiente ›</a>
        </div>
        <table>
          <tr>
            <td><a href="/detalles&id=1474">Ley Nº 1474 del 29 de junio de 2007</a></td>
            <td>Dispone medidas tributarias</td>
          </tr>
        </table>
      </body>
    </html>
  `);
  const noise = extraerDigestoResultados($noise);
  assert.equal(noise.length, 1);
  assert.equal(noise[0].titulo, "Ley Nº 1474 del 29 de junio de 2007");
});

test("digesto categories tolerate nested anchors", () => {
  const $ = cheerio.load(`
    <html>
      <body>
        <div class="card">
          <div class="title">
            <a href="/16-educacion-y-cultura/305/166-cultura" title="Educacion y Cultura">Educacion y Cultura</a>
          </div>
        </div>
        <div class="card">
          <a href="/1-administrativa/1/">Administrativa</a>
        </div>
        <div class="box">
          <a href="/16-educacion-y-cultura/305/166-cultura"><span>Educacion y Cultura</span></a>
        </div>
      </body>
    </html>
  `);
  const categorias = extraerDigestoCategorias($);
  assert.equal(categorias.length, 2);
  assert.equal(categorias[0].nombre, "Educacion y Cultura");
  assert.equal(categorias[1].nombre, "Administrativa");

  const $empty = cheerio.load(`
    <html>
      <body>
        <nav>
          <a href="?page=2">Siguiente</a>
          <a href="?page=1">1</a>
        </nav>
      </body>
    </html>
  `);
  assert.equal(extraerDigestoCategorias($empty).length, 0);
});

test("csj legislacion search fixture", () => {
  const $ = cheerio.load(fixture("csj-legislacion-search.html"));
  const resultados = extraerCsjResultados($, 10);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].titulo, "Ley 5134 /2013");
  assert.equal(resultados[0].institucion, "Ministerio de Hacienda");

  const $generic = cheerio.load(`
    <html>
      <body>
        <table>
          <tr>
            <td>248 - 2013</td>
            <td><a href="/legislacion/Consulta/Detalle/36">Ley 5134 /2013</a></td>
            <td>QUE APRUEBA LA CARTA CONVENIO</td>
            <td>Ministerio de Hacienda</td>
          </tr>
          <tr>
            <td>249 - 2014</td>
            <td><strong>Decreto 1023</strong></td>
            <td>Reglamenta algo</td>
            <td>Ministerio de Educación</td>
          </tr>
        </table>
      </body>
    </html>
  `);
  const generic = extraerCsjResultados($generic, 10);
  assert.equal(generic.length, 2);
  assert.equal(generic[0].titulo, "Ley 5134 /2013");
  assert.equal(generic[1].titulo, "Decreto 1023");

  const $noise = cheerio.load(`
    <html>
      <body>
        <div class="list-item box">
          <span class="title">10 por página</span>
          <span class="desc">Ordenar por</span>
        </div>
        <div class="list-item box">
          <span class="title">Ley 5131/2013</span>
          <span class="date">248 - 2013</span>
          <span class="desc">Ley de ejemplo</span>
          <span class="ministerio">Ministerio de Hacienda</span>
          <a href="/legislacion/Consulta/Detalle/999">ver</a>
        </div>
      </body>
    </html>
  `);
  const filtered = extraerCsjResultados($noise, 10);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].titulo, "Ley 5131/2013");
  assert.equal(filtered[0].gaceta, "248 - 2013");

  const $empty = cheerio.load(fixture("csj-legislacion-search-empty.html"));
  assert.equal(extraerCsjResultados($empty, 10).length, 0);
});

test("bacn slugify", () => {
  assert.equal(
    slugify("Ley Nº 7341/2024 / QUE ESTABLECE EL TRATAMIENTO INTEGRAL A PERSONAS CON ENDOMETRIOSIS Y ADENOMIOSIS."),
    "ley-n-7341-2024-que-establece-el-tratamiento-integral-a-personas-con-endometriosis-y-adenomiosis"
  );
});

test("jurisprudencia data fixture", () => {
  const data = JSON.parse(fixture("csj-jurisprudencia-data.json"));
  const rows = parseJurisprudenciaRows(data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].codigo, "12345");
  assert.equal(rows[0].sala, "SALA CONSTITUCIONAL");

  const empty = JSON.parse(fixture("csj-jurisprudencia-data-empty.json"));
  assert.equal(parseJurisprudenciaRows(empty).length, 0);
});

test("jurisprudencia payload includes filters on getdata", () => {
  const body = buildBusquedaPayload({
    token: "token123",
    texto: "amparo",
    anio: 2024,
    sala: "SALA PENAL",
    materia: "Penal",
    tipoResolucion: "Acuerdo y Sentencia",
    preopinante: "Ministro X",
    accionResuelta: "Confirmada",
    instancia: "Primera",
    tribunalOrigen: "Juzgado",
    normasReferencia: "Ley 1234",
  });
  assert.equal(body.get("Anno"), "2024");
  assert.equal(body.get("Salas"), "SALA PENAL");
  assert.equal(body.get("PalabrasTexto"), "amparo");
  assert.equal(body.get("__RequestVerificationToken"), "token123");
});

test("digesto category href matcher accepts category-like urls", () => {
  const $ = cheerio.load(`
    <html>
      <body>
        <a href="/16-educacion-y-cultura/305/166-cultura">Educacion y Cultura</a>
        <a href="/1-administrativa/1/">Administrativa</a>
      </body>
    </html>
  `);
  const categorias = extraerDigestoCategorias($);
  assert.equal(categorias.length, 2);
});
