# Tracepad

Tracepad is an AI-first notebook interface for JupyterLab. It keeps work in
ordinary `.ipynb` files while presenting a prompt -> generated code -> kernel
output -> inspect workflow. Python is the complete V1 path; R inspection has an
adapter surface for IRkernel.

Tracepad is distributed from this repository. It is not published to PyPI.

## Tracepad in JupyterLab

![Tracepad running a guided analysis and inspecting the resulting data frame](docs/images/tracepad-guided-notebook.png)

The full-page notebook keeps the prompt, generated code, live kernel output,
named objects, and inspection tools in one document-backed workflow.

![Tracepad AI provider setup for Ollama, OpenAI, and OpenRouter](docs/images/tracepad-provider-setup.png)

Tracepad discovers models from a reachable Ollama server or connects to OpenAI
and OpenRouter with credentials held by the Jupyter server process.

## V1 capabilities

- Opens standard `.ipynb` files directly in a full-page Tracepad view.
- Generates editable code through Ollama, OpenAI, or OpenRouter.
- Executes code in the notebook's real Jupyter kernel.
- Captures tables, plots, models, text, and scalar results.
- Names results and references them in later prompts with `@name`.
- Inspects common model protocols such as `summary`, coefficients, fitted
  values, prediction, and plotting.
- Switches the same document between Tracepad and the conventional Jupyter
  notebook view without replacing the kernel or document context.

## Install from the private repository

Prerequisites: Git, Python 3.9 or newer, and access to this repository.

```bash
git clone git@github.com:jamesbrandecon/tracepad.git
cd tracepad
./scripts/install.sh
```

The installer creates `.venv` and installs Tracepad plus the demo analysis
dependencies from the checked-out source. The prebuilt JupyterLab extension is
included in the repository, so demo users do not need Node or pnpm.

Start the guided demo:

```bash
./scripts/demo.sh
```

Or activate the environment and start Jupyter normally:

```bash
source .venv/bin/activate
jupyter lab
```

Choose **Tracepad Notebook** in the launcher or open any `.ipynb`. Use
**Jupyter view** in the Tracepad header to reveal the conventional editor for
the same notebook.

## Connect an AI provider

Tracepad does not generate template or deterministic fallback code. Generation
is unavailable until one of these providers is ready:

### Ollama

Tracepad checks `http://127.0.0.1:11434` by default and lists models installed
on the Jupyter server machine. Select a detected model or enter a model and
server URL manually.

```bash
export TRACEPAD_PROVIDER=ollama
export OLLAMA_HOST=http://127.0.0.1:11434
export TRACEPAD_OLLAMA_MODEL=qwen2.5-coder:7b
```

### OpenAI

```bash
export TRACEPAD_PROVIDER=openai
export OPENAI_API_KEY="..."
export TRACEPAD_OPENAI_MODEL=gpt-5.4-mini
```

### OpenRouter

```bash
export TRACEPAD_PROVIDER=openrouter
export OPENROUTER_API_KEY="..."
export TRACEPAD_OPENROUTER_MODEL=provider/model-name
```

Provider setup is also available from the Tracepad header. Keys entered there
are held only in the Jupyter server process. Keys are never returned to the
browser, saved in notebook metadata, or written to disk.

When `TRACEPAD_PROVIDER` is omitted, Tracepad selects a reachable Ollama model
first, then a configured OpenAI provider, then a configured OpenRouter provider.

## Demo

`tracepad_demo.ipynb` contains five saved, unexecuted turns over a synthetic
3,000-row CSV:

1. Load `demo/data/retail_orders.csv` as `@orders`.
2. Derive monthly channel metrics as `@monthly_revenue`.
3. Plot the derived result as `@revenue_chart`.
4. Fit a return model as `@return_model`.
5. Create scored examples as `@return_predictions`.

The generated code is visible and editable. Run the turns in order, regenerate
one with the selected provider, inspect the returned model, and follow the
lineage through named references. See [docs/DEMO.md](docs/DEMO.md) for the
walkthrough. `demo/tracepad_demo_clean.ipynb` starts with only the first prompt
for live demonstrations.

Rebuild deterministic demo assets after editing the fixture specification:

```bash
.venv/bin/python scripts/build_demo_assets.py
```

## Development

Developers rebuilding the frontend need Node and pnpm:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install ".[dev,demo]"
pnpm install
PYTHON=.venv/bin/python pnpm build
.venv/bin/python -m pip install -e . --no-deps
pnpm test
.venv/bin/pytest -q
.venv/bin/jupyter lab
```

Build a private wheel for a GitHub release:

```bash
./scripts/build_wheel.sh
```

The wheel is written to `dist/` and contains the prebuilt labextension, server
extension, demo notebooks, and CSV. Upload it to a private GitHub Release; do
not publish it to PyPI.

## Storage and security

- Generated code and Tracepad lineage live under `metadata.tracepad` in the
  notebook; generated code also lives in standard code cells.
- API keys stay server-side. Notebook files record the provider and model used,
  never the key.
- Custom code has the same authority as any code executed in the active Jupyter
  kernel. Review generated code before running it.
- Ollama discovery occurs from the Jupyter server. For remote Jupyter servers,
  `127.0.0.1` means the remote machine rather than the user's laptop.
- Do not disable Jupyter authentication on shared or network-accessible hosts.

## Repository checks

GitHub Actions builds the TypeScript extension, runs frontend and Python tests,
builds the wheel, and uploads it as a private workflow artifact. V1 supports
JupyterLab 4 and Python 3.9 or newer.
