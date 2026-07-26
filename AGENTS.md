# AGENTS.md — Reglas del Design System (`apps/web`)

> Rulebook corto y práctico para agentes y devs que tocan UI en `apps/web`. Basado en
> [`docs/design-system-audit.md`](./docs/design-system-audit.md) (§7, §9) y
> [`docs/design-system-migration-plan.md`](./docs/design-system-migration-plan.md) (tarea 0-T4).
> Si algo no está aquí, esos dos documentos son la fuente de verdad — no inventes reglas nuevas.

---

## 1. Decisión de librería de UI

**shadcn/ui** (no HeroUI). Se evaluó migrar a HeroUI y se **descartó** (Audit §8): la versión
vigente (v3) exige Tailwind v4 + reescritura de los 176 consumidores de `asChild`/Radix, y
ningún bloqueante real del DS se resolvía cambiando de librería.

El objetivo del equipo — un diseño propio más moderno — se logra **sin** cambiar de librería,
porque el *look* lo dirigen **tokens + variantes `cva`**. En esta arquitectura:

> **Reestilizar = editar tokens y variantes `cva`, no reescribir features.**

No propongas ni implementes una migración de librería de componentes sin que sea pedida
explícitamente; el camino aprobado es consolidación + reskin por tokens.

---

## 2. Arquitectura de tokens en 3 capas

```
Capa 1 · Referencia (paleta cruda)     --brand-500, --neutral-900, --emerald-600 …
   │                                    (la "marca": editar aquí cambia todo el producto)
   ▼
Capa 2 · Semántica (rol de uso)         --primary, --surface, --muted, --destructive,
   │                                    --success, --warning, --info, --level-* → var(capa 1)
   ▼
Capa 3 · Consumo (Tailwind + cva)       bg-primary, text-muted-foreground, rounded-lg,
                                        shadow-md → hsl(var(--token)) en tailwind.config.ts
```

**Reglas invariantes** (las hará cumplir ESLint):

- `components/ui/` usa **solo tokens semánticos** (capa 2/3). Nunca hex, nunca clases de
  escala Tailwind (`bg-blue-500`, `text-emerald-700`…), nunca la capa de referencia directa.
- `components/shared/` importa **solo** `ui/` + `lib/`.
- Una **feature nunca importa de otra feature**.
- Los 4 niveles de logro (insuficiente/elemental/adecuado/avanzado) tienen su propio token
  semántico `--level-*` (insufficient/elementary/adequate/advanced) — no se re-implementan
  con escalas de color sueltas.

---

## 3. Capas de componente — dónde va cada cosa

| Capa | Ubicación | Qué contiene |
|---|---|---|
| **Primitivas** | `components/ui/` | Componentes puros, variantes vía `cva`. Solo tokens semánticos. |
| **Shared** | `components/shared/` | Compuestos reutilizables con lógica, construidos sobre primitivas. |
| **Layout** | `components/layout/` | Shell/navegación (sidebar, topbar, nav). |
| **Feature** | `app/(group)/<ruta>/components/` | Componentes de dominio, colocados junto a su ruta (decisión D2). No se usa `src/features/`. |

Las carpetas de dominio hoy sueltas en `components/` global (`official-reports`, `import`,
`ai-models`, `instrument-bands`, `question-detail`, `assistant`, `passage-dialog.tsx`,
`feature-gate.tsx`) están **siendo reubicadas** a `app/(group)/<ruta>/components/`. Código de
dominio **nuevo** va directo ahí, no a `components/` global.

---

## 4. Prohibiciones (enforcement ESLint)

- **Nada de `style={}`** — excepción única: valores dinámicos data-driven en charts
  (dimensión/color calculado desde datos), y siempre con un comentario que lo justifique.
- **Nada de colores hex/rgb/hsl hardcodeados** en `className` o `style`.
- **Nada de clases de color de escala** (`bg-`/`text-`/`border-`/`ring-<familia>-<shade>`,
  ej. `bg-emerald-100`, `text-red-500`) en código de producto. Usar tokens semánticos
  (`bg-success`, `text-destructive`) o variantes de `Badge` (incl. `level-*`).

Estas reglas hoy corren como **warning** (Fase 0) y pasarán a **error** al cerrar la migración
por feature (Fase 3/4). No agregues código nuevo que las viole aunque hoy sea solo warning.

---

## 5. Cómo agregar una variante nueva

1. Extiende la config `cva` de la primitiva correspondiente en `components/ui/*.tsx`.
2. Usa tokens semánticos existentes (o pide que se agregue el token semántico si falta).
3. Verifica el resultado en `/styleguide`.

**Nunca** agregues estilos sueltos "one-off" en el call-site (la feature) para lograr un look
puntual — si la primitiva no soporta el caso, la variante se agrega a la primitiva.

---

## 6. Flujo "buscar antes de crear"

Antes de construir un `button`, `card`, `dialog`, `badge`, `filter` o `stat-card` nuevo:

1. Busca en `components/ui/` — ¿existe la primitiva?
2. Busca en `components/shared/` — ¿existe el compuesto?
3. Solo si no existe ninguno de los dos, créalo — y en la capa correcta (§3).

---

## 7. Cómo reestilizar / cambiar la marca

- Editar los tokens de **referencia** y **semánticos** en `apps/web/src/app/globals.css`.
- Editar las **variantes `cva`** en `components/ui/*`.
- **No tocar features** para un cambio de marca o de look — si hace falta tocar una feature,
  es señal de que le falta migrar a tokens/primitivas (Fase 3).

---

## 8. Enlaces

- [`/styleguide`](apps/web/src/app/styleguide) — referencia visual viva del DS (`apps/web/src/app/styleguide`).
- [`docs/design-system-audit.md`](./docs/design-system-audit.md) — estado actual, hallazgos, decisiones (§9).
- [`docs/design-system-migration-plan.md`](./docs/design-system-migration-plan.md) — plan de fases y tareas.

---

## 9. Reglas Granulares de Frontend (`apps/web`)

Este archivo fija la arquitectura de tokens y capas. La referencia concreta de componentes, los
arquetipos de vista y el manejo de roles/permisos en UI viven en archivos aparte — se cargan
siempre junto con este:

@.claude/rules/frontend/01-error-notifications.md
@.claude/rules/frontend/02-ui-conventions.md
@.claude/rules/frontend/03-process-archetypes.md
@.claude/rules/frontend/04-roles-and-permissions.md
@.claude/rules/frontend/05-performance.md
@.claude/rules/frontend/06-client-data-fetching.md
@.claude/rules/frontend/07-navigation-reactivity.md
