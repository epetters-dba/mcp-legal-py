#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { registerGacetaTools } from "./connectors/gaceta-oficial.js";
import { registerLeyesTools } from "./connectors/leyes-bacn.js";
import { registerCsjLegislacionTools } from "./connectors/csj-legislacion.js";
import { registerCsjJurisprudenciaTools } from "./connectors/csj-jurisprudencia.js";
import { registerDigestoTools } from "./connectors/digesto-legislativo.js";

/**
 * mcp-legal-py
 *
 * Hub MCP unificado para abogados paraguayos. A diferencia de mcp-legal-ar
 * (que levanta cada conector como un proceso hijo MCP separado y los
 * "proxea"), este hub registra todos los conectores como módulos dentro de
 * UN solo proceso Node. El resultado para Claude Desktop es el mismo —un
 * único conector con todas las herramientas disponibles— pero con menos
 * piezas movibles, porque acá no estamos empaquetando servidores MCP de
 * terceros ya existentes (no hay un "Voftec paraguayo" todavía): todos los
 * conectores se escriben desde cero en este mismo repo.
 *
 * Si en el futuro aparecen conectores MCP paraguayos independientes y se
 * quiere sumarlos sin reescribirlos, ahí sí tiene sentido pasar al patrón
 * de proxy con procesos hijos, igual que mcp-legal-ar.
 */

const server = new McpServer({
  name: "mcp-legal-py",
  version: "0.1.0",
});

const ctx = { z };

registerGacetaTools(server, ctx); // Gaceta Oficial            (≈ BORA)
registerLeyesTools(server, ctx); // BACN - Leyes Paraguayas    (≈ InfoLEG)
registerCsjLegislacionTools(server, ctx); // CSJ - Legislación (≈ InfoLEG histórico)
registerCsjJurisprudenciaTools(server, ctx); // CSJ - Jurisprudencia (≈ JUBA/SAIJ/SCBA)
registerDigestoTools(server, ctx); // Digesto Legislativo      (≈ Normativa PBA)

const transport = new StdioServerTransport();
await server.connect(transport);

// No imprimir nada a stdout: ese canal es exclusivamente para el protocolo
// MCP. Cualquier log de diagnóstico debe ir a stderr.
console.error("[mcp-legal-py] servidor MCP corriendo por stdio");
