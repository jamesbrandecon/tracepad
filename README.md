<p align="center">
  <img src="docs/images/tracepad-logo.png" alt="Tracepad" width="144" />
</p>

# Tracepad

Tracepad is an AI-first analysis layer for ordinary `.ipynb` notebooks. Its
JupyterLab and VS Code hosts present the same prompt -> generated code ->
kernel output -> inspect workflow while retaining each editor's native code,
execution, and output behavior. Python is the complete V1 inspection path; R
inspection has an adapter surface for IRkernel.

Tracepad is distributed from this repository. It is not published to PyPI.

## Choose a host

| Host | Best for | Interface |
| --- | --- | --- |
| JupyterLab | The complete Tracepad experience | Full-page AI notebook with inline inspection and lineage |
| VS Code | Working inside an existing native notebook editor | Markdown prompts, generated code cells, rich outputs, and Tracepad command chords |

Both hosts edit the same standard notebook format and share result names,
references, lineage metadata, provider profiles, and Python inspection runtime.

## Tracepad in JupyterLab

![Tracepad running a guided analysis and inspecting the resulting data frame](docs/images/tracepad-guided-notebook.png)

The full-page notebook keeps the prompt, generated code, live kernel output,
named objects, and inspection tools in one document-backed workflow. Every
result also shows its direct inputs and downstream consumers. Select **Focus
lineage** to isolate that result's ancestors and descendants, then use any
`@name` chip to jump to the cell that created or consumed it.

![Tracepad AI provider setup for Ollama, OpenAI, and OpenRouter](docs/images/tracepad-provider-setup.png)

Tracepad discovers models from a reachable Ollama server and loads named model
profiles for OpenAI, OpenRouter, or other OpenAI-compatible endpoints. All
credentials remain in the Jupyter server process.

## V1 capabilities

- Opens standard `.ipynb` files directly in a full-page Tracepad view.
- Generates editable code through Ollama, OpenAI, or OpenRouter.
- Executes code in the notebook's real Jupyter kernel.
- Captures tables, plots, models, text, and scalar results.
- Names results and references them in later prompts with `@name`.
- Persists stable result dependencies, displays direct **Uses**/**Used by**
  links, and focuses a branch without losing unrelated notebook work.
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

## Install the VS Code extension

The VS Code host is a native notebook extension, not a React webview. It stores
each Tracepad turn as a Markdown request followed by a standard code cell, then
uses the Microsoft Jupyter extension for execution and rich output.

```bash
corepack enable
pnpm install
pnpm --dir vscode-extension package
```

In VS Code, open **Extensions**, select the `...` menu, choose **Install from
VSIX**, and select `vscode-extension/dist/tracepad-vscode.vsix`. Open
`vscode-extension/demo/tracepad-vscode-demo.ipynb` from the repository root to
try the saved retail sequence.

Use **AI Prompt** in the notebook toolbar or begin any Markdown cell with
`%%ai`, then type plain English. Press `Option/Alt+T`, release it, and press
`G` to generate, `R` to generate and run, or `N` to generate, run, and insert
the next prompt. Typing `@` offers prior result names; `Option/Alt+T`, then `A`
renames the selected result. Tracepad updates the paired code cell on
regeneration, warns before overwriting manual edits, records clickable lineage,
and offers AI repair only after a kernel error.
The active provider and model appear in the VS Code status bar and can be
changed from there or from **Model** in the notebook toolbar. Python tables,
plots, and model-like objects receive compact Tracepad output cards; **Explore**
creates object-aware inline follow-ups. See
[`vscode-extension/README.md`](vscode-extension/README.md) for configuration,
development, and V1 boundaries.

## Configure AI models

Tracepad does not generate deterministic fallback code. Generation is
unavailable until a named model profile is ready. Non-secret provider and model
settings can be kept in YAML; credentials are read from environment variables.

Start with the repository example:

```bash
cp tracepad.example.yaml tracepad.yaml
export OPENAI_API_KEY="..."
export TRACEPAD_PROFILE=openai-fast
```

Tracepad loads configuration in this order, with later layers taking
precedence:

1. Built-in Ollama, OpenAI, and OpenRouter defaults.
2. `~/.config/tracepad/config.yaml` user configuration.
3. `tracepad.yaml` in the Jupyter server's working directory.
4. The file selected by `TRACEPAD_CONFIG`.
5. Model, profile, endpoint, and credential environment variables.
6. Process-local choices entered through the Tracepad model setup dialog.

YAML has two layers:

- **Providers** define an adapter, endpoint, credential environment variable,
  and optional model discovery.
- **Profiles** define a user-facing model choice and its request parameters.

```yaml
version: 1
default_profile: team-coder

providers:
  team-gateway:
    label: Team gateway
    driver: openai-chat
    base_url: https://models.example.com/v1
    api_key_env: TEAM_MODEL_API_KEY

profiles:
  team-coder:
    label: Team coding model
    provider: team-gateway
    model: organization/coder
    parameters:
      temperature: 0.1
      max_tokens: 1800
      response_format:
        type: json_object
```

Supported adapters are `openai-responses`, `openai-chat`, and `ollama-chat`.
Profile parameters are passed to the selected adapter; protected request fields
such as the model, messages, instructions, and notebook context cannot be
overridden. Setting an optional parameter to `null` removes Tracepad's default
for providers that do not support it.

Ollama model discovery still defaults to `http://127.0.0.1:11434`. Existing
`TRACEPAD_PROVIDER`, `TRACEPAD_*_MODEL`, `OLLAMA_HOST`, `OPENAI_API_KEY`, and
`OPENROUTER_API_KEY` settings remain supported. See
[`tracepad.example.yaml`](tracepad.example.yaml) and [`.env.example`](.env.example)
for complete examples.

Keys entered in the setup dialog are held only in the Jupyter server process.
Keys are never returned to the browser, saved in notebook metadata, or written
to YAML or disk.

## Demo

`tracepad_demo.ipynb` contains five saved turns over a synthetic
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

Tracepad keeps its product model separate from notebook-host APIs and embeds
JupyterLab's native editor and output renderer rather than maintaining its own.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layer boundaries,
document invariants, and the path to another host adapter. The staged VS Code
extension and Positron compatibility plan is in
[docs/HOST_ROADMAP.md](docs/HOST_ROADMAP.md).

Developers rebuilding the frontend need Node and pnpm:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install ".[dev,demo]"
pnpm install
PYTHON=.venv/bin/python pnpm build
.venv/bin/python -m pip install -e . --no-deps
pnpm test
pnpm --dir vscode-extension check
pnpm --dir vscode-extension test
pnpm --dir vscode-extension package
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
- API keys stay in the Jupyter server process or VS Code SecretStorage.
  Notebook files record the provider and model used, never the key.
- YAML files contain provider metadata and the names of credential environment
  variables, not credentials themselves.
- Custom code has the same authority as any code executed in the active Jupyter
  kernel. Review generated code before running it.
- Ollama discovery occurs from the Jupyter server. For remote Jupyter servers,
  `127.0.0.1` means the remote machine rather than the user's laptop.
- Do not disable Jupyter authentication on shared or network-accessible hosts.

## Repository checks

GitHub Actions builds both TypeScript hosts, runs frontend, VS Code, and Python
tests, builds the wheel and VSIX, and uploads both as private workflow
artifacts. V1 supports JupyterLab 4, VS Code 1.95 or newer, and Python 3.9 or
newer.
