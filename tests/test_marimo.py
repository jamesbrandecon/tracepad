from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd
import statsmodels.formula.api as smf

from tracepad.marimo import Inspection, inspect, inspection_snapshot, prompt


ROOT = Path(__file__).resolve().parents[1]


def test_table_snapshot_profiles_data_and_lineage():
    table = pd.DataFrame(
        {
            "group": ["a", "a", "b"],
            "value": [1.0, None, 3.0],
        }
    )

    snapshot = inspection_snapshot(table, name="summary", parents=["orders"])

    assert snapshot["kind"] == "data"
    assert snapshot["name"] == "summary"
    assert snapshot["parents"] == ["orders"]
    assert snapshot["payload"]["shape"] == [3, 2]
    assert snapshot["profile"][1]["nulls_in_sample"] == 1


def test_model_snapshot_exposes_summary_coefficients_and_predictions():
    frame = pd.DataFrame({"y": [1.0, 2.1, 3.1, 4.2], "x": [0.0, 1.0, 2.0, 3.0]})
    model = smf.ols("y ~ x", data=frame).fit()

    snapshot = inspection_snapshot(model, name="revenue_model", parents=["orders"])

    assert snapshot["kind"] == "model"
    assert "OLS Regression Results" in snapshot["payload"]["summary"]
    assert {row["term"] for row in snapshot["payload"]["coefficients"]} == {"Intercept", "x"}
    assert len(snapshot["predictions"]) == len(frame)


def test_inspect_preserves_the_original_value():
    value = pd.DataFrame({"x": [1, 2]})

    view = inspect(value, name="orders")

    assert isinstance(view, Inspection)
    assert view.value is value
    assert view.name == "orders"


def test_prompt_returns_a_marimo_display_object():
    rendered = prompt("Using @orders, summarize revenue.", number=2)

    assert rendered.text == "Using @orders, summarize revenue."
    assert rendered.label == "Ask 2"
    assert "Generate" in rendered._esm
    assert "Refactor with AI" in rendered._esm
    assert 'document.execCommand("insertText", false, text)' in rendered._esm
    assert "Configure a Marimo AI edit model in Settings" in rendered._esm


def test_demo_is_importable_and_defines_a_marimo_app():
    path = ROOT / "demo" / "tracepad_marimo_demo.py"
    source = path.read_text(encoding="utf-8")
    specification = importlib.util.spec_from_file_location("tracepad_marimo_demo", path)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)

    assert module.app is not None
    assert module.__generated_with.startswith("0.23.")
    assert source.count("tracepad_marimo.prompt(") == 5
    assert source.count("@app.cell\ndef _():\n    return") == 5
    assert 'css_file="../style/marimo.css"' in source
    assert "pd.read_csv" not in source
    assert "plt.subplots" not in source
    assert ".fit()" not in source


def test_project_config_runs_marimo_setup_cells_on_open():
    project_config = (ROOT / "pyproject.toml").read_text(encoding="utf-8")

    runtime_section = project_config.split("[tool.marimo.runtime]", maxsplit=1)[1]
    runtime_section = runtime_section.split("[tool.marimo.ai]", maxsplit=1)[0]
    assert "auto_instantiate = true" in runtime_section
    assert "custom_css" not in project_config
