import csv
from pathlib import Path

import nbformat
import pytest


ROOT = Path(__file__).parents[1]


@pytest.mark.parametrize(
    "relative_path",
    [
        "tracepad_demo.ipynb",
        "demo/tracepad_demo_clean.ipynb",
        "vscode-extension/demo/tracepad-vscode-demo.ipynb",
    ],
)
def test_demo_notebooks_contain_no_code_or_saved_outputs(relative_path):
    notebook = nbformat.read(ROOT / relative_path, as_version=4)

    assert all(cell.cell_type != "code" for cell in notebook.cells)
    assert all(not getattr(cell, "outputs", []) for cell in notebook.cells)


def test_jupyterlab_demo_contains_draft_prompt_sequence():
    notebook = nbformat.read(ROOT / "tracepad_demo.ipynb", as_version=4)
    turns = notebook.metadata.tracepad.turns

    assert len(turns) == 5
    assert all(turn.code == "" and turn.status == "draft" for turn in turns)
    assert [turn.prompt for turn in turns][1].startswith("Using @orders")
    assert set(notebook.metadata.tracepad.objects) == {
        "obj-demo-orders",
        "obj-demo-monthly",
        "obj-demo-plot",
        "obj-demo-model",
        "obj-demo-predict",
    }


def test_vscode_demo_contains_prompt_only_reference_flow():
    notebook = nbformat.read(
        ROOT / "vscode-extension" / "demo" / "tracepad-vscode-demo.ipynb",
        as_version=4,
    )

    assert [cell.metadata.tracepad.alias for cell in notebook.cells] == [
        "orders",
        "monthly_revenue",
        "revenue_chart",
    ]
    assert all(cell.source.startswith("%%ai\n") for cell in notebook.cells)
    assert "@orders" in notebook.cells[1].source
    assert "@monthly_revenue" in notebook.cells[2].source


def test_demo_csv_remains_a_small_reproducible_fixture():
    with (ROOT / "demo" / "data" / "retail_orders.csv").open(
        encoding="utf-8", newline=""
    ) as handle:
        rows = list(csv.DictReader(handle))

    assert len(rows) == 3000
    assert set(rows[0]) == {
        "order_id",
        "order_date",
        "customer_id",
        "region",
        "channel",
        "category",
        "unit_price",
        "quantity",
        "discount",
        "revenue",
        "returned",
        "delivery_days",
    }
