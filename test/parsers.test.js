import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

import { extraerGacetasRecientes, extraerResultadosContenido, extraerEnlacesSiguiente } from "../src/connectors/gaceta-oficial.js";
import { extraerCategorias as extraerDigestoCategorias, extraerResultadosBusqueda as extraerDigestoResultados } from "../src/connectors/digesto-legislativo.js";
import { extraerResultados as extraerCsjResultados } from "../src/connectors/csj-legislacion.js";
import { parseJurisprudenciaRows } from "../src/connectors/csj-jurisprudencia.js";
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
      </body>
    </html>
  `);
  const categorias = extraerDigestoCategorias($);
  assert.equal(categorias.length, 2);
  assert.equal(categorias[0].nombre, "Educacion y Cultura");
  assert.equal(categorias[1].nombre, "Administrativa");
});

test("csj legislacion search fixture", () => {
  const $ = cheerio.load(fixture("csj-legislacion-search.html"));
  const resultados = extraerCsjResultados($, 10);
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].titulo, "Ley 5134 /2013");
  assert.equal(resultados[0].institucion, "Ministerio de Hacienda");

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
