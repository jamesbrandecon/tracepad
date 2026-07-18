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

  const displayVariable = options.alias;
  const argumentsValue = [
    displayVariable,
    `name=${JSON.stringify(options.alias)}`
  ].join(", ");

  const withoutTrailingResult = cleanSource
    .split("\n")
    .filter((line, index, lines) => index !== lines.length - 1 || line.trim() !== options.runtimeName)
    .join("\n")
    .trimEnd();

  return `${withoutTrailingResult}\n\n${displayVariable} = ${options.runtimeName}  ${TRACEPAD_RESULT_MARKER}: @${options.alias} points to this same object
try:
    from tracepad import present
except ImportError:
    present = lambda value, **_: value
present(${argumentsValue})
`;
}
