// apply — plan 에 적힌 요청만 순서대로 보낸다.
//   create / new-version → POST /api/public/v2/prompts (새 버전 + 원하는 라벨)
//   move                 → PATCH /api/public/v2/prompts/{name}/versions/{v} (newLabels)
//   unchanged            → 아무것도 보내지 않는다
// 첫 오류에서 멈추고, 끝난 것과 남은 것을 돌려준다(반쯤 적용된 상태를 사람이 알 수 있게).

import type { PromptApi } from "./client.js";
import type { Plan, PromptChange } from "./types.js";
import { COMMIT_PREFIX, commitMessageProblem } from "./validate.js";

export interface ApplyOptions {
  /** --message. 없으면 파일의 commitMessage → GITHUB_SHA → "apply" 순서 */
  message?: string;
  /** 환경 변수(테스트에서 CI 값의 영향을 받지 않게 명시적으로 넘긴다) */
  env?: Record<string, string | undefined>;
  /** 요청 하나가 끝날 때마다 불린다(진행 표시용) */
  onStep?: (step: AppliedStep) => void;
}

export interface AppliedStep {
  name: string;
  action: PromptChange["action"];
  /** 실제로 만들어지거나 라벨이 붙은 버전 */
  version: number;
  labels: string[];
}

export interface ApplyResult {
  steps: AppliedStep[];
  createdVersions: number;
  labelMoves: number;
  /** 실패했으면 어느 프롬프트에서 무슨 오류였는지 */
  failed: { name: string; message: string } | null;
  /** 실패 때문에 보내지 못한 프롬프트 이름 */
  remaining: string[];
}

/** commitMessage 를 만든다. "[promptplan] " 표식이 드리프트 판정의 근거다. */
export function commitMessageFor(fileMessage: string | undefined, options: ApplyOptions): string {
  const sha = options.env?.["GITHUB_SHA"];
  const detail = options.message ?? fileMessage ?? (sha ? `apply ${sha.slice(0, 7)}` : "apply");
  return COMMIT_PREFIX + detail;
}

export async function applyPlan(plan: Plan, api: PromptApi, options: ApplyOptions = {}): Promise<ApplyResult> {
  if (plan.errors.length > 0) throw new Error(`plan has ${plan.errors.length} error(s); nothing was applied`);
  if (options.message !== undefined) {
    const issue = commitMessageProblem(COMMIT_PREFIX + options.message);
    if (issue) throw new Error(`--message: ${issue}`);
  }

  const todo = plan.changes.filter((change) => change.request !== null);
  const result: ApplyResult = { steps: [], createdVersions: 0, labelMoves: 0, failed: null, remaining: [] };

  for (const [index, change] of todo.entries()) {
    const request = change.request;
    if (!request) continue;
    try {
      let step: AppliedStep;
      if (request.kind === "create") {
        const created = await api.createPrompt({ ...request.body, commitMessage: commitMessageFor(request.commitMessage, options) });
        result.createdVersions++;
        step = { name: change.name, action: change.action, version: created.version, labels: request.body.labels };
      } else {
        await api.updateLabels(change.name, request.version, request.newLabels);
        result.labelMoves++;
        step = { name: change.name, action: change.action, version: request.version, labels: request.newLabels };
      }
      result.steps.push(step);
      options.onStep?.(step);
    } catch (error) {
      result.failed = { name: change.name, message: (error as Error).message };
      result.remaining = todo.slice(index + 1).map((c) => c.name);
      break;
    }
  }
  return result;
}
