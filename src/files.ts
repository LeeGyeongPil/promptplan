// 프롬프트 폴더를 읽어 PromptSpec 목록으로 만든다.
//   text 프롬프트 = .md  (YAML 프론트매터 + 본문)
//   chat 프롬프트 = .yaml / .yml  (messages 배열)
// 이름은 --dir 기준 상대 경로에서 확장자를 뺀 것(support/greeting.md → support/greeting).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChatMessage, PlanError, PromptSpec } from "./types.js";
import { msg, planText, PromptplanError, type Msg } from "./i18n.js";
import { normalizeText } from "./normalize.js";
import { byCodepoint, isPlainObject, sortedUnique } from "./util.js";

const TEXT_KEYS = ["name", "type", "labels", "config", "tags", "commitMessage"];
const CHAT_KEYS = ["name", "type", "labels", "config", "tags", "commitMessage", "messages"];

export interface LoadResult {
  specs: PromptSpec[];
  errors: PlanError[];
}

/** 폴더 아래의 프롬프트 파일 경로(--dir 기준 posix 상대 경로)를 정렬해서 돌려준다. */
export async function listPromptFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    const entries = await readdir(path.join(dir, relative), { withFileTypes: true });
    for (const entry of entries) {
      // 숨김 파일·폴더와 node_modules 는 건너뛴다.
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\.(md|ya?ml)$/i.test(entry.name) && entry.name.toLowerCase() !== "readme.md")
        found.push(child);
    }
  }
  await walk("");
  return found.sort(byCodepoint);
}

/** 폴더 전체를 읽는다. 파일 하나가 깨져도 나머지는 계속 읽고 오류를 모은다. */
export async function loadPromptDir(dir: string): Promise<LoadResult> {
  let files: string[];
  try {
    files = await listPromptFiles(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const issue = code === "ENOENT" ? msg("files.folderNotFound") : msg("files.folderUnreadable", { code: code ?? String(error) });
    return { specs: [], errors: [{ name: dir, file: dir, ...planText(issue) }] };
  }
  // 폴더는 읽혔지만 프롬프트 파일이 하나도 없으면 오류: --dir 오지정이 CI 에서 조용히 통과하지 않게.
  if (files.length === 0)
    return { specs: [], errors: [{ name: ".", file: ".", ...planText(msg("files.noPromptFiles", { dir })) }] };
  const specs: PromptSpec[] = [];
  const errors: PlanError[] = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    try {
      specs.push(parsePromptFile(file, text));
    } catch (error) {
      errors.push({
        name: nameFromPath(file),
        file,
        message: (error as Error).message,
        ...(error instanceof PromptplanError ? { i18n: error.i18n } : {}),
      });
    }
  }
  specs.sort((a, b) => byCodepoint(a.name, b.name));
  return { specs, errors };
}

export function nameFromPath(file: string): string {
  return file.replace(/\.(md|ya?ml)$/i, "");
}

/** 파일 내용 하나를 PromptSpec 으로. 형식이 틀리면 사람이 읽을 수 있는 메시지로 throw. */
export function parsePromptFile(file: string, content: string): PromptSpec {
  const isMarkdown = /\.md$/i.test(file);
  let meta: Record<string, unknown>;
  let body = "";
  if (isMarkdown) {
    const split = splitFrontMatter(content);
    meta = split.meta;
    body = split.body;
  } else {
    meta = parseYamlObject(content, msg("files.whatFile"));
  }

  const allowed = isMarkdown ? TEXT_KEYS : CHAT_KEYS;
  for (const key of Object.keys(meta))
    if (!allowed.includes(key)) throw new PromptplanError("files.unknownKey", { key, allowed: allowed.join(", ") });

  const type = meta["type"] ?? (isMarkdown ? "text" : "chat");
  if (isMarkdown && type !== "text") throw new PromptplanError("files.mdIsText");
  if (!isMarkdown && type !== "chat") throw new PromptplanError("files.yamlIsChat");

  const name = meta["name"] === undefined ? nameFromPath(file) : meta["name"];
  if (typeof name !== "string") throw new PromptplanError("files.nameString");

  const config = meta["config"];
  if (config !== undefined && config !== null && !isPlainObject(config)) throw new PromptplanError("files.configMapping");

  const commitMessage = meta["commitMessage"];
  if (commitMessage !== undefined && typeof commitMessage !== "string") throw new PromptplanError("files.commitString");

  const prompt: string | ChatMessage[] = isMarkdown ? normalizeText(body) : parseMessages(meta["messages"]);

  return {
    name,
    file,
    type: isMarkdown ? "text" : "chat",
    prompt,
    config: isPlainObject(config) ? config : undefined,
    labels: sortedUnique(stringList(meta["labels"], "labels") ?? []),
    tags: meta["tags"] === undefined ? undefined : sortedUnique(stringList(meta["tags"], "tags") ?? []),
    commitMessage,
  };
}

function stringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new PromptplanError("files.listOfStrings", { key });
  return value as string[];
}

/** chat 메시지: { role, content } 또는 { placeholder: name } (또는 Langfuse 원형 { type: placeholder, name }). */
function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new PromptplanError("files.messagesList");
  return value.map((item, index) => {
    const where = `messages[${index}]`;
    if (!isPlainObject(item)) throw new PromptplanError("files.messageMapping", { where });
    if (typeof item["placeholder"] === "string") return { type: "placeholder", name: item["placeholder"] };
    if (item["type"] === "placeholder") {
      if (typeof item["name"] !== "string") throw new PromptplanError("files.placeholderName", { where });
      return { type: "placeholder", name: item["name"] };
    }
    if (item["type"] !== undefined && item["type"] !== "chatmessage") throw new PromptplanError("files.unknownType", { where, type: String(item["type"]) });
    if (typeof item["role"] !== "string" || typeof item["content"] !== "string")
      throw new PromptplanError("files.needsRoleContent", { where });
    return { type: "chatmessage", role: item["role"], content: normalizeText(item["content"]) };
  });
}

function parseYamlObject(text: string, what: Msg): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (error) {
    // yaml 의 오류 메시지는 여러 줄(코드 조각 포함)이라 첫 줄만 쓴다.
    throw new PromptplanError("files.invalidYaml", { what, detail: String((error as Error).message).split("\n")[0] ?? "" });
  }
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) throw new PromptplanError("files.yamlMapping", { what });
  return value;
}

/** "---\n<yaml>\n---\n<본문>" 을 나눈다. 프론트매터가 없으면 전체가 본문. */
function splitFrontMatter(content: string): { meta: Record<string, unknown>; body: string } {
  const text = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const lines = text.split("\n");
  // 닫는 줄은 정확히 "---" 인 첫 줄.
  const close = lines.indexOf("---", 1);
  if (close === -1) throw new PromptplanError("files.noClosingFence");
  const meta = parseYamlObject(lines.slice(1, close).join("\n"), msg("files.whatFrontMatter"));
  const body = lines.slice(close + 1).join("\n");
  return { meta, body };
}
