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

## Before installing

Tracepad supports current macOS, Linux, and Windows releases. Python 3.9 or
newer is required. The VS Code host additionally requires VS Code 1.95 or
newer, Node.js 22, and either pnpm or Corepack. Bash and PowerShell wrappers
call the same cross-platform Python installers.

Choose one notebook host and one model provider before starting:

| Choice | Use it when |
| --- | --- |
| JupyterLab | You want Tracepad's full-page notebook, inspector, and lineage UI |
| VS Code | You want native VS Code Markdown, code cells, outputs, and commands |
| Ollama | A local Ollama server and model are already installed |
| OpenAI | You have an OpenAI API key and exact model name |
| OpenRouter | You have an OpenRouter key and exact provider/model id |

Tracepad never selects a default model. Both hosts provide an in-product setup
flow for choosing an exact model. An installation agent can clone, build,
launch, and verify Tracepad, but it should not request, echo, or write an API
key. The user enters hosted-provider credentials through Tracepad's model
dialog or VS Code SecretStorage.

### Authenticate to the private repository

The most reliable agent-friendly path uses the GitHub CLI:

```bash
gh auth status
gh repo clone jamesbrandecon/tracepad
cd tracepad
```

SSH is also supported after `ssh -T git@github.com` succeeds:

```bash
git clone git@github.com:jamesbrandecon/tracepad.git
cd tracepad
```

## Install for JupyterLab

Prerequisites: authenticated repository access, Git, and Python 3.9 or newer.
Node and pnpm are not required because the prebuilt JupyterLab extension is
committed to the repository.

macOS or Linux:

```bash
./scripts/install.sh
./scripts/demo.sh
```

Windows PowerShell:

```powershell
.\scripts\install.ps1
.\scripts\demo.ps1
```

If local PowerShell policy blocks repository scripts, first run
`Set-ExecutionPolicy -Scope Process Bypass`. Both installers create `.venv`
and install Tracepad plus the demo dependencies. Both demo commands open
`tracepad_demo.ipynb` in JupyterLab.

Verify the installation without starting another server:

```bash
python3 scripts/verify_install.py       # macOS/Linux
py -3 .\scripts\verify_install.py       # Windows PowerShell
```

The verifier checks the installed Python package, authenticated server
extension, and prebuilt JupyterLab extension. Open an `.ipynb` with
**Tracepad Notebook** or use **Jupyter view** in the Tracepad header to switch
the same document back to the conventional editor.

## Install for VS Code

Prerequisites: authenticated repository access, Git, VS Code 1.95 or newer,
Node.js 22, Corepack, and a working Python/Jupyter kernel. Run these checks
before building:

```bash
code --version
node --version
corepack --version
```

Build and install the private VSIX without using the VS Code GUI.

macOS or Linux:

```bash
./scripts/install_vscode.sh
```

Windows PowerShell:

```powershell
.\scripts\install_vscode.ps1
```

The installer resolves pnpm or Corepack, builds the locked VSIX, installs the
Microsoft Jupyter dependency, and installs Tracepad. Reload VS Code, open an
`.ipynb`, and select `.venv/bin/python` on macOS/Linux or
`.venv\Scripts\python.exe` on Windows as the kernel. Choose **Model** once to
select a provider, exact model, and any required credential. Then choose
**AI Prompt** or begin a Markdown cell with `%%ai`.

![Annotated Tracepad generation flow in VS Code](docs/images/tracepad-vscode-notebook.png)

Use the `Option/Alt+T` chord family:

| Chord | Action |
| --- | --- |
| `G` | Generate code |
| `R` | Generate and run |
| `N` | Generate, run, and add the next prompt |
| `P` | Add a prompt prefilled with `%%ai` |
| `E` | Create a follow-up from the selected result |
| `I` | Insert a prior `@result` reference |
| `L` | Show lineage |
| `A` | Rename the selected result |
| `M` | Set up or change the model |

Generated code is collapsed by default but remains available through VS
Code's native cell expander. See
[`vscode-extension/README.md`](vscode-extension/README.md) for host-specific
details.

Named results can be reused in later English prompts. Tracepad records a stable
runtime mapping and lineage in notebook metadata while users work with names
such as `@orders`. Generated code shows `orders = tracepad_result_1` explicitly;
this creates another reference to the same object and does not copy the data.
Result cards keep **Follow-up** (create an AI child turn) separate from
**Lineage** (navigate inputs and derived results).

![Annotated Tracepad named-result reference flow in VS Code](docs/images/tracepad-vscode-references.png)

## Configure an AI model

Tracepad includes Ollama, OpenAI, and OpenRouter adapters but does not choose a
provider or model. Generation remains disabled until the user selects an exact
model. API keys are never stored in notebooks, settings, or YAML.

For a first run, use the **Model** control in JupyterLab or VS Code. Hosted
providers ask for an exact model and store the key only in the current
Jupyter server process or VS Code SecretStorage. Ollama discovers models from
the local server and also permits manual model entry.

For shared parameters or multiple reusable profiles, optionally create
`tracepad.yaml` beside the notebook. An installation agent may create this
file after the user supplies the provider and model name, but it must leave
credentials out:

```yaml
version: 1
default_profile: analysis

profiles:
  analysis:
    provider: openai
    model: your-exact-model-name
```

Valid provider ids are `ollama`, `openai`, and `openrouter`. Ollama profiles
may also define a local endpoint; hosted providers still require a user-entered
key. Tracepad reads workspace `tracepad.yaml`, the user configuration at
`~/.config/tracepad/config.yaml` on macOS/Linux or
`%APPDATA%\tracepad\config.yaml` on Windows, or the path in
`TRACEPAD_CONFIG`.

### JupyterLab model handoff

1. Start Tracepad with `./scripts/demo.sh` or `.\scripts\demo.ps1`.
2. Select **Model** in the Tracepad header.
3. Choose the provider profile and exact model.
4. The user enters the OpenAI or OpenRouter key when prompted.
5. For Ollama, confirm `ollama serve` is running and select a discovered model.

Values entered in JupyterLab live only in the Jupyter server process.

![Tracepad model setup](docs/images/tracepad-provider-setup.png)

### VS Code model handoff

1. Choose **Model** in the notebook toolbar or run **Tracepad: Set Up Model**.
2. Choose a provider profile and enter or select the exact model.
3. The user enters a hosted-provider key when prompted; VS Code stores it in
   SecretStorage rather than settings, YAML, or notebook metadata.
4. Run **Tracepad: Show Diagnostics** and confirm `Ready: true`.

VS Code remembers non-secret model choices per profile in the workspace or
user settings. `tracepad.yaml` remains the better choice when a team needs
named profiles with shared generation parameters.

Environment variables remain supported for automated or headless setups:
`TRACEPAD_PROFILE`, `TRACEPAD_OPENAI_MODEL`, `TRACEPAD_OLLAMA_MODEL`,
`TRACEPAD_OPENROUTER_MODEL`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and
`OLLAMA_HOST`. A VS Code window launched from the macOS Dock may not inherit
shell variables, so VS Code settings or YAML plus SecretStorage is the
preferred desktop setup.

## Installation success criteria

An agent-assisted setup is complete when:

- the selected host reports the Tracepad extension as installed;
- the demo notebook opens with the expected Tracepad or native VS Code UI;
- a Python kernel containing `ipykernel` can execute an ordinary code cell;
- the selected provider and exact model report ready;
- a `%%ai` prompt generates editable code; and
- the user, not the agent, supplied any hosted-provider credential.

## Report an alpha issue

Open a GitHub bug report and include the smallest reproducible notebook or a
screenshot using synthetic data. In VS Code, run **Tracepad: Show
Diagnostics** and paste its output. In JupyterLab, include the model status and
relevant server log lines. Diagnostics omit API key values, but review local
paths and notebook content before posting.

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
| `scripts/*.py` with `.sh`/`.ps1` wrappers | Cross-platform installation, launch, verification, and packaging |

These files belong to separate packaging layers; none are interchangeable.

## Development

macOS or Linux:

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
pnpm --dir vscode-extension run package
```

On Windows PowerShell, use `.venv\Scripts\python.exe` in place of
`.venv/bin/python`, set `$env:PYTHON = ".venv\Scripts\python.exe"` before
`pnpm build`, and run `.\scripts\build_wheel.ps1` for the wheel. The pnpm
commands themselves are identical across platforms.

GitHub Actions runs builds, tests, executable notebook checks, native installer
smokes, wheel builds, and VSIX packaging on `ubuntu-latest`, `macos-latest`,
and `windows-latest`. Build artifacts under `dist/` are ignored by Git and are
not releases.

## Storage and security

- Prompts, generated code metadata, result names, and lineage are stored in
  standard notebook cells and `metadata.tracepad`.
- API keys stay in the Jupyter server process or VS Code SecretStorage.
- Generated code has the same authority as any code run in the active kernel;
  review it before execution.
- Ollama discovery runs from the Jupyter server or VS Code extension host. On a
  remote machine, `127.0.0.1` refers to that remote machine.
- Do not disable Jupyter authentication on shared or network-accessible hosts.
