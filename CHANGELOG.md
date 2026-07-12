# Changelog

## Unreleased

- Added the Tracepad logo to repository and VS Code branding and aligned the
  JupyterLab interface with the product's cobalt, rust, and gold palette.
- Restored rich table rendering for legacy preview dictionaries and instructed
  AI providers to bind reusable data objects instead of ad hoc summaries.
- Fixed VS Code result discovery by adapting Tracepad metadata to both Jupyter
  serializer wrappers used for portable `.ipynb` cell metadata.
- Forced `@` completion inside VS Code Markdown notebook editors and added an
  explicit reference picker at `Option/Alt+T`, then `I`.
- Moved VS Code actions to the `Option/Alt+T` chord family so Tracepad no
  longer overrides standard Jupyter execution or editing keys.
- Added native VS Code `%%ai` Markdown prompts with `Ctrl+Enter`, `Shift+Enter`,
  and `Alt+Enter` notebook semantics.
- Added idempotent prompt/code pairing, stale-code indicators, guarded
  regeneration, cancellable model requests, and error-specific AI repair.
- Added explicit-only generation context, numeric turn references, dependency
  readiness checks, and clickable upstream/downstream lineage navigation.
- Added layered YAML configuration for providers and named model profiles.
- Added generic OpenAI-compatible chat, OpenAI Responses, and Ollama adapters.
- Added environment-only credential references and profile-aware model setup.
- Isolated the portable notebook core from JupyterLab's native editor/output host.
- Added a native VS Code extension using paired Markdown prompt and Jupyter
  code cells rather than a custom webview.
- Added VS Code model profile selection, adaptive `@` references, stable result
  names, child lineage, and inline AI-generated inspection turns.
- Added an executable VS Code retail demo, unit tests, and private VSIX build.
- Replaced blank child cells with an object-aware Explore workflow that gathers
  a request, generates the linked follow-up, and appears only after execution.
- Simplified VS Code cell chrome and rendered prompt lineage as compact Ask and
  Follow-up blocks inside the notebook flow.
- Added stable object-id lineage metadata and a host-neutral producer/consumer
  index.
- Added JupyterLab **Uses**/**Used by** navigation, branch-specific lineage
  focus, alias-safe provenance, and responsive lineage rails.

## VS Code 0.1.3

- Added diagnostics and VS Code SecretStorage credentials for GUI-launched
  provider access.
- Fixed configuration discovery for notebooks opened outside the active
  workspace and migrated empty legacy code cells to prompt-only turns.
- Made the packaged demo CSV path independent of the active workspace.

## VS Code 0.1.4

- Replaced the ambiguous icon-only new-turn action with visible Tracepad text.
- Migrated every empty paired code cell back to a prompt-only turn so VS Code's
  native Copilot cell generator cannot be mistaken for Tracepad.

## VS Code 0.1.2

- Changed new turns to begin with one plain Markdown prompt and defer code-cell
  creation until AI generation succeeds.
- Added scoped `Ctrl+Enter` generation, `@result` completion, and explicit
  result rename controls.

## VS Code 0.1.1

- First native-notebook interaction cleanup for hands-on VS Code testing.

## 0.1.0 - V1 candidate

- Added a native full-page Tracepad document view for standard `.ipynb` files.
- Added server-side Ollama, OpenAI, and OpenRouter generation providers.
- Added automatic Ollama discovery and a first-run provider setup interface.
- Added prompt, editable code, kernel execution, object references, lineage, and inspection.
- Added a reproducible 3,000-row retail demo with guided and clean notebooks.
- Added repository installation scripts, a private wheel build, and CI checks.
