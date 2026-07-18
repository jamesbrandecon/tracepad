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
            "code": """
from pathlib import Path
import pandas as pd

orders = pd.read_csv(Path("demo/data/retail_orders.csv"), parse_dates=["order_date"])
print(f"{len(orders):,} rows x {len(orders.columns)} columns")
print(orders.isna().sum().loc[lambda values: values > 0])
orders
""",
        },
        {
            "turn": "turn-demo-monthly",
            "object": "obj-demo-monthly",
            "alias": "monthly_revenue",
            "kind": "dataframe",
            "parent": "obj-demo-orders",
            "inputs": ["obj-demo-orders"],
            "prompt": "Using @orders, calculate monthly revenue, order count, and average order value by channel.",
            "code": """
monthly_revenue = (
    orders.assign(month=orders["order_date"].dt.to_period("M").dt.to_timestamp())
    .groupby(["month", "channel"], as_index=False)
    .agg(revenue=("revenue", "sum"), order_count=("order_id", "count"))
)
monthly_revenue["average_order_value"] = monthly_revenue["revenue"] / monthly_revenue["order_count"]
monthly_revenue
""",
        },
        {
            "turn": "turn-demo-plot",
            "object": "obj-demo-plot",
            "alias": "revenue_chart",
            "kind": "plot",
            "parent": "obj-demo-monthly",
            "inputs": ["obj-demo-monthly"],
            "prompt": "Using @monthly_revenue, plot monthly revenue by channel with a clear title and labeled axes.",
            "code": """
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(9, 4.8))
for channel, values in monthly_revenue.groupby("channel"):
    ax.plot(values["month"], values["revenue"], marker="o", linewidth=2, label=channel)
ax.set(title="Monthly retail revenue by channel", xlabel="Month", ylabel="Revenue")
ax.legend(title="Channel", frameon=False)
ax.grid(axis="y", alpha=0.2)
fig.autofmt_xdate()
fig.tight_layout()
fig
""",
        },
        {
            "turn": "turn-demo-model",
            "object": "obj-demo-model",
            "alias": "return_model",
            "kind": "model",
            "parent": "obj-demo-orders",
            "inputs": ["obj-demo-orders"],
            "prompt": "Using @orders, fit a logistic model predicting whether an order is returned from discount, unit price, delivery time, channel, and category. Return the fitted model.",
            "code": """
import statsmodels.formula.api as smf

return_model = smf.logit(
    "returned ~ discount + unit_price + delivery_days + C(channel) + C(category)",
    data=orders,
).fit(disp=False)
return_model
""",
        },
        {
            "turn": "turn-demo-predict",
            "object": "obj-demo-predict",
            "alias": "return_predictions",
            "kind": "dataframe",
            "parent": "obj-demo-model",
            "inputs": ["obj-demo-model", "obj-demo-orders"],
            "prompt": "Using @return_model and @orders, score a representative sample and return the orders with their predicted return probabilities.",
            "code": """
return_predictions = orders.sample(20, random_state=12).copy()
return_predictions["predicted_return_probability"] = return_model.predict(return_predictions)
return_predictions = return_predictions[
    ["order_id", "channel", "category", "discount", "delivery_days", "returned", "predicted_return_probability"]
].sort_values("predicted_return_probability", ascending=False)
return_predictions
""",
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

Run the saved analysis turns from top to bottom. Each result becomes a named, inspectable object that the next turn can reference.
"""
            ),
        }
    ]
    for item in specifications:
        turn = {
            "id": item["turn"],
            "prompt": item["prompt"],
            "code": item["code"].strip(),
            "language": "python",
            "status": "ready",
            "generationNote": "Guided V1 example; generated code is editable before execution.",
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
        cells.append(
            {
                "cell_type": "code",
                "id": str(item["turn"]),
                "execution_count": None,
                "metadata": {
                    "tracepad": {
                        "turnId": item["turn"],
                        "prompt": item["prompt"],
                        "language": "python",
                        "parentObjectId": item["parent"],
                        "inputObjectIds": item["inputs"],
                        "objectId": item["object"],
                        "objectAlias": item["alias"],
                    }
                },
                "outputs": [],
                "source": source_lines(str(item["code"])),
            }
        )

    state = {
        "version": 1,
        "turns": turns,
        "objects": objects,
        "activeTurnId": turns[0]["id"],
    }
    return {"cells": cells, "metadata": notebook_metadata(state), "nbformat": 4, "nbformat_minor": 5}


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
    print(f"Wrote {len(rows):,} rows to {DATA_PATH.relative_to(ROOT)}")
    print(f"Wrote {GUIDED_PATH.relative_to(ROOT)}")
    print(f"Wrote {CLEAN_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
