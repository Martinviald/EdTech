"""Los perfiles de recorte de Python son los mismos que declara @soe/types.

`contracts/crop-profiles.json` lo escribe `pnpm --filter @soe/types gen:omr-contracts`
desde `CROP_PROFILES` (packages/types/src/schemas/answer-reading/crop.schema.ts).
"""

from __future__ import annotations

import json

from app.contracts import CONTRACTS_DIR
from app.crop import CROP_PROFILES


def test_python_crop_profiles_match_the_generated_contract() -> None:
    generated = json.loads((CONTRACTS_DIR / "crop-profiles.json").read_text())

    assert {key: profile.to_contract() for key, profile in CROP_PROFILES.items()} == generated


def test_profile_keys_are_id_at_version() -> None:
    for key, profile in CROP_PROFILES.items():
        assert key == f"{profile.id}@{profile.version}"
