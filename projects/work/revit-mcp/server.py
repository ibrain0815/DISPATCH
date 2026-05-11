"""
server.py — Revit MCP Server
Claude Code ↔ MCP ↔ Revit Add-in (HTTP:8765)

실행: python server.py
또는 Claude Code settings.json에 등록 후 자동 실행
"""

import json
from mcp.server.fastmcp import FastMCP
from revit_client import (
    ping, get_project_info, get_levels,
    get_elements, get_element_info, get_element_params,
    create_level, create_wall, create_floor, create_column,
    set_parameter, delete_element, run_script,
)

mcp = FastMCP("Revit MCP Server")


# ════════════════════════════════════════════════════
# 연결 확인
# ════════════════════════════════════════════════════

@mcp.tool()
def ping_revit() -> str:
    """Revit과의 연결 상태를 확인합니다."""
    try:
        result = ping()
        return f"✅ Revit 연결됨 — 버전: {result.get('version', 'unknown')}"
    except Exception as e:
        return f"❌ 연결 실패: {e}"


# ════════════════════════════════════════════════════
# 프로젝트 정보
# ════════════════════════════════════════════════════

@mcp.tool()
def get_revit_project_info() -> str:
    """현재 열린 Revit 프로젝트의 기본 정보를 반환합니다.
    (프로젝트명, 파일 경로, 프로젝트 번호, 발주처, 수정 여부)
    """
    data = get_project_info()
    return json.dumps(data, ensure_ascii=False, indent=2)


# ════════════════════════════════════════════════════
# 레벨
# ════════════════════════════════════════════════════

@mcp.tool()
def get_revit_levels() -> str:
    """Revit 모델의 모든 레벨(층) 목록을 반환합니다.
    각 레벨의 ID, 이름, 높이(m)를 포함합니다.
    """
    data = get_levels()
    return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.tool()
def create_revit_level(elevation_m: float, name: str = "New Level") -> str:
    """새로운 레벨(층)을 생성합니다.

    Args:
        elevation_m: 레벨 높이 (미터 단위, 예: 3.0 = 3m)
        name:        레벨 이름 (예: "2F", "3층")
    """
    data = create_level(elevation_m, name)
    return f"✅ 레벨 생성 완료 — ID: {data['id']}, 이름: {data['name']}, 높이: {data['elevation']}m"


# ════════════════════════════════════════════════════
# 요소 조회
# ════════════════════════════════════════════════════

@mcp.tool()
def get_revit_elements(category: str = "OST_Walls") -> str:
    """지정한 카테고리의 모든 Revit 요소 목록을 반환합니다.

    Args:
        category: Revit BuiltInCategory 이름
          - OST_Walls           (벽)
          - OST_Floors          (바닥)
          - OST_Doors           (문)
          - OST_Windows         (창)
          - OST_Columns         (기둥)
          - OST_StructuralFraming (보)
          - OST_Rooms           (방)
          - OST_Levels          (레벨)
          - OST_Grids           (그리드)
          - OST_DuctCurves      (덕트)
          - OST_PipeCurves      (배관)
    """
    data = get_elements(category)
    return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.tool()
def get_revit_element_info(element_id: int) -> str:
    """특정 요소의 기본 정보를 반환합니다.

    Args:
        element_id: Revit 요소 ID (정수)
    """
    data = get_element_info(element_id)
    return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.tool()
def get_revit_element_parameters(element_id: int) -> str:
    """특정 요소의 모든 매개변수(파라미터) 목록과 값을 반환합니다.

    Args:
        element_id: Revit 요소 ID (정수)
    """
    data = get_element_params(element_id)
    return json.dumps(data, ensure_ascii=False, indent=2)


# ════════════════════════════════════════════════════
# 요소 생성
# ════════════════════════════════════════════════════

@mcp.tool()
def create_revit_wall(
    x1: float, y1: float,
    x2: float, y2: float,
    height_m: float = 3.0
) -> str:
    """직선 벽을 생성합니다.

    Args:
        x1, y1:   시작점 좌표 (미터)
        x2, y2:   끝점 좌표 (미터)
        height_m: 벽 높이 (미터, 기본값: 3.0)

    예시: create_revit_wall(0, 0, 10, 0, 3.0) → (0,0)에서 (10,0)으로 3m 높이 벽
    """
    data = create_wall(x1, y1, x2, y2, height_m)
    return f"✅ 벽 생성 완료 — ID: {data['id']}, 이름: {data.get('name', '')}"


@mcp.tool()
def create_revit_floor(width_m: float = 10.0, depth_m: float = 8.0) -> str:
    """직사각형 바닥(슬래브)을 생성합니다.

    Args:
        width_m: 바닥 폭 (미터)
        depth_m: 바닥 깊이 (미터)
    """
    data = create_floor(width_m, depth_m)
    return f"✅ 바닥 생성 완료 — ID: {data['id']}"


@mcp.tool()
def create_revit_column(x: float, y: float, level_id: int = 0) -> str:
    """구조 기둥을 생성합니다.

    Args:
        x:        기둥 X 좌표 (미터)
        y:        기둥 Y 좌표 (미터)
        level_id: 기준 레벨 ID (0이면 가장 낮은 레벨에 자동 배치)

    예시: create_revit_column(0, 0) → 원점에 기둥 생성
    """
    data = create_column(x, y, level_id)
    return (f"✅ 기둥 생성 완료 — ID: {data['id']}, "
            f"위치: ({data['x']}, {data['y']}), "
            f"레벨: {data['level']}, 패밀리: {data['family']}")


# ════════════════════════════════════════════════════
# 요소 수정 / 삭제
# ════════════════════════════════════════════════════

@mcp.tool()
def set_revit_parameter(element_id: int, param_name: str, value: str) -> str:
    """특정 요소의 매개변수 값을 설정합니다.

    Args:
        element_id: Revit 요소 ID
        param_name: 매개변수 이름 (예: "표기", "주석", "높이")
        value:      설정할 값 (문자열로 입력, 숫자도 문자열로)
    """
    data = set_parameter(element_id, param_name, value)
    return f"✅ 매개변수 설정 완료 — {data['param']} = {data['value']}"


@mcp.tool()
def delete_revit_element(element_id: int) -> str:
    """Revit 모델에서 요소를 삭제합니다.

    Args:
        element_id: 삭제할 Revit 요소 ID
    """
    data = delete_element(element_id)
    return f"✅ 요소 삭제 완료 — ID: {data['id']}"


# ════════════════════════════════════════════════════
# 범용 스크립트 실행 (에이전트 모드)
# ════════════════════════════════════════════════════

@mcp.tool()
def run_revit_script(code: str) -> str:
    """Revit API C# 코드를 Revit 내부에서 직접 실행합니다.
    이 도구를 사용하면 DLL 수정 없이 임의의 Revit 작업을 수행할 수 있습니다.

    Args:
        code: Revit API C# 코드 (doc, uidoc, view, app 변수 사용 가능)
              결과는 OUT 변수에 할당하면 반환됩니다.

    예시:
        # 기둥 색상 변경
        var ogs = new OverrideGraphicSettings();
        ogs.SetProjectionLineColor(new Color(255, 0, 0));
        view.SetElementOverrides(new ElementId(12345L), ogs);
        OUT = "색상 적용 완료";

        # 요소 개수 조회
        var walls = new FilteredElementCollector(doc)
            .OfClass(typeof(Wall)).ToElements();
        OUT = walls.Count + "개 벽 발견";
    """
    data = run_script(code)
    output = data.get("output")
    if output is None:
        return "✅ 실행 완료"
    return f"✅ 실행 완료 — 결과: {output}"


# ════════════════════════════════════════════════════
# 서버 실행
# ════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Revit MCP 서버 시작 중...")
    mcp.run(transport="stdio")
