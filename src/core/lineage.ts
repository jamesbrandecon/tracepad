import type { TracepadObject, TracepadState, TracepadTurn } from "./types";

export interface LineageIndex {
  inputsByTurnId: Record<string, string[]>;
  consumersByObjectId: Record<string, string[]>;
  outputObjectByTurnId: Record<string, string>;
  turnByObjectId: Record<string, string>;
}

export function resolveInputObjectIds(
  prompt: string,
  objects: readonly TracepadObject[],
  parentObjectId?: string
): string[] {
  const aliases = new Map(objects.map(object => [object.alias, object.id]));
  const requestedAliases = [...prompt.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(match => match[1]);
  const ids = [
    parentObjectId,
    ...requestedAliases.map(alias => aliases.get(alias))
  ].filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
}

export function inputObjectIdsForTurn(
  turn: TracepadTurn,
  state: Pick<TracepadState, "objects">
): string[] {
  if (turn.inputObjectIds) return [...new Set(turn.inputObjectIds)];
  return resolveInputObjectIds(turn.prompt, Object.values(state.objects), turn.parentObjectId);
}

export function buildLineageIndex(state: TracepadState): LineageIndex {
  const inputsByTurnId: Record<string, string[]> = {};
  const consumersByObjectId: Record<string, string[]> = {};
  const outputObjectByTurnId: Record<string, string> = {};
  const turnByObjectId: Record<string, string> = {};

  for (const object of Object.values(state.objects)) {
    turnByObjectId[object.id] = object.turnId;
  }
  for (const turn of state.turns) {
    const inputs = inputObjectIdsForTurn(turn, state);
    inputsByTurnId[turn.id] = inputs;
    if (turn.outputObjectId) outputObjectByTurnId[turn.id] = turn.outputObjectId;
    for (const objectId of inputs) {
      consumersByObjectId[objectId] ??= [];
      if (!consumersByObjectId[objectId].includes(turn.id)) {
        consumersByObjectId[objectId].push(turn.id);
      }
    }
  }
  return { inputsByTurnId, consumersByObjectId, outputObjectByTurnId, turnByObjectId };
}

export function connectedLineageTurnIds(
  index: LineageIndex,
  focusObjectId: string
): Set<string> {
  const turnIds = new Set<string>();
  const ancestorObjects = new Set<string>();
  const descendantObjects = new Set<string>();

  const visitAncestors = (objectId: string) => {
    if (ancestorObjects.has(objectId)) return;
    ancestorObjects.add(objectId);
    const producer = index.turnByObjectId[objectId];
    if (!producer) return;
    turnIds.add(producer);
    for (const inputId of index.inputsByTurnId[producer] ?? []) visitAncestors(inputId);
  };

  const visitDescendants = (objectId: string) => {
    if (descendantObjects.has(objectId)) return;
    descendantObjects.add(objectId);
    for (const consumer of index.consumersByObjectId[objectId] ?? []) {
      turnIds.add(consumer);
      for (const inputId of index.inputsByTurnId[consumer] ?? []) visitAncestors(inputId);
      const outputId = index.outputObjectByTurnId[consumer];
      if (outputId) visitDescendants(outputId);
    }
  };

  visitAncestors(focusObjectId);
  visitDescendants(focusObjectId);

  return turnIds;
}

export function replaceReferenceAlias(prompt: string, oldAlias: string, nextAlias: string): string {
  const escaped = oldAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return prompt.replace(new RegExp(`@${escaped}\\b`, "g"), `@${nextAlias}`);
}
