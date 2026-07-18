"""Build the deterministic Tracepad V1 demo CSV and notebooks."""

from __future__ import annotations

import csv
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = ROOT / "demo"
DATA_PATH = DEMO_DIR / "data" / "retail_orders.csv"
GUIDED_PATH = ROOT / "tracepad_demo.ipynb"
CLEAN_PATH = DEMO_DIR / "tracepad_demo_clean.ipynb"
VSCODE_PATH = ROOT / "vscode-extension" / "demo" / "tracepad-vscode-demo.ipynb"
STAMP = "2026-07-09T20:00:00.000Z"


def build_rows(count: int = 3000) -> list[dict[str, object]]:
    rng = random.Random(20260709)
    regions = ["Northeast", "South", "Midwest", "West"]
    channels = ["Web", "Mobile", "Store"]
    categories = ["Home", "Electronics", "Beauty", "Outdoors", "Apparel"]
    base_prices = {
        "Home": 58,
        "Electronics": 145,
        "Beauty": 32,
        "Outdoors": 82,
        "Apparel": 46,
    }
    start = date(2025, 1, 1)
    rows: list[dict[str, object]] = []
    for index in range(count):
        category = rng.choice(categories)
        channel = rng.choices(channels, weights=[0.46, 0.34, 0.20], k=1)[0]
        region = rng.choice(regions)
        unit_price = max(5, rng.gauss(base_prices[category], base_prices[category] * 0.28))
        quantity = rng.choices([1, 2, 3, 4, 5], weights=[0.48, 0.27, 0.14, 0.07, 0.04], k=1)[0]
        discount = rng.choices([0, 0.05, 0.10, 0.15, 0.20, 0.30], weights=[0.28, 0.16, 0.22, 0.16, 0.12, 0.06], k=1)[0]
        delivery_days = max(1, min(14, round(rng.gauss(4.2 if channel != "Store" else 1.4, 1.8))))
        logit = -3.25 + 4.0 * discount + 0.16 * delivery_days + (0.35 if channel == "Mobile" else 0) + (0.28 if category == "Apparel" else 0)
        return_probability = 1 / (1 + math.exp(-logit))
        returned = int(rng.random() < return_probability)
        revenue = unit_price * quantity * (1 - discount)
        rows.append(
            {
                "order_id": f"ORD-{index + 1:05d}",
                "order_date": (start + timedelta(days=rng.randrange(365))).isoformat(),
                "customer_id": f"CUST-{rng.randrange(1, 901):04d}",
                "region": region,
                "channel": channel,
                "category": category,
                "unit_price": f"{unit_price:.2f}",
                "quantity": quantity,
                "discount": f"{discount:.2f}",
                "revenue": f"{revenue:.2f}",
                "returned": returned,
                "delivery_days": delivery_days,
            }
        )
    return rows


def source_lines(text: str) -> list[str]:
    lines = text.strip().splitlines()
    return [f"{line}\n" for line in lines[:-1]] + ([lines[-1]] if lines else [])


def notebook_metadata(tracepad_state: dict[str, object]) -> dict[str, object]:
    return {
        "kernelspec": {
            "display_name": "Tracepad (.venv)",
            "language": "python",
            "name": "tracepad",
        },
        "language_info": {"name": "python", "version": "3.11"},
        "tracepad": tracepad_state,
    }


def placeholder_object(object_id: str, turn_id: str, alias: str, kind: str) -> dict[str, object]:
    return {
        "id": object_id,
        "handle": f"__tracepad_{object_id.replace('-', '_')}",
        "turnId": turn_id,
        "alias": alias,
        "displayName": alias,
        "language": "python",
        "classNames": [],
        "kind": kind,
        "capabilities": [],
        "materialized": False,
        "live": False,
        "createdAt": STAMP,
    }


def guided_notebook() -> dict[str, object]:
    specifications = [
        {
            "turn": "turn-demo-orders",
            "object": "obj-demo-orders",
            "alias": "orders",
            "kind": "dataframe",
            "parent": None,
            "inputs": [],
            "prompt": "Load demo/data/retail_orders.csv, inspect its structure, and return the resulting table as orders.",
        },
        {
            "turn": "turn-demo-monthly",
            "object": "obj-demo-monthly",
            "alias": "monthly_revenue",
            "kind": "dataframe",
            "parent": "obj-demo-orders",
            "inputs": ["obj-demo-orders"],
            "prompt": "Using @orders, calculate monthly revenue, order count, and average order value by channel.",
        },
        {
            "turn": "turn-demo-plot",
            "object": "obj-demo-plot",
            "alias": "revenue_chart",
            "kind": "plot",
            "parent": "obj-demo-monthly",
            "inputs": ["obj-demo-monthly"],
            "prompt": "Using @monthly_revenue, plot monthly revenue by channel with a clear title and labeled axes.",
        },
        {
            "turn": "turn-demo-model",
            "object": "obj-demo-model",
            "alias": "return_model",
            "kind": "model",
            "parent": "obj-demo-orders",
            "inputs": ["obj-demo-orders"],
            "prompt": "Using @orders, fit a logistic model predicting whether an order is returned from discount, unit price, delivery time, channel, and category. Return the fitted model.",
        },
        {
            "turn": "turn-demo-predict",
            "object": "obj-demo-predict",
            "alias": "return_predictions",
            "kind": "dataframe",
            "parent": "obj-demo-model",
            "inputs": ["obj-demo-model", "obj-demo-orders"],
            "prompt": "Using @return_model and @orders, score a representative sample and return the orders with their predicted return probabilities.",
        },
    ]

    turns = []
    objects: dict[str, object] = {}
    cells: list[dict[str, object]] = [
        {
            "cell_type": "markdown",
            "id": "tracepad-demo-intro",
            "metadata": {},
            "source": source_lines(
                """
# Tracepad guided demo

Generate and run the prompts from top to bottom. Each result becomes a named, inspectable object that the next prompt can reference.
"""
            ),
        }
    ]
    for item in specifications:
        turn = {
            "id": item["turn"],
            "prompt": item["prompt"],
            "code": "",
            "language": "python",
            "status": "draft",
            "outputs": [],
            "outputObjectId": item["object"],
            "inputObjectIds": item["inputs"],
            "createdAt": STAMP,
            "updatedAt": STAMP,
        }
        if item["parent"]:
            turn["parentObjectId"] = item["parent"]
        turns.append(turn)
        objects[item["object"]] = placeholder_object(
            str(item["object"]), str(item["turn"]), str(item["alias"]), str(item["kind"])
        )
    state = {
        "version": 1,
        "turns": turns,
        "objects": objects,
        "activeTurnId": turns[0]["id"],
    }
    return {"cells": cells, "metadata": notebook_metadata(state), "nbformat": 4, "nbformat_minor": 5}


def vscode_notebook() -> dict[str, object]:
    prompts = [
        {
            "turn_id": "demo-turn-1",
            "turn_number": "1",
            "alias": "orders",
            "prompt": "Load data/retail_orders.csv, parse order_date, and return the resulting table as orders.",
        },
        {
            "turn_id": "demo-turn-2",
            "turn_number": "2",
            "alias": "monthly_revenue",
            "prompt": "Using @orders, summarize monthly net revenue and order count by channel.",
        },
        {
            "turn_id": "demo-turn-2-1",
            "turn_number": "2.1",
            "alias": "revenue_chart",
            "parent_turn_id": "demo-turn-2",
            "parent_alias": "monthly_revenue",
            "prompt": "Using @monthly_revenue, plot net revenue over time with one line per channel.",
        },
    ]
    cells = []
    for item in prompts:
        tracepad = {
            "version": 1,
            "role": "prompt",
            "turnId": item["turn_id"],
            "turnNumber": item["turn_number"],
            "alias": item["alias"],
        }
        if item.get("parent_turn_id"):
            tracepad.update(
                parentTurnId=item["parent_turn_id"],
                parentAlias=item["parent_alias"],
            )
        cells.append(
            {
                "cell_type": "markdown",
                "id": str(item["turn_id"]),
                "metadata": {"tracepad": tracepad},
                "source": source_lines(f"%%ai\n{item['prompt']}"),
            }
        )
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Tracepad (.venv)",
                "language": "python",
                "name": "tracepad",
            },
            "language_info": {"name": "python", "version": "3.11"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def clean_notebook() -> dict[str, object]:
    turn = {
        "id": "turn-demo-clean",
        "prompt": "Load demo/data/retail_orders.csv, inspect its structure, and return the resulting table as orders.",
        "code": "",
        "language": "python",
        "status": "draft",
        "outputs": [],
        "inputObjectIds": [],
        "createdAt": STAMP,
        "updatedAt": STAMP,
    }
    state = {"version": 1, "turns": [turn], "objects": {}, "activeTurnId": turn["id"]}
    cells = [
        {
            "cell_type": "markdown",
            "id": "tracepad-clean-intro",
            "metadata": {},
            "source": source_lines(
                """
# Tracepad clean demo

Connect an AI provider, generate the first turn, and build the analysis interactively.
"""
            ),
        }
    ]
    return {"cells": cells, "metadata": notebook_metadata(state), "nbformat": 4, "nbformat_minor": 5}


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")


def main() -> None:
    rows = build_rows()
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    write_json(GUIDED_PATH, guided_notebook())
    write_json(CLEAN_PATH, clean_notebook())
    write_json(VSCODE_PATH, vscode_notebook())
    print(f"Wrote {len(rows):,} rows to {DATA_PATH.relative_to(ROOT)}")
    print(f"Wrote {GUIDED_PATH.relative_to(ROOT)}")
    print(f"Wrote {CLEAN_PATH.relative_to(ROOT)}")
    print(f"Wrote {VSCODE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
