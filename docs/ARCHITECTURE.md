# Tracepad architecture

Tracepad is a notebook interface, not a second notebook runtime. Standard
`.ipynb` code cells and their outputs remain the source of truth. Tracepad adds
prompts, result names, object lineage, and inspection metadata around those
cells.

## Layers

### Core

`src/core/` contains the portable domain model, state transitions, and the
`TracepadNotebookHost` contract. It has no React or JupyterLab imports.

The contract covers the capabilities a notebook host must provide:

- read and persist Tracepad metadata;
- synchronize Tracepad turns with ordinary code cells;
- mount the host's native code editor and output renderer;
- execute a cell in the active kernel;
- capture, name, and inspect runtime objects;
- discover and call configured AI providers.

Persisted Tracepad metadata deliberately excludes rendered outputs. Outputs
stay on standard notebook cells so JupyterLab, VS Code, nbconvert, and other
`.ipynb` consumers can read them without Tracepad.

Lineage edges use stable object ids rather than variable names. Each turn
persists `inputObjectIds`, while its output object records the producing turn.
The portable lineage index derives producers, consumers, ancestors, and
descendants from those ids. Prompt parsing is used only to resolve explicit
`@name` references when an edge is created or to migrate older notebooks.

### Jupyter host

`src/jupyter/` implements the host contract with JupyterLab APIs. Each Tracepad
turn maps to one standard code cell. The guided view embeds JupyterLab's native
`CodeCell` editor and a cloned native `OutputArea`; execution uses
`CodeCell.execute` against the notebook's existing kernel.

Hidden object capture and inspection calls use kernel requests without history
entries. They enrich Tracepad's object metadata without adding synthetic cells
or execution numbers to the notebook.

### UI

`src/ui/` and `src/TracepadApp.tsx` contain the thin React presentation layer.
They render prompts, lineage, result actions, provider setup, and inspection
controls. They do not own a code editor, output renderer, kernel, or transport.

## Document invariants

1. A Tracepad turn always has a corresponding standard code cell.
2. The code cell model owns generated and user-edited source.
3. The code cell output model owns execution output.
4. `metadata.tracepad` owns only the information standard notebook cells cannot
   express directly: prompt, result name, stable input object ids, object kind,
   and AI provider.
5. Switching between Tracepad and Jupyter views does not replace the document,
   cell models, or kernel session.

## Adding another notebook host

A VS Code implementation should provide a `TracepadNotebookHost` adapter over
the VS Code Notebook API and use VS Code's native notebook editor and output
renderers. The core types, state rules, prompts, lineage semantics, and server
provider contract can remain shared. Host-specific widget mounting and kernel
execution should remain behind the adapter rather than being added to the React
components.

This division lets each editor retain its native accessibility, keybindings,
mime rendering, extension compatibility, and notebook behavior while Tracepad
keeps one product model across hosts.

See [HOST_ROADMAP.md](HOST_ROADMAP.md) for the staged VS Code extension plan and
the compatibility decision gate for Positron's native notebook editor.
