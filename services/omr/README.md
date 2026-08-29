# omr-service — Servicio de visión del lector de marcas (E22)

Convierte imágenes de hojas de respuesta en un `ScanResult`. **Sin estado, sin
base de datos, sin conocimiento de tenants**: una función pura sobre
`(imagen, LayoutSpec)`. Diseño en `docs/diseno-lector-de-marcas/` (C18–C21);
contrato HTTP en `docs/e22-lector-contracts.md`.

## Contratos

`contracts/*.schema.json` son **generados** desde los Zod de `@soe/types`:

```bash
pnpm --filter @soe/types gen:omr-contracts
```

Nunca editarlos a mano. Los ejemplos de `contracts/examples/` se validan en
ambos lados (pytest acá, jest en `packages/types`).

## Desarrollo local

```bash
cd services/omr
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --port 8090
```

## Docker

```bash
docker build -t omr-service .
docker run --rm -p 8090:8090 omr-service
```

## Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /health` | Liveness |
| `POST /v1/read` | `(LayoutSpec, CaptureProfile, source)` → `ScanResult`. 422 request inválido; 502 imagen no descargable; 504 tiempo límite por página |
