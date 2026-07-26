# No Comments

## Do not add comments to the code

Code must be self-documenting through clear names and small functions. Do **not** add explanatory comments — not block comments, not inline `//` comments, not JSDoc descriptions, not "section header" comments.

This applies to all code you write or modify: source files, tests, and scripts.

```typescript
// Wrong — explanatory comment
// DV incorrecto para ese cuerpo del RUT, se descarta la fila
const rut = normalizeRut(rutRaw);
if (!rut) return null;

// Correct — the name carries the meaning
const rut = normalizeRut(rutRaw);
if (!rut) return null;
```

If a piece of logic needs a comment to be understood, rename the variables/functions or extract a well-named helper instead.

## Narrow exceptions

Only these are allowed, and only when actually required:

- Tooling directives that must be comments: `// eslint-disable-*`, `// @ts-expect-error`, `/* eslint-disable */`.
- Test case descriptions inside `describe`/`it` strings (these are not comments).

Do not leave commented-out code. Delete dead code instead.
