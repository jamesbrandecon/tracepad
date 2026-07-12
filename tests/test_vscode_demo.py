from pathlib import Path

import nbformat
from nbclient import NotebookClient


TRACEPAD_RESULT_MIME = "application/vnd.tracepad.result+json"


def _tracepad_code_cells(notebook):
    return [
        cell
        for cell in notebook.cells
        if cell.cell_type == "code" and "tracepad" in cell.metadata
    ]


def test_vscode_demo_cells_execute_against_repository_fixture(monkeypatch):
    root = Path(__file__).parents[1]
    notebook = nbformat.read(
        root / "vscode-extension" / "demo" / "tracepad-vscode-demo.ipynb",
        as_version=4,
    )
    monkeypatch.chdir(root / "vscode-extension" / "demo")

    namespace = {"__name__": "__tracepad_demo_test__"}
    for cell in _tracepad_code_cells(notebook):
        exec(compile(cell.source, f"tracepad-turn-{cell.metadata.tracepad.turnNumber}", "exec"), namespace)

    assert len(namespace["tracepad_result_1"]) == 3000
    assert list(namespace["tracepad_result_2"].columns) == [
        "order_month",
        "channel",
        "net_revenue",
        "order_count",
    ]
    assert namespace["tracepad_result_2_1"] is namespace["fig"]


def test_vscode_demo_emits_tracepad_result_mime():
    root = Path(__file__).parents[1]
    notebook_path = root / "vscode-extension" / "demo" / "tracepad-vscode-demo.ipynb"
    notebook = nbformat.read(notebook_path, as_version=4)
    NotebookClient(
        notebook,
        timeout=120,
        kernel_name="python3",
        resources={"metadata": {"path": str(notebook_path.parent)}},
    ).execute()

    payloads = []
    for cell in _tracepad_code_cells(notebook):
        rich_outputs = [
            output["data"][TRACEPAD_RESULT_MIME]
            for output in cell.outputs
            if output.output_type in {"display_data", "execute_result"}
            and TRACEPAD_RESULT_MIME in output.get("data", {})
        ]
        assert len(rich_outputs) == 1
        payloads.extend(rich_outputs)

    assert [(payload["kind"], payload["alias"]) for payload in payloads] == [
        ("data", "orders"),
        ("data", "monthly_revenue"),
        ("plot", "revenue_chart"),
    ]
