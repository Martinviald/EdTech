# Collection Complexity — No Accidental O(N²)

> Applies to **files you create or modify**. AcademOS aggregates per-student × per-skill/taxonomy-node data in memory after a single Drizzle query — e.g. `HeatmapService.assembleResponse()` in `apps/api/src/heatmap/heatmap.service.ts` groups `skill_results` rows (one per student × taxonomy node × subject, which scales with every student and every assessment in an org) into a node→subject matrix using `Map`s built in a single pass, never re-querying or re-scanning per cell. `BenchmarkingService` (`apps/api/src/benchmarking/benchmarking.service.ts`) does similar cohort-level aggregation across cohorts of students. These in-memory assembly steps are exactly where an accidental O(N²) creeps in as an org's student/assessment volume grows — get the shape right the first time.

## Never accumulate via spread inside a loop or reduce

Spreading the accumulator re-copies everything already accumulated on **every** iteration — 1+2+…+N copies = O(N²). It reads as clean functional style, which is exactly why it survives review.

```typescript
// Wrong — O(N²): copies the growing bucket array once per line
const byOwner = lines.reduce<Record<string, Line[]>>((acc, line) => {
  acc[line.ownerId] = [...(acc[line.ownerId] ?? []), line];
  return acc;
}, {});

// Wrong — same disease, object form
const byId = items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

// Correct — O(N): mutate the local accumulator, push into buckets
const byOwner: Record<string, Line[]> = {};
for (const line of lines) {
  (byOwner[line.ownerId] ??= []).push(line);
}

// Correct — Map form
const byId = new Map(items.map((item) => [item.id, item]));
```

Mutating an accumulator that is local to the function is not a style violation — it never escapes, and it is the difference between milliseconds and minutes at tenant scale.

## Per-item work must be O(1) amortized on org-scale collections

Any loop over data whose size scales with an org's roster (students, skill_results rows, item responses, taxonomy nodes) must do constant amortized work per item. The classic offenders hiding a linear scan inside the loop:

- `array.find(...)` / `array.filter(...)` / `array.includes(...)` per iteration → build a `Map`/`Set` once, look up per item
- spread-accumulation (above)
- `array.concat`/`[...a, ...b]` chains growing per iteration → `push(...items)` into one array

If the per-item work grows with the collection, stop and restructure before writing more code. A large org's `skill_results` for a single assessment already spans every student × every taxonomy node assessed — a per-item `.find()` there turns a page load into a quadratic scan as the school's roster and assessment history grow.

## Check the sibling implementation first

Before writing a grouping/aggregation over domain collections, grep the feature's siblings for the established idiom — the correct pattern usually already exists next door. `HeatmapService.assembleResponse()` (`apps/api/src/heatmap/heatmap.service.ts`) is the reference idiom in this codebase: single pass over the query rows, `Map.get`/`Map.set` (never `.find()`) to bucket by node/subject, `Array.from(map.values())` only at the end to shape the response. This extends `03-helpers-vs-services.md`'s "reuse before adding — search first" from helpers to idioms: match the established sibling pattern, or fix both if you find a divergent one.

## Smell test

When touching a file, treat any `reduce` whose callback contains `...acc` (or `...(acc[...])`) as a defect and rewrite it — even if it's not the line you came to change. It is a two-minute, output-identical fix at write time and a production incident later.
