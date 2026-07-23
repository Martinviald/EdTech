---
name: create-pr
description: Crea o actualiza un PR con una descripción concisa y escaneable
user-invocable: true
allowed-tools: Bash(git*), Bash(gh *)
---

# Crear o actualizar Pull Request

## Uso

```
/create-pr           # base dev (por defecto)
/create-pr main      # base main (solo sync dev→main y hotfixes)
```

## Flujo

1. **Commitear lo pendiente**: si hay cambios sin commitear, ejecuta `/commit` primero.

2. **Push**: `git push -u origin HEAD`.
   Si falla, reporta y detente.

3. **Buscar PR existente**:
   ```bash
   gh pr list --head <rama-actual> --base <base> --json number,title,url
   ```

4. **Analizar el cambio**:
   ```bash
   git log <base>..HEAD --oneline
   git diff <base>...HEAD
   ```
   Si no hay diferencias contra la base, pregunta si igual quiere el PR.

5. **Título** (solo al crear; **nunca** cambiarlo al actualizar):
   Mismo formato que los commits — conventional commit en español, 50–72 chars.
   `feat: filtros de asignatura/nivel/año/momento y paginación en el banco de instrumentos`

6. **Descripción**: ver estructura abajo.

7. **Crear o actualizar**:
   ```bash
   gh pr create --base <base> --draft --title "..." --body "..."   # nuevo
   gh pr edit <número> --body "..."                                 # existente (reemplaza el cuerpo completo)
   ```
   Los PR se crean en **draft**; marcarlos "ready for review" es manual.

---

## Estructura de la descripción

En español. Debe ser **escaneable en menos de 30 segundos**.

**Obligatorio — una sola frase de apertura**, sin header, sin bullets: qué habilita el PR y para quién.

> Permite cargar evaluaciones cuyo único origen es el informe oficial DIA en PDF —sin respuestas alumno×pregunta— haciéndolas convivir con el motor de analítica granular sin romperlo.

**Desde ahí, estructura libre** con headers `##` según lo que el cambio necesite. Secciones que funcionan bien en este repo:

- `## Qué hace` — desglose de los cambios cuando la frase de apertura no basta.
- Una sección por subsistema tocado, nombrando archivos y símbolos reales.
- Tablas para mapear cosas a archivos, o para resultados de verificación.
- `## Notas` — pendientes, decisiones, qué quedó fuera.
- Advertencias al inicio si mergear tiene consecuencias (migraciones, despliegue).

**Cierra siempre con** el footer de Claude Code:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Opcionales — el default es omitir

Inclúyelas solo si aportan algo que los bullets no dejan claro:

- **Diagrama mermaid**: solo si un visual comunica en 5 segundos lo que 3+ frases no. Nunca para flujos lineales A→B→C.
- **Uso para developers**: solo si se introdujo una API pública, componente o config nueva.
- **Decisión clave**: solo si hubo un tradeoff no obvio. Tabla `Decisión | Por qué | Alternativa`, máximo 2 filas.

---

## Reglas duras

**NO:**
- Bullets vagos: "mejoras de refactoring", "varios fixes". Nombra las cosas reales.
- Secciones "Old vs New", "Archivos tocados", QA o rollout.
- Cambiar el título de un PR existente.
- Escribir "N/A" o dejar secciones vacías — se omiten.

**SÍ:**
- Nombrar cosas concretas: rutas de endpoint, componentes, hooks, campos de modelo, archivos.
- Al actualizar, reemplazar el cuerpo completo.
- Ante la duda con una sección opcional, omitirla.
