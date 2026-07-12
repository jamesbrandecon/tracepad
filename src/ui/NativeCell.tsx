import { useEffect, useRef } from "react";
import type { TracepadNotebookHost } from "../core/host";
import type { TracepadTurn } from "../core/types";

export function NativeCodeEditor({
  host,
  turn,
  onSourceChanged
}: {
  host: TracepadNotebookHost;
  turn: TracepadTurn;
  onSourceChanged: (source: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onSourceChanged);
  changeRef.current = onSourceChanged;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return host.mountCodeEditor(turn, container, source => changeRef.current(source));
  }, [host, turn.id]);

  useEffect(() => {
    host.ensureTurn(turn);
  }, [host, turn.id, turn.code, turn.prompt, turn.language, turn.parentObjectId]);

  return <div className={`tp-native-editor ${turn.language}`} ref={containerRef} />;
}

export function NativeCellOutput({
  host,
  turn,
  hidden
}: {
  host: TracepadNotebookHost;
  turn: TracepadTurn;
  hidden: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return host.mountOutput(turn, container);
  }, [host, turn.id]);

  useEffect(() => {
    host.ensureTurn(turn);
  }, [host, turn.id, turn.code, turn.prompt, turn.language, turn.parentObjectId]);

  return <div className={hidden ? "tp-native-output is-empty" : "tp-native-output"} ref={containerRef} />;
}
