<p align="center">
  <img src="media/tracepad-logo.png" alt="Tracepad" width="128" />
</p>

# Tracepad for VS Code

Tracepad adds AI-first analysis turns to VS Code's native Jupyter notebook
editor. It does not replace the notebook renderer, code editor, kernel, or
output system.

Each turn is stored as two ordinary `.ipynb` cells:

1. A Markdown cell containing the English request.
2. A code cell containing editable AI-generated code and normal Jupyter output.

Tracepad metadata connects the pair, gives results stable runtime names, and
records child lineage. Editors without Tracepad still display a valid notebook.

## Install from this repository

Build the private VSIX:

```bash
corepack enable
pnpm install
pnpm --dir vscode-extension package
```

In VS Code, open **Extensions**, select the `...` menu, choose **Install from
VSIX**, and select `vscode-extension/dist/tracepad-vscode.vsix`. The Microsoft
Jupyter extension is required and will be installed as an extension dependency.

For extension development, open `vscode-extension/` in VS Code and press `F5`
after running:

```bash
pnpm install
pnpm --dir vscode-extension build
```

## Configure AI

Tracepad reads the same layered `tracepad.yaml` format as the JupyterLab host.
Copy `../tracepad.example.yaml` to the workspace root as `tracepad.yaml`, then
set credentials in the extension host environment:

```bash
export OPENAI_API_KEY="..."
export OPENROUTER_API_KEY="..."
export TRACEPAD_PROFILE="openai-fast"
```

For local generation, run Ollama and set a model through YAML or:

```bash
export TRACEPAD_PROFILE="ollama"
export TRACEPAD_OLLAMA_MODEL="qwen2.5-coder:7b"
```

Credentials are read from environment variables or VS Code SecretStorage.
They are never written to YAML or notebook metadata. The active provider and
model are always visible in the VS Code status bar. Select that item, choose
**Model** in the notebook toolbar, or run **Tracepad: Select Model** to switch
among configured profiles for the current workspace.

When VS Code was launched from the macOS Dock and does not inherit shell
environment variables, run **Tracepad: Configure Provider Credentials**. Keys
entered there are stored in VS Code SecretStorage, not settings or notebooks.
Run **Tracepad: Show Diagnostics** to inspect configuration discovery and
provider readiness without exposing credential values.

Generation sends the English request and source code for the small, adaptive
set of referenced cells to the selected provider. It does not send saved cell
outputs or table previews automatically.

## Use it

1. Open a Python, R, Julia, or SQL `.ipynb` with a working Jupyter kernel.
2. Select **AI Prompt** in the notebook toolbar, or start any Markdown cell
   with `%%ai`. Write ordinary English beneath the marker. Tracepad does not
   pre-create an empty code cell.
3. Type `@` to see earlier named results, their turn numbers, result kinds, and
   whether they need to be run. Both `@orders` and its numeric turn reference
   (for example `@1`) resolve to the same stable kernel object.
4. Press `Option+T`, then `G` (`Alt+T`, then `G` on Windows/Linux) to generate
   code without running it. After generation,
   Tracepad removes `%%ai`, leaves a plain portable Markdown request, and
   inserts or updates exactly one paired code cell below it.
5. Review or edit the code and use VS Code's normal Run control, or press
   `Option+T`, then `R` on the prompt to generate and run in one action. After a
   successful combined run, Tracepad collapses the code input so the result is
   primary; use the native cell expander to inspect it again. Set
   `tracepad.collapseCodeAfterRun` to `false` to keep it open.
6. Select `@result_name` or press `Option/Alt+T`, then `A`, with its cell
   selected to assign a friendly alias.
7. After a successful output appears, select **Explore**. Tables, models, and
   plots receive different follow-up actions; each creates and generates a
   visibly linked follow-up turn beneath the result.
8. Use `Option+T`, then `N` on a prompt to generate, run, and insert the next `%%ai`
   prompt. If execution fails, **Fix with AI** appears only on that failed
   result. It updates the paired code cell and asks you to run it again.

Regeneration is idempotent: it updates the code cell already paired with the
prompt instead of inserting duplicates. If you edited generated code manually,
Tracepad asks before replacing it. Editing a prompt after generation marks its
code as stale. Generation requests can be cancelled from VS Code's progress UI.

### Keyboard flow

Press `Option+T` on macOS or `Alt+T` on Windows/Linux, release it, then press:

| Second key | Action |
| --- | --- |
| `G` | Generate code |
| `R` | Generate and run |
| `N` | Generate, run, and add the next prompt |
| `P` | Add a new AI prompt |
| `E` | Explore the selected result |
| `I` | Insert a prior result reference |
| `L` | Show result lineage |
| `A` | Rename the selected result alias |
| `M` | Select the model profile |

Tracepad uses a dedicated chord family and does not override Jupyter's normal
execution or editing keys. Commands still validate the selected prompt or
result before acting, and users can override extension defaults in Keyboard
Shortcuts normally.

Typing `@` in a Tracepad prompt opens VS Code's suggestion list with prior
named results. If the host suppresses automatic Markdown suggestions, use
`Option/Alt+T`, then `I`, or select **Reference** on the prompt status bar to
open the same choices explicitly.

Generated metadata records the exact upstream result turns. Prompt status bars
show their inputs, result status bars show downstream use counts, and selecting
either opens a native quick pick that jumps to the connected cell. The notebook
still consists only of Markdown cells, code cells, outputs, and ignorable
metadata when Tracepad is not installed.

Python kernels with the Tracepad wheel installed render data frames, Matplotlib
figures, and model-like objects through a compact custom MIME renderer. The
renderer shows table previews, plot images, coefficients, summaries, and
available methods without changing the underlying object. A kernel without the
runtime helper still runs generated code and falls back to ordinary Jupyter
output.

Open `demo/tracepad-vscode-demo.ipynb` from the repository root for an example.
It reads its bundled `demo/data/retail_orders.csv` and
shows a source table, a named aggregation, and a child visualization.

Select a Python kernel that contains `ipykernel`; repository installs can use
`.venv/bin/python`. The demo bundles its CSV beside the notebook so execution
does not depend on the VS Code workspace's working directory.

## V1 boundaries

- VS Code owns code editing, execution, keyboard behavior, output MIME
  rendering, and notebook persistence.
- The `Option/Alt+T` chord family exposes Tracepad actions without changing
  Jupyter's native `Ctrl+Enter`, `Shift+Enter`, or `Alt+Enter` behavior.
- Exploration is an inline follow-up turn, not a sidebar or custom webview.
- Result names are friendly prompt references; generated code uses stable
  kernel variables such as `tracepad_result_2_1`.
- Kernel objects disappear when the kernel restarts. Re-run ancestor cells to
  recreate them.
- Rich Tracepad cards currently target Python objects. R, Julia, and SQL keep
  their native Jupyter outputs while sharing prompt, model, and lineage UX.
