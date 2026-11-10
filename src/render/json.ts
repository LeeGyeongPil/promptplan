// 기계가 읽는 JSON. planVersion 으로 모양을 약속하고, 키는 정렬해 같은 plan 이면 바이트까지 같게 만든다.
// 절대 경로·포트·시각은 넣지 않는다(파일 경로는 --dir 기준 상대 경로).

import type { Plan } from "../types.js";
import { hasChanges } from "../planner.js";
import { stableStringify } from "../util.js";

export const PLAN_VERSION = 1;

export function renderPlanJson(plan: Plan): string {
  const document = {
    planVersion: PLAN_VERSION,
    target: plan.target,
    labelOverride: plan.labelOverride,
    hasChanges: plan.errors.length === 0 && hasChanges(plan),
    summary: plan.summary,
    errors: plan.errors,
    unmanaged: plan.unmanaged,
    changes: plan.changes.map((change) => ({
      name: change.name,
      file: change.file,
      type: change.type,
      action: change.action,
      targetVersion: change.targetVersion,
      latestVersion: change.latestVersion,
      baselineVersion: change.baselineVersion,
      labels: change.labels,
      labelMoves: change.labelMoves,
      warnings: change.warnings,
      diff: change.diff,
    })),
  };
  return `${stableStringify(document, 2)}\n`;
}
