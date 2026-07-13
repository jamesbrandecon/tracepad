<p align="center">
  <img src="docs/images/tracepad-logo.png" alt="Tracepad" width="144" />
</p>

# Tracepad

Tracepad adds an AI-first analysis flow to standard `.ipynb` notebooks:
plain-English request -> editable generated code -> native kernel output ->
inspection and follow-up. Result names such as `@orders` make dependencies
explicit and let Tracepad preserve lineage across the notebook.

> **Private pre-release.** Tracepad is installed from this repository. It is
> not published to PyPI or the VS Code Marketplace, and its interfaces may
> still change.

## Notebook hosts

| Host | Experience |
| --- | --- |
| JupyterLab | Full-page Tracepad notebook with inline inspection and lineage |
| VS Code | Native Markdown prompts, code cells, outputs, and Tracepad command chords |

Both hosts edit ordinary `.ipynb` files and use the notebook's real kernel.
Generated code remains visible to other notebook editors even when Tracepad is
not installed.

![Tracepad running an analysis and inspecting the resulting data frame](docs/images/tracepad-guided-notebook.png)

Tracepad currently provides its richest inspection for Python tables, plots,
and model-like objects. It can detect common methods such as `summary`,
coefficients, fitted values, prediction, and plotting. R, Julia, and SQL retain
their native notebook outputs while sharing the prompt and lineage workflow.

## Install for JupyterLab

Prerequisites: Git, Python 3.9 or newer, and access to this repository.

```bash
git clone git@github.com:jamesbrandecon/tracepad.git
cd tracepad
./scripts/install.sh
source .venv/bin/activate
jupyter lab
```

Open an `.ipynb` with **Tracepad Notebook** or use **Jupyter view** in the
Tracepad header to switch the same document back to the conventional editor.
The prebuilt JupyterLab extension is committed to the repository, so users do
not need Node or pnpm.

## Configure an AI model

Tracepad includes adapters for Ollama, OpenAI, and OpenRouter, but **does not
choose a default model**. Generation remains unavailable until the user
selects a provider and supplies an exact model name. API keys are never stored
in notebooks or YAML.

### JupyterLab

Select the model control in the Tracepad header. Choose a provider, enter the
model name, and provide a key when required. For Ollama, Tracepad queries the
configured server for installed models; the user still chooses which model to
use. Values entered here live only in the Jupyter server process.

![Tracepad model setup](docs/images/tracepad-provider-setup.png)

### VS Code

Use **Tracepad: Select Model** and **Tracepad: Configure Provider Credentials**.
Credentials entered through VS Code are stored in SecretStorage. Supply the
model name through environment variables:

```bash
# OpenAI
export TRACEPAD_PROFILE=openai
export TRACEPAD_OPENAI_MODEL="your-model-name"
export OPENAI_API_KEY="..."

# Ollama
export TRACEPAD_PROFILE=ollama
export TRACEPAD_OLLAMA_MODEL="your-installed-model"
export OLLAMA_HOST="http://127.0.0.1:11434"
```

OpenRouter uses `TRACEPAD_PROFILE=openrouter`, `TRACEPAD_OPENROUTER_MODEL`, and
`OPENROUTER_API_KEY`.

For multiple named models, put a small `tracepad.yaml` in the workspace:

```yaml
version: 1
default_profile: analysis

profiles:
  analysis:
    provider: openai
    model: your-model-name
```

The provider ids `ollama`, `openai`, and `openrouter` are built in. YAML is
only needed for named profiles, shared team configuration, or a custom
OpenAI-compatible endpoint. Tracepad also reads
`~/.config/tracepad/config.yaml`; `TRACEPAD_CONFIG` can point to another file.

## Install for VS Code

The VS Code host uses the native Notebook API rather than a custom webview.
Build the private VSIX from the repository:

![A Tracepad AI prompt followed by generated Python and native table output in VS Code](docs/images/tracepad-vscode-notebook.png)

```bash
corepack enable
pnpm install
pnpm --dir vscode-extension package
```

In VS Code, open **Extensions**, select the `...` menu, choose **Install from
VSIX**, and select `vscode-extension/dist/tracepad-vscode.vsix`. The Microsoft
Jupyter extension is required.

Create a prompt with **AI Prompt** or begin a Markdown cell with `%%ai`. Use
the `Option/Alt+T` chord family:

| Chord | Action |
| --- | --- |
| `G` | Generate code |
| `R` | Generate and run |
| `N` | Generate, run, and add the next prompt |
| `P` | Add a prompt |
| `E` | Explore the selected result |
| `I` | Insert a prior `@result` reference |
| `L` | Show lineage |
| `A` | Rename the selected result |
| `M` | Select the model profile |

Generated code is collapsed by default but remains available through VS
Code's native cell expander. See
[`vscode-extension/README.md`](vscode-extension/README.md) for host-specific
details.

## Repository layout

| Path | Why it exists |
| --- | --- |
| `pyproject.toml` | Python package, Jupyter server extension, wheel contents, and Python dependencies |
| `package.json` / `tsconfig.json` | JupyterLab frontend package and TypeScript build |
| `pnpm-workspace.yaml` | Includes the VS Code package in the shared pnpm workspace and records native-build policy |
| `pnpm-lock.yaml` | Reproducible frontend and extension dependencies for local builds and CI |
| `jupyter-config/jupyter_server_config.d/tracepad.json` | Auto-enables Tracepad's authenticated server endpoints when the wheel is installed |
| `style/index.css` | JupyterLab's conventional stylesheet entrypoint and Tracepad UI rules |
| `tracepad/labextension/` | Prebuilt JupyterLab bundle used by repository and wheel installs |
| `vscode-extension/` | Native VS Code notebook host and VSIX package |

These files belong to separate packaging layers; none are interchangeable.

## Development

```bash
python3 -m venv .venv
.venv/bin/python -m pip install ".[dev,demo]"
pnpm install
PYTHON=.venv/bin/python pnpm build
pnpm test
pnpm --dir vscode-extension check
pnpm --dir vscode-extension test
.venv/bin/pytest -q
```

Build local artifacts without publishing them:

```bash
./scripts/build_wheel.sh
pnpm --dir vscode-extension package
```

GitHub Actions runs the same builds and tests. Build artifacts under `dist/`
are ignored by Git and are not releases.

## Storage and security

- Prompts, generated code metadata, result names, and lineage are stored in
  standard notebook cells and `metadata.tracepad`.
- API keys stay in the Jupyter server process or VS Code SecretStorage.
- Generated code has the same authority as any code run in the active kernel;
  review it before execution.
- Ollama discovery runs from the Jupyter server or VS Code extension host. On a
  remote machine, `127.0.0.1` refers to that remote machine.
- Do not disable Jupyter authentication on shared or network-accessible hosts.
