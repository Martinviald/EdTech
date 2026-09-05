"""Registro local de burbujas (app/registration.py): encontrar el anillo antes de medir.

Las hojas sinteticas tienen registro perfecto (los fiduciales son exactos), asi que
para ejercitar el modulo se DESPLAZA la pagina rectificada respecto del spec: el
anillo queda a (dx, dy) de donde el spec lo espera, como en una foto real con lente
o papel curvado. El registro debe recuperar ese (dx, dy), y con el registro puesto el
fill de una marca desplazada tiene que volver a ser el de la marca centrada.
"""

from __future__ import annotations

import time

import cv2
import numpy as np
import pytest

from app import registration as reg
from app.classify import bubble_fill
from app.pipeline import _grid_signature_fraction, process_page
from app.readers import sample_bubble_fills, sample_bubble_fills_at_spec
from app.rectify import RectifiedPage, rectify
from tests import synthetic as syn

SHIFTS = [(3, 0), (-3, 2), (0, -8), (8, 8), (-12, 5), (12, -12), (15, 0), (0, 15)]


@pytest.fixture(scope="module")
def rectified(spec: dict, clean_gray: np.ndarray) -> RectifiedPage:
    page = rectify(syn.to_bgr(clean_gray), spec)
    assert isinstance(page, RectifiedPage)
    return page


def shifted(page: RectifiedPage, dx: int, dy: int) -> RectifiedPage:
    """La misma pagina con la tinta corrida (dx, dy) respecto del marco del spec."""
    matrix = np.float32([[1, 0, dx], [0, 1, dy]])
    moved = cv2.warpAffine(
        page.gray,
        matrix,
        (page.gray.shape[1], page.gray.shape[0]),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=int(np.median(page.gray)),
    )
    return RectifiedPage(moved, page.size, page.fiducials_found, page.touches_border)


def test_search_window_never_reaches_the_neighbouring_bubble(
    spec: dict, rectified: RectifiedPage
) -> None:
    from app.geometry import point_to_px, radius_to_px

    field = spec["fields"][0]
    centers = [point_to_px(b["center"], rectified.size) for b in field["bubbles"]]
    radius_px = radius_to_px(field["bubbles"][0]["radius"], rectified.size)
    spacing = centers[1][0] - centers[0][0]

    window = reg.search_window_px(centers, radius_px)

    assert window <= 0.4 * spacing
    assert window <= 0.9 * radius_px
    assert window >= reg.WINDOW_MIN_PX


@pytest.mark.parametrize("dx,dy", SHIFTS)
def test_register_group_recovers_a_known_shift(
    spec: dict, rectified: RectifiedPage, dx: int, dy: int
) -> None:
    page = shifted(rectified, dx, dy)
    for field in spec["fields"]:
        fixes = reg.register_group(page, field["bubbles"])
        for fix in fixes:
            assert not fix.fallback
            assert abs(fix.dx - dx) <= 1 and abs(fix.dy - dy) <= 1, (field["fieldId"], fix)


def test_marked_and_blank_fills_survive_a_shift_only_with_registration(
    spec: dict, rectified: RectifiedPage, marks_abcd: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = shifted(rectified, 10, -7)
    monkeypatch.setenv(reg.ENV_FLAG, "1")
    for field in spec["fields"]:
        chosen = marks_abcd.get(field["fieldId"])
        at_spec = sample_bubble_fills_at_spec(page, field["bubbles"])
        registered = sample_bubble_fills(page, field["bubbles"])
        for bubble, spec_fill, fill in zip(field["bubbles"], at_spec, registered, strict=True):
            if bubble["value"] == chosen:
                assert fill > 0.6, (field["fieldId"], fill)
                assert spec_fill < fill
            else:
                assert fill < 0.25, (field["fieldId"], fill)


def test_registration_is_neutral_on_a_perfectly_registered_page(
    spec: dict, rectified: RectifiedPage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(reg.ENV_FLAG, "1")
    for field in spec["fields"]:
        fixes = reg.register_group(rectified, field["bubbles"])
        assert all(abs(fix.dx) <= 1 and abs(fix.dy) <= 1 for fix in fixes)
        registered = sample_bubble_fills(rectified, field["bubbles"])
        at_spec = sample_bubble_fills_at_spec(rectified, field["bubbles"])
        assert max(abs(a - b) for a, b in zip(registered, at_spec, strict=True)) < 0.08


def test_register_group_follows_a_gradient_along_the_row(
    spec: dict, rectified: RectifiedPage
) -> None:
    """Lo que queda tras la homografia es un gradiente, no una traslacion (medido: A -13,
    B -10, C -7, D -5 px en una misma fila). Cada burbuja debe quedarse con SU ajuste."""
    from app.geometry import point_to_px

    width, height = rectified.size
    scale = 1.03
    matrix = np.float32([[scale, 0, -6], [0, 1, 3]])
    warped = cv2.warpAffine(
        rectified.gray,
        matrix,
        (width, height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=int(np.median(rectified.gray)),
    )
    page = RectifiedPage(warped, rectified.size, rectified.fiducials_found, False)

    for field in spec["fields"]:
        fixes = reg.register_group(page, field["bubbles"])
        for bubble, fix in zip(field["bubbles"], fixes, strict=True):
            cx, _ = point_to_px(bubble["center"], rectified.size)
            expected_dx = cx * (scale - 1) - 6
            assert not fix.fallback
            assert abs(fix.dx - expected_dx) <= 1.5, (field["fieldId"], bubble["value"], fix)
            assert abs(fix.dy - 3) <= 1


def test_robust_line_ignores_one_outlier_and_caps_wild_slopes() -> None:
    intercept, slope = reg.robust_line([(0, -13), (80, -10), (160, -7), (240, -5)])
    assert abs(slope - 0.034) < 0.01
    assert abs(intercept - (-13)) < 1.0

    intercept, slope = reg.robust_line([(0, -13), (80, -10), (160, 9), (240, -5)])
    assert abs(slope - 0.034) < 0.02
    assert abs(intercept + 13) < 1.5

    assert reg.robust_line([(50, 4)]) == (4, 0.0)
    intercept, slope = reg.robust_line([(0, 0), (2, 5)])
    assert slope == 0.0


def test_rut_grid_is_read_on_a_shifted_page_only_with_registration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La grilla RUT se registra por columna: con la pagina corrida 7 px (mas de un
    tercio de la distancia entre digitos) el RUT sale entero con registro y no sale
    —o sale distinto— sin el. Nunca un RUT con un digito inventado."""
    from app.identity import read_identity

    rut = "12345678K"
    rut_spec = syn.make_layout_spec(fields_per_page=4)
    rut_spec["identity"] = syn.make_rut_identity()
    gray = syn.render_page(
        rut_spec,
        0,
        marks={"f_001": "A", "f_002": "C", "f_003": "B", "f_004": "D"},
        identity_marks=syn.rut_marks(rut),
        rng=np.random.default_rng(15),
    )
    page = rectify(syn.to_bgr(gray), rut_spec)
    assert isinstance(page, RectifiedPage)
    moved = shifted(page, 7, -7)

    monkeypatch.setenv(reg.ENV_FLAG, "1")
    with_registration = read_identity(moved, moved.gray, rut_spec)
    monkeypatch.setenv(reg.ENV_FLAG, "0")
    without_registration = read_identity(moved, moved.gray, rut_spec)

    assert with_registration["raw"] == rut
    assert with_registration["confidence"] > 0.0
    assert without_registration["raw"] in (None, rut)


def test_plain_paper_yields_a_fallback_to_the_spec_position(rectified: RectifiedPage) -> None:
    width, height = rectified.size
    paper = [
        {"value": value, "center": {"x": 0.55 + index * 0.06, "y": 0.5}, "radius": 0.013}
        for index, value in enumerate("ABCD")
    ]
    fixes = reg.register_group(rectified, paper)

    assert all(fix.fallback for fix in fixes)
    assert all(fix.dx == 0 and fix.dy == 0 for fix in fixes)


def test_a_bubble_whose_ring_is_hidden_inherits_the_group_shift(
    spec: dict, rectified: RectifiedPage
) -> None:
    from app.geometry import point_to_px, radius_to_px

    page = shifted(rectified, 6, 4)
    field = spec["fields"][2]
    gray = page.gray.copy()
    cx, cy = point_to_px(field["bubbles"][1]["center"], page.size)
    radius_px = radius_to_px(field["bubbles"][1]["radius"], page.size)
    cv2.circle(gray, (cx + 6, cy + 4), round(radius_px * 1.6), 30, thickness=-1)
    hidden = RectifiedPage(gray, page.size, page.fiducials_found, page.touches_border)

    fixes = reg.register_group(hidden, field["bubbles"])

    assert all(abs(fix.dx - 6) <= 1 and abs(fix.dy - 4) <= 1 for fix in fixes)
    assert fixes[1].source in (reg.SOURCE_GROUP, reg.SOURCE_OWN)


def test_a_bubble_at_the_image_border_does_not_crash(rectified: RectifiedPage) -> None:
    from app.geometry import radius_to_px

    edge = [{"value": "A", "center": {"x": 0.0, "y": 0.0}, "radius": 0.013}]
    [fix] = reg.register_group(rectified, edge)
    assert fix.offset_px <= 0.9 * radius_to_px(0.013, rectified.size)

    outside = [{"value": "A", "center": {"x": 1.2, "y": 0.5}, "radius": 0.013}]
    [fix] = reg.register_group(rectified, outside)
    assert fix.fallback


def test_a_ring_next_to_the_frame_edge_is_still_registered(rectified: RectifiedPage) -> None:
    """La ultima fila de un spec puede quedar a menos de una ventana del borde del marco
    (el barrido sintetico la pone a 0.99). La ventana se rellena con papel y el anillo,
    que si esta adentro, se encuentra igual."""
    from app.geometry import radius_to_px

    width, height = rectified.size
    radius_px = radius_to_px(0.013, rectified.size)
    gray = rectified.gray.copy()
    cy = height - radius_px - 6
    cx = width // 2
    cv2.circle(gray, (cx + 5, cy - 3), radius_px, 40, thickness=3)
    page = RectifiedPage(gray, rectified.size, rectified.fiducials_found, False)
    center = {"x": cx / (width - 1), "y": cy / (height - 1)}
    bubble = [{"value": "A", "center": center, "radius": 0.013}]

    [fix] = reg.register_group(page, bubble)

    assert not fix.fallback
    assert abs(fix.dx - 5) <= 1 and abs(fix.dy + 3) <= 1


def test_grid_signature_keeps_sampling_at_the_spec_position(
    spec: dict, rectified: RectifiedPage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(reg.ENV_FLAG, "1")
    shifted_page = shifted(rectified, 14, 14)

    def boom(*_args, **_kwargs):
        raise AssertionError("la firma de grilla no debe registrar")

    monkeypatch.setattr(reg, "register_group", boom)
    fraction = _grid_signature_fraction(shifted_page, spec, 0)
    assert 0.0 <= fraction <= 1.0


def test_process_page_reads_the_same_marks_with_and_without_registration(
    spec: dict, clean_gray: np.ndarray, profile: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(reg.ENV_FLAG, raising=False)
    off = process_page(syn.to_bgr(clean_gray), 0, spec, profile)
    monkeypatch.setenv(reg.ENV_FLAG, "1")
    on = process_page(syn.to_bgr(clean_gray), 0, spec, profile)

    assert [(m["state"], m["value"]) for m in on["marks"]] == [
        (m["state"], m["value"]) for m in off["marks"]
    ]


def test_debug_payload_reports_the_registration_summary(
    spec: dict, clean_gray: np.ndarray, profile: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.pipeline import classify_page_debug

    monkeypatch.setenv(reg.ENV_FLAG, "1")
    _, debug = classify_page_debug(syn.to_bgr(clean_gray), 0, spec, profile)
    summary = debug["registration"]

    assert summary["enabled"] is True
    assert summary["bubbles"] == 32
    assert summary["offMedianPx"] <= 1.0
    assert summary["fallbackCount"] == 0


def test_registering_a_whole_page_is_cheap(spec: dict, rectified: RectifiedPage) -> None:
    started = time.perf_counter()
    for _ in range(3):
        for field in spec["fields"]:
            reg.register_group(rectified, field["bubbles"])
    per_page_ms = (time.perf_counter() - started) * 1000 / 3
    bubbles = sum(len(field["bubbles"]) for field in spec["fields"])

    assert per_page_ms / bubbles * 88 < 60


def test_env_flag_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(reg.ENV_FLAG, raising=False)
    assert reg.local_registration_enabled() is reg.DEFAULT_ENABLED
    for value in ("1", "true", "YES", "on"):
        monkeypatch.setenv(reg.ENV_FLAG, value)
        assert reg.local_registration_enabled() is True
    for value in ("0", "false", "", "no"):
        monkeypatch.setenv(reg.ENV_FLAG, value)
        assert reg.local_registration_enabled() is False


def test_bubble_fill_px_matches_bubble_fill(spec: dict, rectified: RectifiedPage) -> None:
    from app.classify import bubble_fill_px
    from app.geometry import point_to_px, radius_to_px

    for field in spec["fields"]:
        for bubble in field["bubbles"]:
            via_spec = bubble_fill(rectified, bubble["center"], bubble["radius"])
            via_px = bubble_fill_px(
                rectified,
                point_to_px(bubble["center"], rectified.size),
                radius_to_px(bubble["radius"], rectified.size),
            )
            assert via_spec == via_px
