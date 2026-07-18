import type { TracepadResultKind } from "./turnModel";

export interface FollowUpChoice {
  label: string;
  description: string;
  prompt: string;
}

export function followUpChoices(alias: string, kind: TracepadResultKind): FollowUpChoice[] {
  const choices: FollowUpChoice[] = [{
    label: "$(comment-discussion) Ask a follow-up",
    description: "Write a custom request using this result",
    prompt: ""
  }];
  if (kind === "data") choices.push({
    label: "$(preview) Summarize and diagnose",
    description: "Structure, quality, assumptions, and useful diagnostics",
    prompt: `Using @${alias}, summarize this result and show the most informative diagnostics for its object type.`
  }, {
    label: "$(graph) Visualize",
    description: "Generate an appropriate, reusable plot",
    prompt: `Using @${alias}, create the most informative visualization for this result with clear labels and return the plot object.`
  });
  if (kind === "model") choices.push({
    label: "$(symbol-method) Inspect model",
    description: "Summary, coefficients, fitted values, and prediction support",
    prompt: `Using @${alias}, inspect this model. Show its summary and coefficients, diagnose the fit, and explain what prediction and plotting methods are available.`
  }, {
    label: "$(graph) Plot model diagnostics",
    description: "Create diagnostics appropriate for the fitted model",
    prompt: `Using @${alias}, create and return the most informative diagnostic plot for this fitted model.`
  }, {
    label: "$(symbol-value) Generate predictions",
    description: "Create a reusable prediction result",
    prompt: `Using @${alias}, generate a useful prediction example from the available model data and return the prediction result.`
  });
  if (kind === "plot") choices.push({
    label: "$(preview) Explain and critique",
    description: "Interpret the plot and identify improvements",
    prompt: `Using @${alias}, explain the important patterns in this plot and critique whether it communicates the result clearly.`
  }, {
    label: "$(edit) Revise visualization",
    description: "Generate an improved plot object",
    prompt: `Using @${alias}, revise this visualization for clearer comparison, labeling, and presentation, then return the improved plot object.`
  });
  return choices;
}
