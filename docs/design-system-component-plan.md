# Plan de componentes y sustratos — Design System AcademOS (`apps/web`)

> **Extiende** [`design-system-migration-plan.md`](./design-system-migration-plan.md), no lo
> reemplaza. Aquel define la *arquitectura de tokens* (3 capas) y el reskin de lo existente; este
> define **cómo se construyen los 25 componentes del inventario sin repetir código**.
>
> **Decisiones que lo enmarcan (2026-07-15):**
> - **D5 · Arquetipos:** los 5 arquetipos de vista documentados en
>   `.claude/rules/frontend/03-process-archetypes.md` (lista/tabla, dashboard, hub con tabs,
>   wizard, settings) **se mantienen como están**. Se iteran a medida que el diseño mejore; no se
>   rediseñan ni se codifican como plantillas en este plan.
> - **D6 · Referencias:** son **capturas de inspiración, no especificación**. No se adopta el
>   styleguide de origen. Se extrae de ellas el lenguaje visual y se adapta **nuestro**
>   `/styleguide`. Iteración visual, no port.
> - **D7 · `ItemCard`/`ItemCardGroup` son genéricos** (card de entidad en una lista: evaluaciones,
>   alumnos, cursos, informes). **No** son la pregunta de evaluación del dominio (`items` /
>   `/banco-items`). Viven en el DS, sin conocimiento de dominio.
> - **D8 · AI Chat:** los 6 componentes se construyen como **primitivas presentacionales** del DS y
>   `components/assistant/` se **refactoriza para consumirlas**. Una sola implementación de chat.

---

## 1. Punto de partida (verificado contra el código, no supuesto)

**Ya está hecho** (Fase 0 del plan base, más de lo que el plan sugiere):

| Pieza | Estado |
|---|---|
| Capa 1 · referencia | ✅ `--brand-50…950` (indigo 239–243°), `--neutral-0…950`, `--red/emerald/amber/sky-*` |
| Capa 2 · semántica | ✅ `--primary`, `--muted`, `--destructive`, `--success`, `--warning`, `--info` → capa 1 |
| Niveles DIA | ✅ `--level-insufficient/elementary/adequate/advanced` con contraste AA documentado |
| Escala tipográfica | ✅ `display/heading/title/body/caption` + `2xs` en `tailwind.config.ts` |
| `AGENTS.md` (0-T4) | ✅ existe |

**Falta — y es exactamente lo que estos componentes necesitan** (la mitad pendiente de 0-T3):

| Familia | Estado | Sin esto no se puede construir |
|---|---|---|
| `--radius-sm/md/lg/xl/full` | ❌ hay **un solo** `--radius: 0.5rem` | Surface → Card, ItemCard, KPI, Dropzone, ChatMessage |
| `--shadow-xs/sm/md/lg` | ❌ cero | Surface, Floating → HoverCard, Popover |
| `--duration-*` / `--ease-*` | ❌ cero | ChatLoader, Tile (hover/selected), overlays |
| `--z-dropdown/sticky/modal/popover/toast` | ❌ cero | HoverCard, Popover, Tabs sticky |

**Inventario · 9 de 25 ya existen:**

`Sidebar` (`layout/Sidebar.tsx`) · `Navbar` (se llama **`Topbar`**) · `PageHeader` · `Card` ·
`Table` · `Button` · `EmptyState` · `Stepper` (`patterns/`) · `AppLayout`
(`app/(dashboard)/layout.tsx`).

`KPI` existe **tres veces y ninguna bien**: `patterns/MetricComparison`,
`resultados/components/summary-card.tsx` y una tercera implementación (Audit §2.6). El componente
`KPI` de este plan **es** su consolidación, no un cuarto.

**Bloqueo estructural — faltan las primitivas base, no solo los compuestos:**

No existen en `ui/` ni están sus paquetes de Radix instalados: **`tabs`, `checkbox`,
`radio-group`, `hover-card`, `popover`, `separator`**. `CheckboxButtonGroup` y `RadioButtonGroup`
no son "un compuesto sobre algo que ya está": hay que instalar la base primero. `react-dropzone`
**sí** está instalado — Dropzone parte con ventaja.

---

## 2. La idea central: **5 sustratos**, no 25 componentes

Los 16 componentes que faltan no son 16 problemas. Son **5 sustratos** y sus composiciones. Esta
tabla es el corazón del plan — si un componente no cae en un sustrato, es señal de que falta uno o
de que el componente no pertenece al DS.

| Sustrato | Qué resuelve | Componentes que lo consumen |
|---|---|---|
| **Surface** | Caja: radio + borde + elevación + padding + estado (hover/selected/disabled) | Card, **ItemCard**, **HoverCard**, **KPI**, EmptyState, **ChatMessage**, **Dropzone**, **PromptInput**, **ChainOfThought** |
| **Collection** | Colección: dirección, gap, columnas responsive, estado vacío | **ItemCardGroup**, **KPIGroup**, **List**, **ChatConversation**, **CheckboxButtonGroup**, **RadioButtonGroup** |
| **Tile** | Surface *seleccionable*: semántica de selección + foco + a11y | **ItemCard** (interactivo), ítems de **Checkbox/RadioButtonGroup**, **PromptSuggestion** |
| **Sequence** | Nodos + conectores, con estado por nodo (pendiente/actual/hecho) | Stepper (migra), **Timeline**, **ChainOfThought** |
| **Floating** | Portal Radix + elevación + z-index + animación | **HoverCard**, **Popover**, Tooltip, DropdownMenu, Dialog, Sheet |

**Los 4 tokens que faltan son los inputs de los sustratos.** Surface no se puede definir sin
`--radius-*` y `--shadow-*`; Floating no sin `--z-*`; Tile y ChatLoader no sin `--duration-*`. Por
eso la Fase A va primero: no es burocracia, es la dependencia real.

### Hallazgos de la descomposición

Tres cosas que la tabla deja ver y que conviene decir explícitas:

1. **`CheckboxButtonGroup` y `RadioButtonGroup` son el mismo componente.** Idéntico Collection +
   idéntico Tile; solo cambian la semántica de selección (múltiple vs única) y el primitivo Radix
   que los maneja. Se construyen juntos, compartiendo el Tile, o serán dos copias del mismo CSS.

2. **`Stepper` y `Timeline` también.** Ambos son nodos + conectores + estado por nodo; cambian
   orientación y semántica. `ChainOfThought` es el mismo Sequence con un Collapsible encima. Hoy
   `patterns/Stepper.tsx` ya existe y resuelve la mitad — Timeline no se escribe de cero, se
   extrae de ahí.

3. **La "anatomía" (media/título/descripción/meta/acciones) se repite** en PageHeader, EmptyState,
   ItemCard, KPI, ChatMessage y filas de List. **No es un componente** — convertirla en uno produce
   un god-component con 12 props opcionales. Es una **convención de contrato de props**, se
   documenta en `AGENTS.md` y se respeta; no se abstrae.

Los 5 sustratos pasan el listón de extracción del plan base (**≥3 consumidores**): Surface 9,
Collection 6, Tile 3, Sequence 3, Floating 6. Ninguno es especulativo.

---

## 3. Secuencia

### Fase A · Cerrar 0-T3 desde las capturas · **M** — 🔒 *bloquea todo lo demás*

- **Qué:** extraer de las capturas de referencia el lenguaje que aún no está tokenizado y
  definirlo en `globals.css` + `tailwind.config.ts`: **`--radius-*`**, **`--shadow-*`**,
  **`--duration-*`/`--ease-*`**, **`--z-*`**. Color y tipografía **ya están** — solo se tocan si
  las capturas lo piden explícitamente.
- **Cómo:** iterar en `/styleguide`, que está aislado. Cada ronda = ver, ajustar, comparar contra
  la captura. No se propaga a features (eso es Fase 3 del plan base).
- **Aceptación:** las 4 familias existen y `/styleguide` muestra sus escalas · el look nuevo es
  visible **sin** tocar ninguna feature · contraste AA se mantiene · `pnpm build` verde.
- **Riesgo:** decisión estética. **Mitigación:** el PR es solo tokens, reversible.

### Fase B · Primitivas base faltantes · **M**

- **B-T0 · Adelantar `2-T1` del plan base (renombrar `patterns/` → `shared/`) — hacer *antes* de
  agregar componentes.** Estamos por sumar 16 archivos: renombrar primero es un `git mv` de 8
  archivos; renombrar después son 24. Es la misma tarea, hecha en el orden barato.
- **B-T1 · Instalar y tokenizar las 6 primitivas ausentes:** `tabs`, `checkbox`, `radio-group`,
  `hover-card`, `popover`, `separator` (+ sus paquetes `@radix-ui/react-*`). Con tokens de Fase A
  desde el día uno — nunca escalas ni hex (AGENTS.md).
- **Aceptación:** `rg "@/components/patterns" apps/web/src` → 0 · las 6 primitivas en
  `/styleguide` · `pnpm typecheck` verde.

### Fase C · Los 5 sustratos · **M/L**

Surface · Collection · Tile · Sequence · Floating. Cada uno con sus variantes `cva` y su sección
en `/styleguide`. `Floating` en parte ya lo cubre `1-T4` del plan base (reskin de overlays); aquí
solo se le suman `hover-card` y `popover`.

- **Aceptación:** cada sustrato en `/styleguide` con todas sus variantes · `card.tsx` reescrito
  sobre `Surface` sin romper sus 75 consumidores.

### Fase D · Los 16 componentes, agrupados **por sustrato** (no por bloque temático) · **L**

Cada grupo es un PR. El orden va de menor a mayor riesgo:

| PR | Sustrato | Componentes |
|---|---|---|
| D1 | Surface | `ItemCard`, `KPI` (**consolidando las 3 implementaciones**), `HoverCard` |
| D2 | Collection | `ItemCardGroup`, `KPIGroup`, `List` |
| D3 | Tile | `RadioButtonGroup` + `CheckboxButtonGroup` (juntos, comparten Tile), `PromptSuggestion` |
| D4 | Sequence | `Timeline` + migrar `Stepper` al sustrato |
| D5 | Forms | `Dropzone` (sobre `react-dropzone`, ya instalado) |
| D6 | Layout | `Segment`/`Tabs` |
| D7 | AI Chat | `ChatMessage`, `ChatConversation`, `ChatLoader`, `PromptInput`, `ChainOfThought` |

- **Aceptación por PR:** cada componente en `/styleguide` · **≥1 consumidor real migrado** (un
  componente sin consumidor es especulación) · `rg` de color de escala en el archivo → 0 ·
  `pnpm typecheck` verde.

### Fase E · Migrar `assistant/` a las primitivas de chat (D8) · **L**

`components/assistant/` (12 archivos) se refactoriza para consumir D7. **Debe preservar:**
streaming SSE (`stream.ts` + las 3 rutas de `app/api/assistant/*`), historial, `context-picker` y
`context-tray`. Las primitivas son **presentacionales**; el estado y el streaming se quedan en
`assistant/`.

- **Aceptación:** el asistente funciona igual (smoke: abrir panel, preguntar, ver stream, historial)
  · no queda CSS de chat duplicado entre `assistant/` y `shared/`.

---

## 4. Qué **no** entra

- **Rediseñar los arquetipos** (D5): se mantienen los 5 actuales.
- **Codificar los arquetipos como plantillas**: hoy son prosa en
  `.claude/rules/frontend/03-process-archetypes.md` y así se quedan.
- **Migración de features a tokens**: es la Fase 3 del plan base, corre aparte.
- **Adoptar el styleguide de las referencias** (D6): solo inspiración.
- **Un componente sin consumidor real.** Si nada lo usa, no se construye todavía.

---

## 5. Bloqueo actual

**Fase A necesita las capturas.** Es la única dependencia dura: define las 4 familias de tokens de
las que cuelgan los 5 sustratos y, a través de ellos, los 16 componentes.

Sugerencia: dejarlas en `docs/design-refs/` con nombre por componente
(`item-card.png`, `chat-message.png`, …), para poder iterar una por una contra `/styleguide`.
