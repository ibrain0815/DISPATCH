"""
revit_client.py
Revit Add-in HTTP 브리지와 통신하는 클라이언트
"""

import httpx
import json
from typing import Any

REVIT_BASE = "http://localhost:8765"
TIMEOUT    = 20.0


def _call(path: str, body: dict | None = None) -> dict:
    """Revit HTTP 브리지 호출 공통 함수"""
    try:
        if body is None:
            resp = httpx.get(f"{REVIT_BASE}{path}", timeout=TIMEOUT)
        else:
            resp = httpx.post(
                f"{REVIT_BASE}{path}",
                content=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=TIMEOUT,
            )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "Revit API 오류"))
        return data.get("data", {})
    except httpx.ConnectError:
        raise RuntimeError(
            "Revit에 연결할 수 없습니다. Revit이 실행 중이고 RevitMCP 애드인이 로드되었는지 확인하세요."
        )


# ── 조회 ──────────────────────────────────────────

def ping() -> dict:
    return _call("/ping")


def get_project_info() -> dict:
    return _call("/project/info")


def get_levels() -> dict:
    return _call("/levels")


def get_elements(category: str = "OST_Walls", type_only: bool = False) -> dict:
    return _call("/elements", {"category": category, "type": str(type_only).lower()})


def get_element_info(element_id: int) -> dict:
    return _call("/element/info", {"id": element_id})


def get_element_params(element_id: int) -> dict:
    return _call("/element/params", {"id": element_id})


# ── 생성 ──────────────────────────────────────────

def create_level(elevation: float, name: str = "New Level") -> dict:
    return _call("/create/level", {"elevation": elevation, "name": name})


def create_wall(
    x1: float, y1: float,
    x2: float, y2: float,
    height: float = 3.0
) -> dict:
    return _call("/create/wall", {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "height": height})


def create_floor(width: float = 10.0, depth: float = 8.0) -> dict:
    return _call("/create/floor", {"width": width, "depth": depth})


def create_column(x: float, y: float, level_id: int = 0) -> dict:
    return _call("/create/column", {"x": x, "y": y, "level_id": level_id})


def set_color(element_ids: list, r: int, g: int, b: int) -> dict:
    return _call("/set/color", {"ids": element_ids, "r": r, "g": g, "b": b})


def run_script(code: str) -> dict:
    return _call("/run", {"code": code})


# ── 수정 ──────────────────────────────────────────

def set_parameter(element_id: int, param_name: str, value: Any) -> dict:
    return _call("/set/param", {"id": element_id, "param": param_name, "value": str(value)})


def delete_element(element_id: int) -> dict:
    return _call("/delete/element", {"id": element_id})
