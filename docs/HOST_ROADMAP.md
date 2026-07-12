# Tracepad notebook host roadmap

Tracepad should preserve one `.ipynb` document contract while using each
editor's native notebook controls. JupyterLab remains the reference host. The
initial VS Code host now covers the native turn workflow; Positron support
depends on which extension points its native notebook editor exposes.

## Compatibility tiers

### Tier 1: Tracepad host

A first-class host provides prompt entry, AI generation, native code editing,
native execution and output rendering, object naming, references, and inline
inspection. JupyterLab is the reference Tier 1 host. The initial native VS Code
host implements the core turn workflow without a custom editor.

### Tier 2: Portable notebook

Editors without a Tracepad adapter still open ordinary code cells, markdown,
and MIME outputs. Tracepad metadata may be ignored without breaking execution.
This tier covers Colab, JetBrains notebook editors, static GitHub rendering,
Quarto, nbconvert, and headless notebook runners.

## VS Code plan

Build a VS Code extension rather than a separate desktop application.

### Phase 1: portability package

Status: complete for the V1 metadata, lineage, provider registry, and fixture
contracts. Further package extraction can happen when a third host consumes
the same TypeScript core.

- Move host-neutral state, metadata schemas, prompt context, lineage rules, and
  provider types into a small package shared by JupyterLab and VS Code.
- Remove DOM widget mounting from the domain host contract; keep rendering as a
  host-specific capability.
- Add notebook fixtures that round-trip through `nbformat`, JupyterLab, and the
  VS Code notebook serializer without losing Tracepad metadata.

### Phase 2: native notebook spike

Status: implemented. The extension packages as a private VSIX and keeps the
entire prompt -> code -> run -> output -> child inspection path in VS Code's
native vertical notebook flow.

- Register commands and cell actions against the built-in Jupyter notebook
  editor; do not introduce a side panel as the primary workflow.
- Pair Tracepad prompt metadata with standard code cells and update those cells
  through `WorkspaceEdit`/Notebook API edits.
- Use the selected Jupyter kernel and VS Code's native cell execution and MIME
  renderers.
- Prototype inline prompt and inspection controls with a notebook output
  renderer plus extension-host messaging.
- Keep object capture and inspection requests in the active kernel, using the
  same language adapters and object capability schema as JupyterLab.

The spike succeeds only if prompt -> generated code -> run -> output -> inspect
can remain in the notebook's vertical flow. A command-palette-only or sidebar
experience is not sufficient.

### Phase 3: product extension

Status: in progress. Profile selection, friendly aliases, adaptive references,
child lineage, scoped notebook shortcuts, `%%ai` prompt adoption, guarded
regeneration, cancellable generation, and error repair are present. Python
data/model/plot results use a custom MIME renderer with extension-host actions.
Remote-host testing, additional kernel adapters, and cross-host metadata
migration remain.

- Add profile selection from the shared YAML registry and environment secrets.
- Add reference insertion, child lineage, error repair, and model inspection.
- Package a private VSIX and test local, remote SSH, dev-container, and Jupyter
  server kernels.
- Add migration tests proving that the same notebook can move between VS Code
  and JupyterLab without creating duplicate cells or outputs.

### Custom editor decision gate

A custom webview editor can reproduce Tracepad's JupyterLab composition more
exactly, but it would also own scrolling, editing integration, output rendering,
accessibility, and notebook synchronization. The native spike now supports the
required prompt, keyboard, model-selection, result-rendering, alias, and inline
inspection flow, so a custom editor is deferred. Reopen this decision only if a
validated workflow cannot be expressed through native cells and output
renderers; visual parity alone is not sufficient.

## Positron plan

Positron has two relevant notebook surfaces: its native notebook editor and a
legacy Code OSS notebook editor.

1. Verify the VSIX against Positron's legacy editor. If the required VS Code
   Notebook APIs are compatible, publish the same extension with a tested
   Positron compatibility declaration.
2. Run an API discovery spike for Positron's native editor. Confirm support for
   cell metadata edits, extension commands, output renderers, kernel messaging,
   and inline UI contributions.
3. If those APIs exist, implement a thin Positron host adapter over the shared
   core. Keep Positron's native R/Python kernel selection, data explorer, and
   output rendering.
4. If the native editor does not expose those extension points, retain Tier 2
   file compatibility and recommend either the legacy editor or Tracepad in
   JupyterLab. Do not ship a brittle UI injection layer.

Posit Workbench users who launch JupyterLab can use the existing Tracepad wheel
without waiting for a Positron-specific adapter.

## Acceptance criteria

- One notebook opens and runs unchanged in every supported host.
- Tracepad never persists API keys or duplicate output state.
- Unknown Tracepad metadata is safe to ignore.
- Every Tier 1 host uses its native editor, kernel, keyboard behavior, and MIME
  renderer.
- JupyterLab and VS Code produce equivalent prompt, reference, lineage, and
  inspection semantics even when their visual components differ.
