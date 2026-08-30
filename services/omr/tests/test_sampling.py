"""Robustez del muestreo de fill (B2/T2): una desalineacion residual de +-2px
post-homografia apenas mueve la medida, porque el nucleo interior muestrea el
78% del radio (INNER_RADIUS_RATIO) y deja el contorno impreso afuera."""

from __future__ import annotations

import numpy as np

from app.classify import bubble_fill
from app.rectify import RectifiedPage, rectify
from tests import synthetic as syn

SHIFTS_PX = [(2, 0), (-2, 0), (0, 2), (0, -2), (2, 2), (-2, -2)]


def test_fill_sampling_tolerates_2px_misalignment(
    spec: dict, clean_gray: np.ndarray
) -> None:
    rectified = rectify(syn.to_bgr(clean_gray), spec)
    assert isinstance(rectified, RectifiedPage)
    width, height = rectified.size

    deltas = []
    for field in spec["fields"]:
        for bubble in field["bubbles"]:
            base = bubble_fill(rectified, bubble["center"], bubble["radius"])
            for dx, dy in SHIFTS_PX:
                shifted = {
                    "x": bubble["center"]["x"] + dx / (width - 1),
                    "y": bubble["center"]["y"] + dy / (height - 1),
                }
                deltas.append(abs(bubble_fill(rectified, shifted, bubble["radius"]) - base))

    assert max(deltas) < 0.08
    assert float(np.mean(deltas)) < 0.02


def test_marked_and_blank_stay_on_their_side_under_2px_misalignment(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    rectified = rectify(syn.to_bgr(clean_gray), spec)
    assert isinstance(rectified, RectifiedPage)
    width, height = rectified.size

    for field in spec["fields"]:
        chosen = marks_abcd.get(field["fieldId"])
        for bubble in field["bubbles"]:
            for dx, dy in SHIFTS_PX:
                shifted = {
                    "x": bubble["center"]["x"] + dx / (width - 1),
                    "y": bubble["center"]["y"] + dy / (height - 1),
                }
                fill = bubble_fill(rectified, shifted, bubble["radius"])
                if bubble["value"] == chosen:
                    assert fill > 0.6
                else:
                    assert fill < 0.25
