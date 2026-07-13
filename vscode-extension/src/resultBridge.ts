export const TRACEPAD_RESULT_MIME = "application/vnd.tracepad.result+json";
export const TRACEPAD_RESULT_MARKER = "# Tracepad result";

export interface ResultBridgeOptions {
  alias: string;
  runtimeName: string;
}

export function stripResultBridge(source: string): string {
  const marker = source.indexOf(TRACEPAD_RESULT_MARKER);
  if (marker < 0) return source.trimEnd();
  const lineStart = source.lastIndexOf("\n", marker);
  return source.slice(0, lineStart < 0 ? 0 : lineStart).trimEnd();
}

export function appendResultBridge(
  source: string,
  language: string,
  options: ResultBridgeOptions
): string {
  const cleanSource = stripResultBridge(source);
  if (!language.toLowerCase().startsWith("python")) return cleanSource;

  const argumentsValue = [
    options.runtimeName,
    `name=${JSON.stringify(options.alias)}`
  ].join(", ");

  const withoutTrailingResult = cleanSource
    .split("\n")
    .filter((line, index, lines) => index !== lines.length - 1 || line.trim() !== options.runtimeName)
    .join("\n")
    .trimEnd();

  return `${withoutTrailingResult}\n\ntry:  ${TRACEPAD_RESULT_MARKER}
    from tracepad import present
except ImportError:
    present = lambda value, **_: value
present(${argumentsValue})
`;
}
