// plan 계산 — 파일(원하는 모습)과 Langfuse(지금 모습)를 비교해 프롬프트마다 할 일 하나를 정한다.
//
// 핵심 규칙(프롬프트마다 "목표 버전" 하나):
//   1. 후보 = 최신 버전 ∪ 지금 라벨이 붙어 있는 버전들
//   2. 파일 내용(본문 + config + type)이 후보 중 하나와 같으면 그 버전이 목표
//        → 빠진 라벨만 PATCH 로 옮긴다(> move). 다 붙어 있으면 = unchanged
//   3. 같은 게 없으면 새 버전을 POST 하고 원하는 라벨을 전부 붙인다(~ new version)
//   4. 원격에 없으면 + create
// Langfuse 는 내용이 같아도 POST 마다 새 버전을 만들기 때문에, 이 비교가 곧 멱등성이다.

import type { PromptApi } from "./client.js";
import { unifiedDiff } from "./diff.js";
import { configLines, contentKey, promptLines } from "./normalize.js";
import type {
  LabelMove,
  Plan,
  PlanError,
  PlanWarning,
  PromptChange,
  PromptSpec,
  RemotePrompt,
  RemotePromptMeta,
} from "./types.js";
import { byCodepoint, mapLimit, sortedUnique, stableStringify } from "./util.js";
import { compareSlots, extractSlots } from "./variables.js";
import { COMMIT_PREFIX, labelProblem, validateAgainstRemote, validateSpecs } from "./validate.js";

export interface PlanOptions {
  /** 사람이 읽는 대상 설명(포트·경로 없이). 예: "practice mock (--mock-state)" */
  target: string;
  /** --label 로 준 라벨들. 있으면 파일의 labels 대신 모든 프롬프트에 이 라벨을 쓴다(승격용) */
  labelOverride?: string[] | null;
  /** 원격 조회 동시 개수(기본 4 — Langfuse Cloud 요청 한도를 생각해 작게) */
  concurrency?: number;
}

export async function createPlan(
  specs: PromptSpec[],
  loadErrors: PlanError[],
  api: PromptApi,
  options: PlanOptions,
): Promise<Plan> {
  const labelOverride = options.labelOverride && options.labelOverride.length > 0 ? sortedUnique(options.labelOverride) : null;

  // 1) 파일만 보고 알 수 있는 오류
  const errors: PlanError[] = [...loadErrors, ...validateSpecs(specs, labelOverride)];
  for (const label of labelOverride ?? []) {
    const issue = labelProblem(label);
    if (issue) errors.push({ name: "--label", file: "--label", message: issue });
  }

  // 2) 원격 목록 — 타입 변경 검사와 "관리 밖 프롬프트" 계산에 쓴다
  const metas = await api.listPrompts();
  const metaByName = new Map(metas.map((meta) => [meta.name, meta]));
  for (const spec of specs) errors.push(...validateAgainstRemote(spec, metaByName.get(spec.name)));

  const managed = new Set(specs.map((spec) => spec.name));
  const unmanaged = metas
    .map((meta) => meta.name)
    .filter((name) => !managed.has(name))
    .sort(byCodepoint);

  // 오류가 하나라도 있으면 원격을 바꿀 계획을 만들지 않는다(apply 가 아무것도 보내지 않게).
  if (errors.length > 0) {
    return {
      target: options.target,
      labelOverride,
      changes: [],
      unmanaged,
      errors: sortErrors(errors),
      summary: { create: 0, newVersion: 0, move: 0, unchanged: 0 },
    };
  }

  // 3) 프롬프트마다 할 일 계산
  const changes = await mapLimit(specs, options.concurrency ?? 4, (spec) =>
    planOne(spec, metaByName.get(spec.name), api, labelOverride ?? spec.labels),
  );
  changes.sort((a, b) => byCodepoint(a.name, b.name));

  return {
    target: options.target,
    labelOverride,
    changes,
    unmanaged,
    errors: [],
    summary: {
      create: changes.filter((c) => c.action === "create").length,
      newVersion: changes.filter((c) => c.action === "new-version").length,
      move: changes.filter((c) => c.action === "move").length,
      unchanged: changes.filter((c) => c.action === "unchanged").length,
    },
  };
}

export function hasChanges(plan: Plan): boolean {
  return plan.summary.create + plan.summary.newVersion + plan.summary.move > 0;
}

async function planOne(
  spec: PromptSpec,
  meta: RemotePromptMeta | undefined,
  api: PromptApi,
  desiredLabels: string[],
): Promise<PromptChange> {
  const fileLines = promptLines(spec.type, spec.prompt);
  const createBody = {
    name: spec.name,
    type: spec.type,
    prompt: spec.prompt,
    ...(spec.config ? { config: spec.config } : {}),
    labels: desiredLabels,
    // 파일에 tags 가 없으면 보내지 않는다 — 보내면 프롬프트 전체 tags 가 바뀐다(research 7-6)
    ...(spec.tags ? { tags: spec.tags } : {}),
  };

  // ---- 원격에 없는 프롬프트: 새로 만든다 ----
  if (!meta || meta.versions.length === 0) {
    return {
      name: spec.name,
      file: spec.file,
      type: spec.type,
      action: "create",
      targetVersion: 1,
      latestVersion: null,
      baselineVersion: null,
      labels: desiredLabels,
      labelMoves: desiredLabels.map((label) => ({ label, from: null, to: 1 })),
      diff: [
        ...section(`(new prompt)`, spec.file, [], fileLines),
        ...section(`(new prompt) config`, `${spec.file} config`, [], configLines(spec.config)),
      ],
      warnings: [],
      request: { kind: "create", body: createBody, commitMessage: spec.commitMessage },
    };
  }

  // ---- 후보 버전 모으기: 최신 버전 + 라벨이 붙은 버전들 ----
  const latestNumber = Math.max(...meta.versions);
  const byVersion = new Map<number, RemotePrompt>();
  const holder = new Map<string, number>(); // 라벨 → 지금 그 라벨이 붙은 버전
  const latest = await api.getPrompt(spec.name, { version: latestNumber });
  if (!latest) throw new Error(`${spec.name}: latest version v${latestNumber} disappeared while planning — run plan again`);
  byVersion.set(latest.version, latest);
  const remoteLabels = sortedUnique(meta.labels.filter((label) => label !== "latest"));
  for (const label of remoteLabels) {
    const found = await api.getPrompt(spec.name, { label });
    if (!found) continue; // 조회 사이에 라벨이 사라졌으면 없는 것으로 본다
    byVersion.set(found.version, found);
    holder.set(label, found.version);
  }

  // ---- 내용이 같은 후보 찾기 ----
  const wantedKey = contentKey(spec.type, spec.prompt, spec.config);
  const matches = [...byVersion.values()].filter((remote) => contentKey(remote.type, remote.prompt, remote.config) === wantedKey);
  // 같은 내용이 여러 버전에 있으면: 원하는 라벨을 이미 많이 가진 버전 → 번호가 큰 버전 순으로 고른다.
  const heldCount = (remote: RemotePrompt) => desiredLabels.filter((label) => holder.get(label) === remote.version).length;
  matches.sort((a, b) => heldCount(b) - heldCount(a) || b.version - a.version);
  const match = matches[0];

  const warnings: PlanWarning[] = [];
  let change: PromptChange;

  if (match) {
    // 같은 내용이 이미 있다 → 새 버전을 만들지 않고, 빠진 라벨만 옮긴다.
    const moves: LabelMove[] = desiredLabels
      .filter((label) => holder.get(label) !== match.version)
      .map((label) => ({ label, from: holder.get(label) ?? null, to: match.version }));
    // 라벨을 옮기면 그 라벨을 쓰는 앱이 받는 내용이 바뀐다 → 옮기기 전 버전과 비교해 보여 준다.
    const fromVersion = moves.find((move) => move.from !== null)?.from ?? null;
    const before = fromVersion === null ? undefined : byVersion.get(fromVersion);
    change = {
      name: spec.name,
      file: spec.file,
      type: spec.type,
      action: moves.length > 0 ? "move" : "unchanged",
      targetVersion: match.version,
      latestVersion: latestNumber,
      baselineVersion: before ? before.version : match.version,
      labels: desiredLabels,
      labelMoves: moves,
      diff: before ? versionDiff(spec, before, match) : [],
      warnings,
      request: moves.length > 0 ? { kind: "patch", version: match.version, newLabels: moves.map((m) => m.label) } : null,
    };
    if (before) warnings.push(...compareSlots(extractSlots(before.type, before.prompt), extractSlots(spec.type, spec.prompt), before.version));
  } else {
    // 같은 내용이 없다 → 새 버전. 비교 기준은 최신 버전.
    const target = latestNumber + 1;
    change = {
      name: spec.name,
      file: spec.file,
      type: spec.type,
      action: "new-version",
      targetVersion: target,
      latestVersion: latestNumber,
      baselineVersion: latest.version,
      labels: desiredLabels,
      labelMoves: desiredLabels.map((label) => ({ label, from: holder.get(label) ?? null, to: target })),
      diff: [
        ...section(`${spec.name} v${latest.version}`, spec.file, promptLines(latest.type, latest.prompt), fileLines),
        ...section(`${spec.name} v${latest.version} config`, `${spec.file} config`, configLines(latest.config), configLines(spec.config)),
      ],
      warnings,
      request: { kind: "create", body: createBody, commitMessage: spec.commitMessage },
    };
    warnings.push(...compareSlots(extractSlots(latest.type, latest.prompt), extractSlots(spec.type, spec.prompt), latest.version));
  }

  // ---- 드리프트: 최신 버전이 promptplan 이 만든 것도 아니고 파일 내용도 아니다 ----
  // (누군가 Langfuse UI 에서 직접 고친 버전) — 덮어쓰지 않고 알려 준다.
  if (latest.version !== change.targetVersion && !(latest.commitMessage ?? "").startsWith(COMMIT_PREFIX.trim())) {
    const note = latest.commitMessage ? ` (commit message: "${oneLine(latest.commitMessage)}")` : "";
    warnings.unshift({
      kind: "drift",
      message: `latest v${latest.version} was created outside promptplan${note} and is not in your files — review it in Langfuse or copy the change into ${spec.file}`,
    });
  }

  // ---- tags: 프롬프트 전체 공통, 새 버전을 만들 때만 바뀐다 ----
  if (spec.tags && stableStringify(spec.tags) !== stableStringify(sortedUnique(meta.tags))) {
    const from = `[${sortedUnique(meta.tags).join(", ")}]`;
    const to = `[${spec.tags.join(", ")}]`;
    warnings.push({
      kind: "tags",
      message:
        change.action === "new-version"
          ? `tags change ${from} → ${to} for all versions of this prompt`
          : `tags differ (${from} in Langfuse, ${to} in file) — Langfuse only updates tags when a new version is created`,
    });
  }

  return change;
}

/** 원격 버전 두 개 사이의 diff (라벨 이동 때 "그 라벨을 쓰는 앱이 받게 될 변화"). */
function versionDiff(spec: PromptSpec, before: RemotePrompt, after: RemotePrompt): string[] {
  return [
    ...section(`${spec.name} v${before.version}`, `${spec.name} v${after.version}`, promptLines(before.type, before.prompt), promptLines(after.type, after.prompt)),
    ...section(
      `${spec.name} v${before.version} config`,
      `${spec.name} v${after.version} config`,
      configLines(before.config),
      configLines(after.config),
    ),
  ];
}

/** 머리줄(---/+++)을 붙인 diff 한 덩어리. 변화가 없으면 빈 배열. */
function section(fromLabel: string, toLabel: string, before: string[], after: string[]): string[] {
  const hunks = unifiedDiff(before, after);
  return hunks.length === 0 ? [] : [`--- ${fromLabel}`, `+++ ${toLabel}`, ...hunks];
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

function sortErrors(errors: PlanError[]): PlanError[] {
  return [...errors].sort((a, b) => byCodepoint(a.file, b.file) || byCodepoint(a.message, b.message));
}
