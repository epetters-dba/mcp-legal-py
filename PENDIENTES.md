# Pendientes

## Prioridad alta

- Confirmar en navegador real los endpoints de búsqueda de `gaceta__buscar`, `csjleyes__buscar` y `jurisprudencia__buscar`.
- Confirmar con navegador normal el HTML real de BACN para `leyes__buscar` y `leyes__obtener_ley`.
- Verificar si `digesto__buscar` necesita ajustar el endpoint AJAX para el listado de categorías o el buscador de la home.

## Prioridad media

- Extraer más fixtures reales para casos de paginación, sin resultados y resultados múltiples.
- Separar mejor los filtros de `csjleyes__listar_filtros` y `jurisprudencia__listar_filtros` por categoría real.
- Revisar si conviene normalizar todavía más el contrato de salida entre todas las tools.

## Mejora futura

- Agregar más fuentes paraguayas si son estables y oficiales.
- Mejorar README con ejemplos de uso por tipo de consulta.
- Conectar pruebas de integración contra `npm run inspect` cuando haya endpoints confirmados.
