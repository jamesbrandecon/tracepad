import marimo

__generated_with = "0.23.14"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _():
    from pathlib import Path

    import pandas as pd
    import statsmodels.formula.api as smf

    import tracepad.marimo as tracepad_marimo

    return Path, pd, smf, tracepad_marimo


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.notebook_header(
        "Tracepad for Marimo",
        "A reactive retail analysis with named results, lineage, and inspection",
    )
    return


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.prompt(
        "Load demo/data/retail_orders.csv, parse order_date, and return a useful preview of the orders.",
        number=1,
    )
    return


@app.cell
def _(Path, pd, tracepad_marimo):
    data_path = Path(__file__).parent / "data" / "retail_orders.csv"
    orders = pd.read_csv(data_path, parse_dates=["order_date"])
    orders_inspection = tracepad_marimo.inspect(orders, name="orders")
    orders_inspection
    return data_path, orders, orders_inspection


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @orders, summarize monthly net revenue and order count by channel.",
        number=2,
    )
    return


@app.cell
def _(orders, tracepad_marimo):
    orders_with_month = orders.assign(
        order_month=orders["order_date"].dt.to_period("M").dt.to_timestamp(),
        net_revenue=orders["revenue"] * (1 - orders["returned"]),
    )
    monthly_revenue = (
        orders_with_month.groupby(["order_month", "channel"], as_index=False)
        .agg(net_revenue=("net_revenue", "sum"), order_count=("order_id", "nunique"))
        .sort_values(["order_month", "channel"])
    )
    monthly_revenue_inspection = tracepad_marimo.inspect(
        monthly_revenue,
        name="monthly_revenue",
        parents=["orders"],
    )
    monthly_revenue_inspection
    return monthly_revenue, monthly_revenue_inspection, orders_with_month


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @monthly_revenue, plot net revenue over time with one line per channel.",
        number=3,
    )
    return


@app.cell
def _(monthly_revenue, tracepad_marimo):
    import matplotlib.pyplot as plt

    channel_revenue_plot, axis = plt.subplots(figsize=(10, 4.5), constrained_layout=True)
    for channel, channel_data in monthly_revenue.groupby("channel"):
        axis.plot(
            channel_data["order_month"],
            channel_data["net_revenue"],
            marker="o",
            linewidth=2,
            label=channel,
        )
    axis.set(title="Monthly net revenue by channel", xlabel="Month", ylabel="Net revenue")
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.2)
    axis.legend(frameon=False, ncol=3)
    channel_revenue_plot_inspection = tracepad_marimo.inspect(
        channel_revenue_plot,
        name="channel_revenue_plot",
        parents=["monthly_revenue"],
    )
    channel_revenue_plot_inspection
    return axis, channel_revenue_plot, channel_revenue_plot_inspection, plt


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @orders, fit an OLS model of revenue on unit price, quantity, discount, and channel, then inspect the fitted model.",
        number=4,
    )
    return


@app.cell
def _(orders, smf, tracepad_marimo):
    model_frame = orders.loc[
        :, ["revenue", "unit_price", "quantity", "discount", "channel"]
    ].dropna()
    revenue_model = smf.ols(
        "revenue ~ unit_price + quantity + discount + C(channel)",
        data=model_frame,
    ).fit()
    revenue_model_inspection = tracepad_marimo.inspect(
        revenue_model,
        name="revenue_model",
        parents=["orders"],
    )
    revenue_model_inspection
    return model_frame, revenue_model, revenue_model_inspection


@app.cell(hide_code=True)
def _(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @revenue_model, predict revenue for a few representative Web, Mobile, and Store orders.",
        number=5,
    )
    return


@app.cell
def _(pd, revenue_model, tracepad_marimo):
    prediction_grid = pd.DataFrame(
        {
            "unit_price": [35.0, 55.0, 75.0],
            "quantity": [1, 2, 3],
            "discount": [0.0, 0.1, 0.2],
            "channel": ["Web", "Mobile", "Store"],
        }
    )
    revenue_predictions = prediction_grid.assign(
        predicted_revenue=revenue_model.predict(prediction_grid)
    )
    revenue_predictions_inspection = tracepad_marimo.inspect(
        revenue_predictions,
        name="revenue_predictions",
        parents=["revenue_model"],
    )
    revenue_predictions_inspection
    return prediction_grid, revenue_predictions, revenue_predictions_inspection


if __name__ == "__main__":
    app.run()
