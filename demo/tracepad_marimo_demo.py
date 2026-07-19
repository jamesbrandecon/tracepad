import marimo

__generated_with = "0.23.14"
app = marimo.App(
    width="full",
    app_title="Tracepad",
    css_file="../style/marimo.css",
)


@app.cell(hide_code=True)
def tracepad_setup():
    import tracepad.marimo as tracepad_marimo

    return (tracepad_marimo,)


@app.cell(hide_code=True)
def tracepad_header(tracepad_marimo):
    tracepad_marimo.notebook_header(
        "Tracepad for Marimo",
        "A reactive retail analysis with named results, lineage, and inspection",
    )
    return


@app.cell(hide_code=True)
def tracepad_ask_1(tracepad_marimo):
    tracepad_marimo.prompt(
        "Load demo/data/retail_orders.csv, parse order_date, and return a useful preview of the orders.",
        number=1,
    )
    return


@app.cell
def _():
    return


@app.cell(hide_code=True)
def tracepad_ask_2(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @orders, summarize monthly net revenue and order count by channel.",
        number=2,
    )
    return


@app.cell
def _():
    return


@app.cell(hide_code=True)
def tracepad_ask_3(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @monthly_revenue, plot net revenue over time with one line per channel.",
        number=3,
    )
    return


@app.cell
def _():
    return


@app.cell(hide_code=True)
def tracepad_ask_4(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @orders, fit an OLS model of revenue on unit price, quantity, discount, and channel, then inspect the fitted model.",
        number=4,
    )
    return


@app.cell
def _():
    return


@app.cell(hide_code=True)
def tracepad_ask_5(tracepad_marimo):
    tracepad_marimo.prompt(
        "Using @revenue_model, predict revenue for a few representative Web, Mobile, and Store orders.",
        number=5,
    )
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
