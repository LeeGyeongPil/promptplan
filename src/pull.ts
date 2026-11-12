// pull — Langfuse 에 이미 있는 프롬프트를 파일로 내려받아 Git 원본으로 시작하게 한다.
//   text → <name>.md   (YAML 프론트매터 + 본문)
//   chat → <name>.yaml (labels·config·tags·messages)
// 내려받은 파일로 바로 plan 하면 "No changes" 가 나와야 한다(왕복 보장 — files.ts 와 같은 정규화를 쓴다).

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { PromptApi } from "./client.js";
import { PromptplanError } from "./i18n.js";
import { normalizeConfig, normalizePromptBody } from "./normalize.js";
import type { ChatMessage, RemotePrompt } from "./types.js";
import { byCodepoint, isPlainObject, sortedUnique } from "./util.js";

export interface PullOptions {
  dir: string;
  /** 어느 라벨의 버전을 받을지(기본 production) */
  label?: string;
  /** 이미 있는 파일을 덮어쓸지 */
  force?: boolean;
}

export interface PullResult {
  /** --dir 기준 상대 경로 */
  written: string[];
  /** 이미 파일이 있어 건너뛴 것(--force 없음) */
  skipped: string[];
  /** 그 라벨이 붙은 버전이 없는 프롬프트 */
  missingLabel: string[];
  /** 파일 경로로 쓸 수 없는 이름 */
  unsafe: string[];
}

export async function pullPrompts(api: PromptApi, options: PullOptions): Promise<PullResult> {
  const label = options.label ?? "production";
  const result: PullResult = { written: [], skipped: [], missingLabel: [], unsafe: [] };
  const metas = [...(await api.listPrompts())].sort((a, b) => byCodepoint(a.name, b.name));

  for (const meta of metas) {
    if (!isSafeName(meta.name)) {
      result.unsafe.push(meta.name);
      continue;
    }
    const remote = await api.getPrompt(meta.name, { label });
    if (!remote) {
      result.missingLabel.push(meta.name);
      continue;
    }
    const file = `${meta.name}${remote.type === "chat" ? ".yaml" : ".md"}`;
    // 같은 이름의 .md·.yaml·.yml 중 하나라도 있으면 사람이 고친 파일일 수 있으니 덮지 않는다.
    if (!options.force && (await anyExists(options.dir, meta.name))) {
      result.skipped.push(file);
      continue;
    }
    const target = path.join(options.dir, ...file.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderPromptFile(remote), "utf8");
    result.written.push(file);
  }
  return result;
}

/** 원격 버전 하나를 파일 내용으로. */
export function renderPromptFile(remote: RemotePrompt): string {
  const meta: Record<string, unknown> = {};
  const labels = sortedUnique(remote.labels.filter((l) => l !== "latest"));
  meta["labels"] = labels;
  const config = normalizeConfig(remote.config);
  if (!(isPlainObject(config) && Object.keys(config).length === 0)) meta["config"] = config;
  if (remote.tags.length > 0) meta["tags"] = sortedUnique(remote.tags);

  if (remote.type === "text") {
    const body = normalizePromptBody("text", remote.prompt);
    if (typeof body !== "string") throw new PromptplanError("pull.badTextBody", { name: remote.name });
    // 프론트매터는 언제나 쓴다 — 본문이 "---" 로 시작해도 첫 닫는 줄이 우리 것이라 안전하다.
    return `---\n${stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n${body}\n`;
  }

  const body = normalizePromptBody("chat", remote.prompt);
  if (!Array.isArray(body)) throw new PromptplanError("pull.badChatBody", { name: remote.name });
  meta["messages"] = body.map((message: ChatMessage) =>
    message.type === "placeholder" ? { placeholder: message.name } : { role: message.role, content: message.content },
  );
  return stringify(meta, { lineWidth: 0 });
}

/** 경로로 바꿔도 --dir 밖으로 나가지 않는 이름인지. */
function isSafeName(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function anyExists(dir: string, name: string): Promise<boolean> {
  for (const ext of [".md", ".yaml", ".yml"]) {
    try {
      await access(path.join(dir, ...`${name}${ext}`.split("/")));
      return true;
    } catch {
      // 없음
    }
  }
  return false;
}
