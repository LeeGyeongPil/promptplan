// 터미널 출력. 기호: + create · ~ new version · > label move · = unchanged · ! warning · x error
// 색은 옵션(TTY 이고 NO_COLOR 가 없을 때만 CLI 가 켠다). golden 테스트는 색 없이 비교한다.

import type { ApplyResult } from "../apply.js";
import type { LabelMove, Plan, PlanWarning, PromptChange } from "../types.js";
import { plural } from "../util.js";

export interface TextOptions {
  color?: boolean;
}

type Paint = (code: string, text: string) => string;

function painter(color: boolean | undefined): Paint {
  return color ? (code, text) => `\u001b[${code}m${text}\u001b[0m` : (_code, text) => text;
}

const SYMBOL: Record<PromptChange["action"], string> = { create: "+", "new-version": "~", move: ">", unchanged: "=" };
const COLOR: Record<PromptChange["action"], string> = { create: "32", "new-version": "33", move: "36", unchanged: "2" };

export function summaryLine(plan: Plan): string {
  const s = plan.summary;
  return `Plan: ${s.create} to create, ${s.newVersion} new version, ${s.move} label move, ${s.unchanged} unchanged`;
}

export function labelsText(labels: string[]): string {
  return labels.length === 0 ? "no labels" : `labels: ${labels.join(", ")}`;
}

export function moveText(move: LabelMove): string {
  return move.from === null ? `${move.label} (new) → v${move.to}` : `${move.label} v${move.from} → v${move.to}`;
}

/** 한 줄 설명: "new version v3 (labels: staging)" 같은 것. */
export function changeHeadline(change: PromptChange): string {
  switch (change.action) {
    case "create":
      return `create v${change.targetVersion} (${labelsText(change.labels)})`;
    case "new-version":
      return `new version v${change.targetVersion} (${labelsText(change.labels)})`;
    case "move":
      return `move ${change.labelMoves.map(moveText).join(", ")}`;
    case "unchanged":
      return `unchanged v${change.targetVersion} (${labelsText(change.labels)})`;
  }
}

export function warningText(name: string, warning: PlanWarning): string {
  return warning.kind === "drift" ? `drift ${name}: ${warning.message}` : `${name}: ${warning.message}`;
}

export function targetLine(plan: Plan): string {
  const labels = plan.labelOverride ? `${plan.labelOverride.join(", ")} (--label)` : "from files";
  return `target: ${plan.target} · labels: ${labels}`;
}

export function renderPlanText(plan: Plan, options: TextOptions = {}): string {
  const paint = painter(options.color);
  const out: string[] = [`promptplan plan · ${targetLine(plan)}`, ""];

  if (plan.errors.length > 0) {
    for (const error of plan.errors) out.push(paint("31", `x ${error.file}: ${error.message}`));
    out.push("");
    out.push(paint("31", `Error: ${plural(plan.errors.length, "problem")} found. Nothing was sent to Langfuse.`));
    return `${out.join("\n")}\n`;
  }

  for (const change of plan.changes) {
    out.push(paint(COLOR[change.action], `${SYMBOL[change.action]} ${change.name}  ${changeHeadline(change)}`));
    for (const line of change.diff) out.push(`    ${paintDiff(paint, line)}`);
    for (const warning of change.warnings) out.push(paint("33", `    ! ${warningText(change.name, warning)}`));
  }
  if (plan.unmanaged.length > 0) {
    out.push("");
    out.push(paint("2", `Not in your files (left alone): ${plan.unmanaged.join(", ")}`));
  }
  out.push("");
  out.push(summaryLine(plan));
  const s = plan.summary;
  if (s.create + s.newVersion + s.move === 0) out.push("No changes. Langfuse already matches your files.");
  return `${out.join("\n")}\n`;
}

function paintDiff(paint: Paint, line: string): string {
  if (line.startsWith("@@")) return paint("36", line);
  if (line.startsWith("---") || line.startsWith("+++")) return paint("1", line);
  if (line.startsWith("+")) return paint("32", line);
  if (line.startsWith("-")) return paint("31", line);
  return line;
}

export function applySummaryLine(result: ApplyResult): string {
  return `Applied: ${plural(result.createdVersions, "created version")}, ${plural(result.labelMoves, "label move")}`;
}

export function renderApplyText(result: ApplyResult, options: TextOptions = {}): string {
  const paint = painter(options.color);
  const out: string[] = [];
  for (const step of result.steps) {
    const what =
      step.action === "move"
        ? `moved ${step.labels.join(", ")} → v${step.version}`
        : `created v${step.version} (${labelsText(step.labels)})`;
    out.push(paint(COLOR[step.action], `${SYMBOL[step.action]} ${step.name}  ${what}`));
  }
  if (result.failed) {
    out.push(paint("31", `x ${result.failed.name}: ${result.failed.message}`));
    out.push("");
    out.push(applySummaryLine(result));
    out.push(paint("31", `Stopped at ${result.failed.name}. Not attempted: ${result.remaining.length ? result.remaining.join(", ") : "(none)"}`));
    out.push("Fix the problem and run apply again — finished prompts will show as unchanged.");
  } else {
    if (out.length > 0) out.push("");
    out.push(applySummaryLine(result));
  }
  return `${out.join("\n")}\n`;
}
