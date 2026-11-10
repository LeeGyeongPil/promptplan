// PR 코멘트용 Markdown. 첫 줄의 <!-- promptplan --> 표식으로 CI 가 "지난번 코멘트"를 찾아 갱신할 수 있다.
// 요약 표는 바로 보이고, 줄 단위 diff 는 <details> 안에 접어 둔다.

import type { Plan } from "../types.js";
import { plural } from "../util.js";
import { changeHeadline, summaryLine, targetLine, warningText } from "./text.js";

export const MARKER = "<!-- promptplan -->";

const SYMBOL = { create: "+", "new-version": "~", move: ">", unchanged: "=" } as const;

/** 표 칸 안에서 표를 깨는 문자를 막는다. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** 인라인 코드. 이름에 ` 가 있으면 더 긴 따옴표로 감싼다. */
function code(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  return `${fence}${text}${fence}`;
}

/** <summary> 같은 HTML 안에서는 Markdown 이 잘 안 먹으므로 HTML 로 쓴다. */
function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** diff 안에 ``` 가 있어도 코드 블록이 깨지지 않게 더 긴 울타리를 쓴다. */
function fenceFor(lines: string[]): string {
  let fence = "```";
  while (lines.some((line) => line.includes(fence))) fence += "`";
  return fence;
}

export function renderPlanMarkdown(plan: Plan): string {
  const out: string[] = [MARKER, "### promptplan plan", "", `${cell(targetLine(plan))}`, ""];

  if (plan.errors.length > 0) {
    out.push(`**Error: ${plural(plan.errors.length, "problem")} found. Nothing was sent to Langfuse.**`, "");
    for (const error of plan.errors) out.push(`- ${code(error.file)}: ${error.message}`);
    return `${out.join("\n")}\n`;
  }

  out.push(`**${summaryLine(plan)}**`, "");
  out.push("| | Prompt | Change |", "|:-:|---|---|");
  // 표 칸 안에서는 인라인 코드 속 | 도 \| 로 막아야 표가 깨지지 않는다(GFM 규칙).
  for (const change of plan.changes)
    out.push(`| ${code(SYMBOL[change.action])} | ${cell(code(change.name))} | ${cell(changeHeadline(change))} |`);
  out.push("");

  const warnings = plan.changes.flatMap((change) => change.warnings.map((warning) => warningText(change.name, warning)));
  if (warnings.length > 0) {
    out.push("**Warnings**", "");
    for (const warning of warnings) out.push(`- ${warning}`);
    out.push("");
  }

  for (const change of plan.changes) {
    if (change.diff.length === 0) continue;
    const fence = fenceFor(change.diff);
    out.push(`<details><summary><code>${html(change.name)}</code> — ${html(changeHeadline(change))}</summary>`, "");
    out.push(`${fence}diff`, ...change.diff, fence, "", "</details>", "");
  }

  if (plan.unmanaged.length > 0) out.push(`Not in your files (left alone): ${plan.unmanaged.map(code).join(", ")}`, "");
  const s = plan.summary;
  if (s.create + s.newVersion + s.move === 0) out.push("No changes. Langfuse already matches your files.", "");
  while (out.at(-1) === "") out.pop();
  return `${out.join("\n")}\n`;
}
