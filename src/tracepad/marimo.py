"""Marimo-native presentation and inspection helpers for Tracepad."""

from __future__ import annotations

import html
import importlib
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .runtime import serialize_result


def _mo() -> Any:
    try:
        return importlib.import_module("marimo")
    except ImportError as error:
        raise RuntimeError(
            "Marimo support is optional. Install Tracepad with the marimo extra: "
            "uv pip install -e '.[marimo]'"
        ) from error


def notebook_header(
    title: str = "Tracepad for Marimo",
    subtitle: str = "AI-assisted analysis with native reactive lineage",
) -> Any:
    """Return the compact Tracepad header used by Marimo notebooks."""
    mo = _mo()
    return mo.Html(
        '<div class="tracepad-marimo-shell">'
        '<section class="tracepad-marimo-header">'
        '<div class="tracepad-marimo-brand">'
        f"<strong>{html.escape(title)}</strong>"
        f"<span>{html.escape(subtitle)}</span>"
        "</div>"
        '<div class="tracepad-marimo-header-note">'
        "Generate with Marimo AI, reference live variables with @, and open "
        "Tracepad inspection cards for tables, plots, and models."
        "</div>"
        "</section>"
        "</div>"
    )


_PROMPT_WIDGET_ESM = r"""
const waitFor = (predicate, timeout = 2500) => new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    const result = predicate();
    if (result) {
      resolve(result);
    } else if (Date.now() - started > timeout) {
      reject(new Error("Timed out waiting for Marimo's AI editor."));
    } else {
      window.setTimeout(check, 40);
    }
  };
  check();
});

const renderReferences = (text) => {
  const fragment = document.createDocumentFragment();
  const parts = text.split(/(@[A-Za-z_][A-Za-z0-9_]*)/g);
  for (const part of parts) {
    if (/^@[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      const reference = document.createElement("span");
      reference.className = "tracepad-marimo-reference";
      reference.textContent = part;
      fragment.append(reference);
    } else {
      fragment.append(document.createTextNode(part));
    }
  }
  return fragment;
};

function render({ model, el }) {
  const text = model.get("text");
  const label = model.get("label");

  el.className = "tracepad-marimo-shell tracepad-marimo-prompt-widget";
  el.innerHTML = `
    <section class="tracepad-marimo-prompt">
      <div class="tracepad-marimo-prompt-label"></div>
      <div class="tracepad-marimo-prompt-text"></div>
      <div class="tracepad-marimo-prompt-actions">
        <button type="button" class="tracepad-marimo-generate">Generate</button>
        <span class="tracepad-marimo-generate-status" aria-live="polite"></span>
      </div>
    </section>
  `;

  el.querySelector(".tracepad-marimo-prompt-label").textContent = label;
  el.querySelector(".tracepad-marimo-prompt-text").append(renderReferences(text));

  const button = el.querySelector(".tracepad-marimo-generate");
  const status = el.querySelector(".tracepad-marimo-generate-status");

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Opening AI editor";

    try {
      const widgetHost = el.getRootNode()?.host || el;
      const promptCell = widgetHost.closest(".marimo-cell");
      const targetCell = promptCell?.parentElement?.nextElementSibling?.querySelector(".marimo-cell");
      const editor = targetCell?.querySelector(".cm-content[contenteditable='true']");

      if (!targetCell || !editor) {
        throw new Error("Add an empty code cell directly below this Ask, then try again.");
      }

      editor.focus();
      const actionButton = targetCell.querySelector(
        "button[data-testid='cell-actions-button']"
      );
      if (!actionButton) {
        throw new Error("Marimo's cell actions are unavailable for this cell.");
      }
      actionButton.click();

      let aiAction;
      try {
        aiAction = await waitFor(() =>
          [...document.querySelectorAll("[role='menuitem'], button")].find(
            (candidate) =>
              candidate.textContent?.trim().startsWith("Refactor with AI") &&
              !candidate.disabled
          )
        );
      } catch {
        throw new Error("Configure a Marimo AI edit model in Settings, then try again.");
      }
      aiAction.click();

      const aiInput = await waitFor(() =>
        targetCell.querySelector("[contenteditable='true'][aria-placeholder^='Generate with AI']") ||
        document.querySelector("[contenteditable='true'][aria-placeholder^='Generate with AI']")
      );
      aiInput.focus();

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(aiInput);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);

      const submit = await waitFor(() => {
        const icon = targetCell.querySelector("svg.lucide-send-horizontal") ||
          document.querySelector("svg.lucide-send-horizontal");
        const candidate = icon?.closest("button");
        return candidate && !candidate.disabled ? candidate : null;
      });
      status.textContent = "Generating code";
      submit.click();

      await waitFor(
        () => !document.querySelector("[contenteditable='true'][aria-placeholder^='Generate with AI']"),
        120000,
      );
      status.textContent = "Code ready for review";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
    }
  });
}

export default { render };
"""


try:
    import anywidget as _anywidget
    import traitlets as _traitlets
except ImportError:  # Marimo support is optional for Jupyter-only installs.
    _anywidget = None
    _traitlets = None


if _anywidget is not None and _traitlets is not None:

    class _PromptWidget(_anywidget.AnyWidget):
        _esm = _PROMPT_WIDGET_ESM

        text = _traitlets.Unicode().tag(sync=True)
        label = _traitlets.Unicode().tag(sync=True)

else:
    _PromptWidget = None  # type: ignore[misc,assignment]


def _prompt_widget(text: str, label: str) -> Any:
    if _PromptWidget is None:
        raise RuntimeError(
            "Interactive Marimo prompts require Tracepad's Marimo extra: "
            "uv pip install -e '.[marimo]'"
        )

    return _PromptWidget(text=text, label=label)


def prompt(text: str, *, number: str | int | None = None) -> Any:
    """Render a request that can generate into the following Marimo code cell."""
    _mo()
    label = f"Ask {number}" if number is not None else "Ask"
    return _prompt_widget(text, label)


@dataclass(slots=True)
class Inspection:
    """A rich Marimo display that leaves the underlying Python value untouched."""

    value: Any
    name: str
    parents: tuple[str, ...] = ()
    prediction_data: Any | None = None

    def _display_(self) -> Any:
        return _render_inspection(self)


def inspect(
    value: Any,
    *,
    name: str | None = None,
    parents: Sequence[str] | None = None,
    prediction_data: Any | None = None,
) -> Inspection:
    """Create an inline inspection workspace for a table, plot, model, or value.

    Assign the reusable object normally, then leave this call as the final
    expression of a Marimo cell::

        demand_model = sm.OLS(y, X).fit()
        tracepad_marimo.inspect(demand_model, name="demand_model", parents=["orders"])

    The object remains available as ``demand_model``; the returned ``Inspection``
    controls only the rendered output.
    """
    resolved_name = (name or _default_name(value)).strip() or "result"
    return Inspection(
        value=value,
        name=resolved_name,
        parents=tuple(str(parent).lstrip("@").strip() for parent in (parents or ()) if str(parent).strip()),
        prediction_data=prediction_data,
    )


def present(
    value: Any,
    *,
    name: str | None = None,
    parents: Sequence[str] | None = None,
    prediction_data: Any | None = None,
) -> Inspection:
    """Backward-compatible alias for :func:`inspect` in Marimo notebooks."""
    return inspect(
        value,
        name=name,
        parents=parents,
        prediction_data=prediction_data,
    )


def inspection_snapshot(
    value: Any,
    *,
    name: str | None = None,
    parents: Sequence[str] | None = None,
    prediction_data: Any | None = None,
) -> dict[str, Any]:
    """Return the host-neutral data used to render a Marimo inspection card."""
    resolved_name = (name or _default_name(value)).strip() or "result"
    payload = serialize_result(
        value,
        alias=resolved_name,
        runtime_name=resolved_name,
        turn_id="",
        turn_number="",
    )
    snapshot: dict[str, Any] = {
        "name": resolved_name,
        "parents": [str(parent).lstrip("@").strip() for parent in (parents or ()) if str(parent).strip()],
        "kind": payload.get("kind", "value"),
        "type_name": payload.get("typeName", type(value).__name__),
        "module": payload.get("module", type(value).__module__),
        "payload": payload,
        "profile": [],
        "predictions": [],
    }
    candidate = _tabular_candidate(value)
    if candidate is not None:
        snapshot["profile"] = _profile_table(candidate)
    if snapshot["kind"] == "model":
        snapshot["predictions"] = _prediction_rows(value, prediction_data)
    return snapshot


def _render_inspection(inspection: Inspection) -> Any:
    mo = _mo()
    snapshot = inspection_snapshot(
        inspection.value,
        name=inspection.name,
        parents=inspection.parents,
        prediction_data=inspection.prediction_data,
    )
    payload = snapshot["payload"]
    kind = str(snapshot["kind"])
    type_name = str(snapshot["type_name"])

    header = mo.Html(_header_html(snapshot))
    lineage = mo.Html(_lineage_html(snapshot)) if snapshot["parents"] else None
    tabs: dict[str, Any] = {}

    if kind == "data":
        candidate = _tabular_candidate(inspection.value)
        if candidate is not None:
            tabs["Preview"] = mo.ui.table(
                candidate,
                pagination=True,
                selection=None,
                page_size=6,
                show_column_summaries=True,
                show_data_types=True,
            )
            try:
                tabs["Explore"] = mo.ui.data_explorer(candidate)
            except Exception as error:
                tabs["Explore"] = _empty_panel(
                    mo,
                    f"Marimo could not open its visual explorer for this table: {error}",
                )
        tabs["Profile"] = (
            mo.ui.table(snapshot["profile"], pagination=True, selection=None, page_size=12)
            if snapshot["profile"]
            else _empty_panel(mo, "No column profile is available for this object.")
        )
    elif kind == "model":
        tabs["Summary"] = _summary_panel(mo, str(payload.get("summary", repr(inspection.value))))
        coefficients = payload.get("coefficients", [])
        tabs["Coefficients"] = (
            mo.ui.table(coefficients, pagination=True, selection=None, page_size=12)
            if coefficients
            else _empty_panel(mo, "This model does not expose coefficients in a recognized form.")
        )
        tabs["Predictions"] = (
            mo.ui.table(snapshot["predictions"], pagination=True, selection=None, page_size=12)
            if snapshot["predictions"]
            else _empty_panel(
                mo,
                "Prediction is available but needs explicit prediction_data, or this model does not retain fitted values.",
            )
        )
        diagnostics = _diagnostic_plots(inspection.value)
        tabs["Diagnostics"] = (
            mo.vstack(diagnostics, gap=1)
            if diagnostics
            else _empty_panel(mo, "No safe generic diagnostic plot is available for this model.")
        )
    elif kind == "plot":
        tabs["Plot"] = inspection.value
        tabs["Details"] = _stats_panel(
            mo,
            [("Type", type_name), ("Module", str(snapshot["module"]))],
        )
    else:
        tabs["Value"] = _summary_panel(mo, str(payload.get("summary", repr(inspection.value))))

    capabilities = payload.get("capabilities", [])
    if capabilities:
        tabs["Methods"] = mo.Html(
            '<div class="tracepad-marimo-help">Detected model methods: '
            + ", ".join(f"<strong>{html.escape(str(item))}</strong>" for item in capabilities)
            + ". Use the named Python object directly in any downstream Marimo cell."
            + "</div>"
        )

    tab_view = mo.ui.tabs(tabs, lazy=True).style(padding="12px")
    pieces = [header]
    if lineage is not None:
        pieces.append(lineage)
    pieces.append(tab_view)
    return mo.vstack(pieces, gap=0).style(
        width="min(100%, 1160px)",
        margin="0 auto",
        overflow="hidden",
        border="1px solid var(--tp-marimo-border)",
        border_radius="8px",
        background="var(--tp-marimo-panel)",
        box_shadow="0 12px 28px rgba(17, 24, 39, 0.045)",
    )


def _header_html(snapshot: Mapping[str, Any]) -> str:
    payload = snapshot["payload"]
    kind = html.escape(str(snapshot["kind"]).replace("_", " ").title())
    name = html.escape(str(snapshot["name"]))
    type_name = html.escape(str(snapshot["type_name"]))
    meta = [f'<span class="tracepad-marimo-pill">{kind}</span>']
    shape = payload.get("shape")
    if isinstance(shape, (list, tuple)) and len(shape) == 2:
        meta.append(
            '<span class="tracepad-marimo-pill">'
            f"{html.escape(str(shape[0]))} rows x {html.escape(str(shape[1]))} columns"
            "</span>"
        )
    meta.append(f'<span class="tracepad-marimo-pill">{type_name}</span>')
    return (
        '<header class="tracepad-marimo-card-header">'
        '<div class="tracepad-marimo-title">'
        '<span class="tracepad-marimo-eyebrow">Inspection</span>'
        f"<strong>{name}</strong>"
        "</div>"
        '<div class="tracepad-marimo-meta">'
        f'<span class="tracepad-marimo-pill alias">@{name}</span>'
        + "".join(meta)
        + "</div></header>"
    )


def _lineage_html(snapshot: Mapping[str, Any]) -> str:
    parents = [html.escape(str(parent)) for parent in snapshot["parents"]]
    name = html.escape(str(snapshot["name"]))
    parent_html = "".join(
        f'<span class="tracepad-marimo-parent">@{parent}</span>' for parent in parents
    )
    return (
        '<div class="tracepad-marimo-lineage">'
        "<span>Uses</span>"
        f"{parent_html}"
        '<span class="tracepad-marimo-arrow">-&gt;</span>'
        f'<span class="tracepad-marimo-parent">@{name}</span>'
        "</div>"
    )


def _summary_panel(mo: Any, text: str) -> Any:
    return mo.Html(
        '<pre class="tracepad-marimo-summary">'
        f"{html.escape(text)}"
        "</pre>"
    )


def _empty_panel(mo: Any, text: str) -> Any:
    return mo.Html(
        '<div class="tracepad-marimo-empty">'
        f"{html.escape(text)}"
        "</div>"
    )


def _stats_panel(mo: Any, stats: Sequence[tuple[str, str]]) -> Any:
    content = "".join(
        '<div class="tracepad-marimo-stat">'
        f"<span>{html.escape(label)}</span><strong>{html.escape(value)}</strong>"
        "</div>"
        for label, value in stats
    )
    return mo.Html(f'<div class="tracepad-marimo-grid">{content}</div>')


def _default_name(value: Any) -> str:
    return type(value).__name__.lower().replace(" ", "_")


def _tabular_candidate(value: Any) -> Any | None:
    if isinstance(value, Mapping):
        for key in ("data", "result", "table", "preview", "head"):
            candidate = value.get(key)
            if _is_tabular(candidate):
                return candidate
        return None
    return value if _is_tabular(value) else None


def _is_tabular(value: Any) -> bool:
    return value is not None and all(
        hasattr(value, attribute) for attribute in ("head", "columns", "shape")
    )


def _profile_table(value: Any) -> list[dict[str, Any]]:
    try:
        sample = value.head(10000)
        rows: list[dict[str, Any]] = []
        for column in list(sample.columns)[:100]:
            series = sample[column]
            nulls = int(series.isna().sum()) if hasattr(series, "isna") else None
            unique = int(series.nunique(dropna=True)) if hasattr(series, "nunique") else None
            rows.append(
                {
                    "column": str(column),
                    "dtype": str(getattr(series, "dtype", type(series).__name__)),
                    "nulls_in_sample": nulls,
                    "unique_in_sample": unique,
                }
            )
        return rows
    except Exception:
        return []


def _prediction_rows(value: Any, prediction_data: Any | None) -> list[dict[str, Any]]:
    predictions = None
    if prediction_data is not None and callable(getattr(value, "predict", None)):
        try:
            predictions = value.predict(prediction_data)
        except Exception:
            predictions = None
    if predictions is None:
        predictions = getattr(value, "fittedvalues", None)
    if predictions is None and callable(getattr(value, "predict", None)):
        try:
            predictions = value.predict()
        except Exception:
            predictions = None
    return _series_rows(predictions, "prediction")


def _series_rows(value: Any, field: str, limit: int = 100) -> list[dict[str, Any]]:
    if value is None:
        return []
    try:
        if hasattr(value, "items"):
            items = list(value.items())[:limit]
            return [
                {"index": _safe_scalar(index), field: _safe_scalar(item)}
                for index, item in items
            ]
        flattened = getattr(value, "ravel", lambda: value)()
        return [
            {"index": index, field: _safe_scalar(item)}
            for index, item in enumerate(list(flattened)[:limit])
        ]
    except Exception:
        return []


def _safe_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):
        try:
            return _safe_scalar(value.item())
        except Exception:
            pass
    return str(value)


def _diagnostic_plots(value: Any) -> list[Any]:
    fitted = getattr(value, "fittedvalues", None)
    model = getattr(value, "model", None)
    actual = getattr(model, "endog", None)
    if fitted is None or actual is None:
        return []
    try:
        import matplotlib.pyplot as plt

        fitted_values = [float(item) for item in list(fitted)]
        actual_values = [float(item) for item in list(actual)]
        if len(fitted_values) != len(actual_values) or not fitted_values:
            return []
        residuals = [actual_item - fitted_item for actual_item, fitted_item in zip(actual_values, fitted_values)]

        figure, axes = plt.subplots(1, 2, figsize=(10, 3.6), constrained_layout=True)
        axes[0].scatter(fitted_values, actual_values, alpha=0.55, color="#3154c6", edgecolors="none")
        low = min(fitted_values + actual_values)
        high = max(fitted_values + actual_values)
        axes[0].plot([low, high], [low, high], color="#c24a3a", linewidth=1.2)
        axes[0].set(title="Actual vs fitted", xlabel="Fitted", ylabel="Actual")

        axes[1].scatter(fitted_values, residuals, alpha=0.55, color="#3154c6", edgecolors="none")
        axes[1].axhline(0, color="#c24a3a", linewidth=1.2)
        axes[1].set(title="Residuals vs fitted", xlabel="Fitted", ylabel="Residual")
        for axis in axes:
            axis.spines[["top", "right"]].set_visible(False)
            axis.grid(alpha=0.18)
        return [figure]
    except Exception:
        return []


__all__ = [
    "Inspection",
    "inspect",
    "inspection_snapshot",
    "notebook_header",
    "present",
    "prompt",
]
