"""Carga y valida los contratos JSON Schema generados desde @soe/types.

Los archivos de services/omr/contracts/*.schema.json son GENERADOS
(pnpm --filter @soe/types gen:omr-contracts). Nunca se editan a mano: el origen
de verdad son los schemas Zod de packages/types. Este modulo es el unico punto
de validacion de entrada/salida del servicio.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "contracts"


@cache
def load_validator(name: str) -> Draft7Validator:
    schema = json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text())
    return Draft7Validator(schema)


def validate(name: str, payload: Any) -> list[str]:
    validator = load_validator(name)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in validator.iter_errors(payload)
    ]
