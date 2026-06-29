# mcp-legal-py

Hub MCP unificado para abogados y profesionales del derecho paraguayos. Un solo conector que da acceso a las principales fuentes jurídicas oficiales de Paraguay. 100% local, código abierto y auditable.

Inspirado en [`mcp-legal-ar`](https://github.com/Probanza-ar/mcp-legal-ar), el hub equivalente para Argentina.

---

## ¿Qué es esto y para qué sirve?

Claude Desktop puede conectarse a fuentes de información externas a través de conectores MCP. Este repositorio instala un único conector que le da acceso a Claude a varias fuentes jurídicas paraguayas al mismo tiempo:

- **Gaceta Oficial** — boletín oficial de la República del Paraguay (leyes, decretos, despachos y avisos).
- **Leyes Paraguayas (BACN)** — base de leyes nacionales de la Biblioteca y Archivo del Congreso Nacional, con buscador por palabra clave.
- **Legislación CSJ** — convenio CSJ-Presidencia: leyes y decretos desde 1869, con análisis de vigencia y modificaciones.
- **Jurisprudencia CSJ** — Sistema de Información de la Jurisprudencia de la Corte Suprema de Justicia: fallos de las Salas desde 1995, sumarizados e indizados por el IIJ.
- **Digesto Legislativo** — legislación nacional organizada por categoría temática (Administrativa, Civil, Comercial, Tributaria, Penal, etc.), con ficha y archivo descargable por norma.

Sin este hub, cada fuente requeriría investigar y armar un scraper por separado. Con este hub, todas quedan disponibles bajo un solo conector.

---

## ⚠️ Estado real de cada fuente (leer antes de usar)

A diferencia de `mcp-legal-ar` —que empaqueta conectores de terceros ya probados en producción—, este repo escribe **todos los conectores desde cero**, porque todavía no existe un ecosistema de conectores MCP individuales para fuentes paraguayas. Algunas de estas fuentes son sitios .NET con búsqueda disparada por JavaScript que no se pudieron inspeccionar en detalle durante la construcción de este hub (sin acceso a un navegador con DevTools en ese momento). Por eso cada herramienta está marcada con su estado real:

| Fuente | Herramienta | Estado |
|---|---|---|
| Digesto Legislativo | `digesto__listar_categorias` | ✅ Confirmado contra el sitio en vivo |
| Digesto Legislativo | `digesto__obtener_norma` | ✅ Confirmado contra el sitio en vivo |
| Digesto Legislativo | `digesto__buscar` | 🚧 Borrador — el listado por categoría y el buscador cargan vía AJAX |
| Leyes Paraguayas (BACN) | `leyes__buscar` / `leyes__obtener_ley` | 🟡 Patrón de URL confirmado por resultados de búsqueda reales, HTML exacto sin verificar (el sitio bloquea fetchers automáticos) |
| Gaceta Oficial | `gaceta__listar_recientes` / `gaceta__buscar` | 🚧 Borrador — el sitio rechaza accesos automatizados (robots.txt), parámetros de búsqueda sin confirmar |
| Legislación CSJ | `csjleyes__listar_filtros` | ✅ Confirmado (lista de filtros) |
| Legislación CSJ | `csjleyes__buscar` | 🚧 Borrador — búsqueda disparada por JS, endpoint no identificado |
| Jurisprudencia CSJ | `jurisprudencia__listar_filtros` | ✅ Confirmado (lista de filtros) |
| Jurisprudencia CSJ | `jurisprudencia__buscar` | 🚧 Borrador — búsqueda disparada por JS, endpoint no identificado |

Las herramientas marcadas 🚧 no inventan resultados: si no pueden confirmar el endpoint real, devuelven un mensaje explicando exactamente qué falta y cómo completarlo (en general: abrir el sitio, hacer una búsqueda real con la pestaña *Network* del navegador abierta, y compartir esa petición para terminar de cablear el parseo).

**Si tenés Claude Code o Claude en Chrome con un navegador conectado**, pedile que abra cada sitio en borrador, haga una búsqueda de prueba, y te traiga la URL/payload real — con eso, completar cada conector es un cambio chico en su archivo correspondiente dentro de `src/connectors/`.

---

## Arquitectura

`mcp-legal-py` es un único servidor MCP (no un proxy de procesos hijos como `mcp-legal-ar`). Cada fuente es un módulo independiente dentro de `src/connectors/` que registra sus propias herramientas (`gaceta__*`, `leyes__*`, `csjleyes__*`, `jurisprudencia__*`, `digesto__*`) sobre el mismo servidor:

```
Claude Desktop
     └── mcp-legal-py (servidor MCP único, stdio)
           ├── src/connectors/gaceta-oficial.js        → gaceta__*
           ├── src/connectors/leyes-bacn.js             → leyes__*
           ├── src/connectors/csj-legislacion.js        → csjleyes__*
           ├── src/connectors/csj-jurisprudencia.js     → jurisprudencia__*
           └── src/connectors/digesto-legislativo.js    → digesto__*
```

¿Por qué un solo proceso y no un proxy con hijos? Porque `mcp-legal-ar` unifica conectores de terceros ya existentes (escritos por Voftec y otros), y por eso tiene sentido levantarlos como procesos hijos sin tocarles el código. Acá no hay conectores paraguayos preexistentes que envolver: todo se escribe en este mismo repo, así que un solo proceso con módulos bien separados es más simple de mantener y depurar. Si en el futuro aparecen conectores MCP paraguayos de terceros para sumar sin reescribir, ahí tiene sentido migrar al patrón de proxy.

---

## Seguridad y privacidad

- **Transporte local (stdio).** El hub se comunica con Claude Desktop directamente en tu máquina. Las consultas a los sitios oficiales salen desde tu propia conexión, no a través de ningún servidor intermediario.
- **Solo lectura.** Ningún conector escribe, envía formularios de contacto, ni actúa sobre ningún sistema; solo lee información pública.
- **Auditable.** Todo el código está en este repo. Cada conector es un archivo corto y legible en `src/connectors/`.
- **User-Agent de navegador.** Algunos sitios oficiales rechazan el user-agent por defecto de herramientas automatizadas; los conectores usan un user-agent de navegador real para evitar bloqueos triviales. No se implementa bypass de CAPTCHA ni evasión de ningún tipo de protección antibots.

---

## Requisitos

1. **Claude Desktop** — [claude.ai/download](https://claude.ai/download)
2. **Node.js** ≥ 18 — [nodejs.org](https://nodejs.org) (versión LTS)

Verificar Node.js instalado:

```
node --version
```

---

## Instalación

### Opción automática

**Mac / Linux:**

```
bash setup.sh
```

**Windows:** clic derecho en `setup.ps1` → **"Ejecutar con PowerShell"**

El script instala las dependencias y configura `claude_desktop_config.json` automáticamente.

### Manual

```
npm install
```

Agregar dentro de `"mcpServers"` en el archivo de configuración de Claude Desktop:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-legal-py": {
      "command": "node",
      "args": ["/ruta/completa/a/mcp-legal-py/src/index.js"]
    }
  }
}
```

Reiniciar Claude Desktop por completo (salir desde la bandeja del sistema, no solo cerrar la ventana).

---

## Probar sin Claude Desktop

```
npm run inspect
```

Esto levanta el [MCP Inspector](https://github.com/modelcontextprotocol/inspector) para probar cada herramienta a mano antes de conectarlo a Claude Desktop.

---

## Solución de problemas

**El conector no aparece en Claude Desktop**
Verificar que la ruta en `args` sea absoluta y exista, y que el JSON de configuración sea válido (sin comas de más). Reiniciar Claude Desktop desde la bandeja del sistema.

**Una herramienta devuelve "no disponible todavía" o "borrador"**
Es esperado para las fuentes marcadas 🚧 en la tabla de arriba — ver la sección "Estado real de cada fuente".

**Una fuente está caída**
El resto de las fuentes sigue funcionando normalmente; son módulos independientes.

---

## Cómo contribuir / terminar un conector en borrador

1. Abrí la fuente en el navegador y hacé una búsqueda real con la pestaña **Network/Red** de las DevTools abierta.
2. Identificá la petición que trae los resultados (URL, método, parámetros o payload, y si la respuesta es HTML o JSON).
3. Editá el archivo correspondiente en `src/connectors/` reemplazando el bloque marcado `🚧 BORRADOR` con la lógica real.
4. Probá con `npm run inspect` antes de conectarlo a Claude Desktop.

## Contrato interno

Para mantener el hub fácil de ampliar, los conectores siguen estas reglas:

- Las herramientas devuelven JSON textual con una forma consistente.
- Los helpers compartidos viven en `src/lib/`.
- Las respuestas reales de los sitios que valga la pena conservar se pueden guardar como fixtures en `test/fixtures/`.
- Si una fuente cambia mucho, conviene fijar primero el endpoint y después el parseo.

---

## Licencia

MIT. Todo el código de este repositorio es original; no reutiliza código de terceros (a diferencia de `mcp-legal-ar`, que sí empaqueta conectores existentes de la comunidad argentina).

## Créditos

Arquitectura inspirada en [`mcp-legal-ar`](https://github.com/Probanza-ar/mcp-legal-ar) de [@abogadoaboitiz](https://x.com/abogadoaboitiz). Las fuentes de datos pertenecen a sus organismos oficiales: Poder Judicial / Corte Suprema de Justicia del Paraguay, Biblioteca y Archivo del Congreso Nacional, Honorable Cámara de Senadores, y la Gaceta Oficial de la República del Paraguay.
