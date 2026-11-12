// 터미널 출력. 기호: + create · ~ new version · > label move · = unchanged · ! warning · x error
// 색은 옵션(TTY 이고 NO_COLOR 가 없을 때만 CLI 가 켠다). golden 테스트는 색 없이 비교한다.
// 문구는 i18n.ts 의 표에서 가져오고, lang 을 안 주면 영어다(기존 출력과 같다).

import type { ApplyResult } from "../apply.js";
import { countMsg, fmt, t, type Lang, type Msg } from "../i18n.js";
import type { LabelMove, Plan, PlanError, PlanWarning, PromptChange } from "../types.js";

export interface TextOptions {
  color?: boolean;
  /** 화면 언어(기본 en) */
  lang?: Lang;
}

type Paint = (code: string, text: string) => string;

function painter(color: boolean | undefined): Paint {
  return color ? (code, text) => `\u001b[${code}m${text}\u001b[0m` : (_code, text) => text;
}

const SYMBOL: Record<PromptChange["action"], string> = { create: "+", "new-version": "~", move: ">", unchanged: "=" };
const COLOR: Record<PromptChange["action"], string> = { create: "32", "new-version": "33", move: "36", unchanged: "2" };

/** 오류·경고의 표시 문장: i18n 정보가 있으면 고른 언어로, 없으면 원래 message. */
export function itemText(item: { message: string; i18n?: Msg | undefined }, lang: Lang = "en"): string {
  return item.i18n ? fmt(lang, item.i18n) : item.message;
}

export function errorText(error: PlanError, lang: Lang = "en"): string {
  return itemText(error, lang);
}

export function summaryLine(plan: Plan, lang: Lang = "en"): string {
  const s = plan.summary;
  return t(lang, "render.summary", {
    create: s.create,
    newVersion: countMsg("newVersion", s.newVersion),
    labelMove: countMsg("labelMove", s.move),
    unchanged: s.unchanged,
  });
}

export function labelsText(labels: string[], lang: Lang = "en"): string {
  return labels.length === 0 ? t(lang, "render.labelsNone") : t(lang, "render.labelsList", { list: labels.join(", ") });
}

export function moveText(move: LabelMove, lang: Lang = "en"): string {
  return move.from === null
    ? t(lang, "render.moveNew", { label: move.label, to: move.to })
    : t(lang, "render.move", { label: move.label, from: move.from, to: move.to });
}

/** 한 줄 설명: "new version v3 (labels: staging)" 같은 것. */
export function changeHeadline(change: PromptChange, lang: Lang = "en"): string {
  const labels = labelsText(change.labels, lang);
  switch (change.action) {
    case "create":
      return t(lang, "render.headCreate", { version: change.targetVersion, labels });
    case "new-version":
      return t(lang, "render.headNewVersion", { version: change.targetVersion, labels });
    case "move":
      return t(lang, "render.headMove", { moves: change.labelMoves.map((move) => moveText(move, lang)).join(", ") });
    case "unchanged":
      return t(lang, "render.headUnchanged", { version: change.targetVersion, labels });
  }
}

export function warningText(name: string, warning: PlanWarning, lang: Lang = "en"): string {
  const message = itemText(warning, lang);
  return t(lang, warning.kind === "drift" ? "render.warnDrift" : "render.warnOther", { name, message });
}

/** 대상 설명(연결 종류). 현지화 정보가 없으면 plan.target 그대로. */
export function targetName(plan: Plan, lang: Lang = "en"): string {
  return plan.targetMsg ? fmt(lang, plan.targetMsg) : plan.target;
}

export function targetLine(plan: Plan, lang: Lang = "en"): string {
  const labels = plan.labelOverride
    ? t(lang, "render.labelsOverride", { labels: plan.labelOverride.join(", ") })
    : t(lang, "render.labelsFromFiles");
  return t(lang, "render.target", { target: targetName(plan, lang), labels });
}

export function errorsFoundLine(plan: Plan, lang: Lang = "en"): string {
  return t(lang, "render.errorsFound", { problems: countMsg("problem", plan.errors.length) });
}

export function renderPlanText(plan: Plan, options: TextOptions = {}): string {
  const paint = painter(options.color);
  const lang = options.lang ?? "en";
  const out: string[] = [`promptplan plan · ${targetLine(plan, lang)}`, ""];

  if (plan.errors.length > 0) {
    for (const error of plan.errors)
      out.push(paint("31", t(lang, "render.errorLine", { file: error.file, message: errorText(error, lang) })));
    out.push("");
    out.push(paint("31", errorsFoundLine(plan, lang)));
    return `${out.join("\n")}\n`;
  }

  for (const change of plan.changes) {
    out.push(paint(COLOR[change.action], `${SYMBOL[change.action]} ${change.name}  ${changeHeadline(change, lang)}`));
    for (const line of change.diff) out.push(`    ${paintDiff(paint, line)}`);
    for (const warning of change.warnings) out.push(paint("33", `    ! ${warningText(change.name, warning, lang)}`));
  }
  if (plan.unmanaged.length > 0) {
    out.push("");
    out.push(paint("2", t(lang, "render.unmanaged", { list: plan.unmanaged.join(", ") })));
  }
  out.push("");
  out.push(summaryLine(plan, lang));
  const s = plan.summary;
  if (s.create + s.newVersion + s.move === 0) out.push(t(lang, "render.noChanges"));
  return `${out.join("\n")}\n`;
}

function paintDiff(paint: Paint, line: string): string {
  if (line.startsWith("@@")) return paint("36", line);
  if (line.startsWith("---") || line.startsWith("+++")) return paint("1", line);
  if (line.startsWith("+")) return paint("32", line);
  if (line.startsWith("-")) return paint("31", line);
  return line;
}

export function applySummaryLine(result: ApplyResult, lang: Lang = "en"): string {
  return t(lang, "render.applied", {
    created: countMsg("createdVersion", result.createdVersions),
    moves: countMsg("labelMove", result.labelMoves),
  });
}

export function renderApplyText(result: ApplyResult, options: TextOptions = {}): string {
  const paint = painter(options.color);
  const lang = options.lang ?? "en";
  const out: string[] = [];
  for (const step of result.steps) {
    const what =
      step.action === "move"
        ? t(lang, "render.moved", { labels: step.labels.join(", "), version: step.version })
        : t(lang, "render.created", { version: step.version, labels: labelsText(step.labels, lang) });
    out.push(paint(COLOR[step.action], `${SYMBOL[step.action]} ${step.name}  ${what}`));
  }
  if (result.failed) {
    out.push(paint("31", t(lang, "render.errorLine", { file: result.failed.name, message: itemText(result.failed, lang) })));
    out.push("");
    out.push(applySummaryLine(result, lang));
    const list = result.remaining.length ? result.remaining.join(", ") : t(lang, "render.none");
    out.push(paint("31", t(lang, "render.stopped", { name: result.failed.name, list })));
    out.push(t(lang, "render.fixAndRerun"));
  } else {
    if (out.length > 0) out.push("");
    out.push(applySummaryLine(result, lang));
  }
  return `${out.join("\n")}\n`;
}
