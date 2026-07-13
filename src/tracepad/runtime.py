"""Kernel-side rich result serialization shared by Tracepad notebook hosts."""

from __future__ import annotations

import base64
import io
import math
from collections.abc import Mapping
from typing import Any

RESULT_MIME = "application/vnd.tracepad.result+json"


def display_result(
    value: Any,
    *,
    alias: str,
    runtime_name: str,
    turn_id: str,
    turn_number: str,
) -> dict[str, Any]:
    """Render a kernel object with Tracepad's portable custom MIME payload."""
    from IPython.display import display

    payload = serialize_result(
        value,
        alias=alias,
        runtime_name=runtime_name,
        turn_id=turn_id,
        turn_number=turn_number,
    )
    display({RESULT_MIME: payload}, raw=True)
    return payload


def present(
    value: Any,
    *,
    name: str | None = None,
    alias: str | None = None,
    turn: str = "",
    turn_id: str = "",
) -> None:
    """Display a named Tracepad result without adding a second expression output.

    ``alias``, ``turn``, and ``turn_id`` remain accepted for notebooks generated
    by older Tracepad releases. New code only needs ``name``.
    """
    result_name = (name or alias or "result").strip() or "result"
    display_result(
        value,
        alias=result_name,
        runtime_name="",
        turn_id=turn_id,
        turn_number=turn,
    )


def serialize_result(
    value: Any,
    *,
    alias: str,
    runtime_name: str,
    turn_id: str,
    turn_number: str,
) -> dict[str, Any]:
    """Create a JSON-safe description for tables, plots, models, and values."""
    value_type = type(value)
    module = getattr(value_type, "__module__", "")
    payload: dict[str, Any] = {
        "version": 1,
        "kind": "value",
        "alias": alias,
        "runtimeName": runtime_name,
        "typeName": getattr(value_type, "__name__", str(value_type)),
        "module": module,
    }
    if turn_id:
        payload["turnId"] = turn_id
    if turn_number:
        payload["turnNumber"] = turn_number

    figure = getattr(value, "figure", value) if module.startswith("matplotlib") else None
    if figure is not None and hasattr(figure, "savefig"):
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", dpi=144, bbox_inches="tight")
        try:
            from matplotlib import pyplot

            pyplot.close(figure)
        except Exception:
            pass
        payload.update(
            kind="plot",
            imageDataUrl="data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
        )
        return payload

    tabular = _tabular_payload(value)
    if tabular is not None:
        payload.update(tabular)
        return payload

    model_attributes = ("summary", "params", "coef_", "predict", "fittedvalues")
    if any(hasattr(value, name) for name in model_attributes):
        payload.update(
            kind="model",
            summary=_model_summary(value),
            coefficients=_model_coefficients(value),
            capabilities=[
                name for name in ("summary", "predict", "plot", "fittedvalues")
                if hasattr(value, name)
            ],
        )
        return payload

    payload["summary"] = repr(value)[:12000]
    return payload


def _tabular_payload(value: Any) -> dict[str, Any] | None:
    candidate = value
    shape_hint: list[int] | None = None
    columns_hint: list[str] | None = None

    if isinstance(value, Mapping):
        shape_hint = _shape_hint(value.get("shape"))
        raw_columns = value.get("columns")
        if isinstance(raw_columns, (list, tuple)):
            columns_hint = [str(column) for column in raw_columns]
        candidate = next(
            (
                value[key]
                for key in ("data", "result", "table", "preview", "head")
                if key in value and _is_tabular_candidate(value[key])
            ),
            None,
        )
        if candidate is None:
            return None

    if all(hasattr(candidate, name) for name in ("head", "to_dict", "columns", "shape")):
        preview = candidate.head(24)
        records = preview.to_dict(orient="records")
        candidate_shape = [int(candidate.shape[0]), int(candidate.shape[1])]
        columns = columns_hint or [str(column) for column in candidate.columns]
        shape = shape_hint or candidate_shape
    elif isinstance(candidate, (list, tuple)) and all(isinstance(item, Mapping) for item in candidate):
        records = list(candidate[:24])
        columns = columns_hint or list(dict.fromkeys(
            str(key) for row in records for key in row
        ))
        shape = shape_hint or [len(candidate), len(columns)]
    else:
        return None

    candidate_type = type(candidate)
    return {
        "kind": "data",
        "typeName": getattr(candidate_type, "__name__", "table"),
        "module": getattr(candidate_type, "__module__", ""),
        "shape": shape,
        "columns": columns,
        "rows": [
            {str(key): _json_value(item) for key, item in row.items()}
            for row in records
        ],
        "truncated": shape[0] > len(records),
    }


def _is_tabular_candidate(value: Any) -> bool:
    return (
        all(hasattr(value, name) for name in ("head", "to_dict", "columns", "shape"))
        or isinstance(value, (list, tuple))
        and bool(value)
        and all(isinstance(item, Mapping) for item in value)
    )


def _shape_hint(value: Any) -> list[int] | None:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        try:
            return [int(value[0]), int(value[1])]
        except (TypeError, ValueError):
            return None
    return None


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):
        try:
            return _json_value(value.item())
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value)


def _model_summary(value: Any) -> str:
    summary = getattr(value, "summary", None)
    try:
        rendered = summary() if callable(summary) else repr(value)
    except Exception:
        rendered = repr(value)
    return str(rendered)[:16000]


def _model_coefficients(value: Any) -> list[dict[str, Any]]:
    params = getattr(value, "params", None)
    if params is None:
        params = getattr(value, "coef_", None)
    if params is None:
        return []
    try:
        if hasattr(params, "items"):
            return [
                {"term": str(name), "estimate": _json_value(estimate)}
                for name, estimate in list(params.items())[:100]
            ]
        flattened = getattr(params, "ravel", lambda: params)()
        estimates = list(flattened)
        names = list(getattr(value, "feature_names_in_", []))
        return [
            {
                "term": str(names[index]) if index < len(names) else f"term_{index + 1}",
                "estimate": _json_value(estimate),
            }
            for index, estimate in enumerate(estimates[:100])
        ]
    except Exception:
        return []
