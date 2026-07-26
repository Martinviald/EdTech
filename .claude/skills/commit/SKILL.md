---
name: commit
description: Crea commits atómicos en formato conventional commit, en español
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(pnpm typecheck:*), Bash(pnpm lint:*)
---

# Commit

## Flujo

1. **Verificar la rama**: `git branch --show-current`.
   Si es `main` o `dev`, detente y pide cambiar de rama. Nunca commitear directo ahí.

2. **Pre-checks** (CLAUDE.md §10.1):
   ```bash
   pnpm typecheck
   pnpm lint
   ```
   Si alguno falla, detente y reporta. No commitear con errores.

3. **Revisar el estado**: `git status` y `git diff` (+ `git diff --staged`).
   Si no hay nada staged, agrega los archivos modificados y nuevos que correspondan al cambio.

4. **Dividir en commits lógicos** si el diff mezcla cosas distintas (ver abajo).

5. **Commitear** en orden sensato: tooling → tipos → refactors → fixes → features → docs.

## Formato

```
<tipo>(<alcance opcional>): <descripción en español, imperativo, ≤72 chars>

[cuerpo opcional: el porqué, no el qué]
```

Sin trailers. **No** agregar `Signed-off-by` ni `Co-Authored-By: Claude` — este repo no los usa.

### Tipos

| Tipo | Uso |
| --- | --- |
| `feat` | Funcionalidad nueva |
| `fix` | Corrección de bug |
| `refactor` | Cambio interno sin alterar comportamiento |
| `perf` | Mejora de rendimiento |
| `test` | Tests |
| `docs` | Documentación |
| `style` | Formato, sin cambio de lógica |
| `chore` | Build, config, tooling |
| `ci` | Pipelines y despliegue |

El alcance es opcional y suele ser el dominio o módulo: `feat(remedial):`, `fix(ci):`, `chore(docs,db):`.

### Ejemplos reales del repo

```
feat: tooltips modernos en gráficos + Figura 1 con bandas de nivel
fix: mostrar alternativas en la versión estudiante del material remedial
feat(spec-table): tabla de especificaciones en el backoffice de instrumentos
refactor(question-detail): extraer shell y sección de nodos compartidos
fix(ci): pnpm/action-setup sin version pin en deploy-backend (migrate job)
```

## Cuándo dividir en varios commits

Divide cuando el diff mezcla:

- **Concerns distintos**: partes no relacionadas del código.
- **Tipos distintos**: una feature junto a un fix o un refactor.
- **Capas distintas**: tooling/config/docs versus código fuente.
- **Dominios distintos**: en cambios grandes, un commit por módulo.

No es un commit por archivo — es un commit por unidad lógica revisable.

## Reglas

- Descripción en español, presente, imperativo ("agregar", no "agregado").
- Nunca `--no-verify`.
- Nunca commitear a `main` ni `dev`.
- Nunca `git add .` a ciegas: revisa qué entra.
