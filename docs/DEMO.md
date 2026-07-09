# Demo walkthrough

Open `tracepad_demo.ipynb` through `./scripts/demo.sh`. Tracepad should open as
the notebook view automatically.

## Provider setup

1. Select the AI status control in the Tracepad header.
2. Use a detected Ollama model, or enter an OpenAI/OpenRouter key and model.
3. Keys entered in the interface remain in the Jupyter server process only.

## Guided sequence

Run the five saved turns from top to bottom:

1. Load and inspect the 3,000-row retail order table as `@orders`.
2. Derive `@monthly_revenue` from the loaded table.
3. Render `@revenue_chart` from the monthly result.
4. Fit and inspect `@return_model`.
5. Use the model and source table to create `@return_predictions`.

The code is intentionally saved but unexecuted. A presenter can run it as
written, edit it, or select **Generate** to ask the active model for a new
implementation of the same prompt.

Use `demo/tracepad_demo_clean.ipynb` for a live build. It contains only the
first prompt and requires generation before execution.
