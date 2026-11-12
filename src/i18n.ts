// Screen-language support (English / Korean). Every user-visible sentence lives in the two tables below.
// Machine output (--format json, HTTP bodies, exit codes, rule IDs) is never translated.
//
// Library errors carry a message key + params (PromptplanError); their default `message` stays English,
// and the CLI localizes them only when it prints them.

export type Lang = "en" | "ko";
export const LANGS: readonly Lang[] = ["en", "ko"];

const en = {
  // ---- help ----
  help: `promptplan {version} — Git-first prompt deployment for Langfuse

Usage
  promptplan plan  [--dir prompts] [--label <l>]... [--format text|markdown|json]
                   [--detailed-exitcode] [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan apply [--dir prompts] [--label <l>]... [--yes] [--message <m>]
                   [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan pull  [--dir prompts] [--label production] [--force] [--mock-state <file>] [--env-file <file>]
  promptplan mock  [--port 3999] [--seed <file>]     run the practice mock until Ctrl+C
  promptplan demo                                    plan → apply → plan against the practice mock

Options
  --dir <path>           prompt folder (.md = text prompt, .yaml/.yml = chat prompt). Default: prompts
  --label <l>            use these labels for every prompt instead of the files' labels (promotion)
  --format <f>           plan output: text (default), markdown (PR comment) or json
  --detailed-exitcode    plan exits 2 when there are changes, 0 when there are none
  --yes, -y              apply without asking (required when not in an interactive terminal)
  --message, -m <m>      commit message for new versions (stored as "[promptplan] <m>")
  --force                pull overwrites existing files
  --mock-state <file>    use the practice mock loaded from this JSON file instead of Langfuse
                         (apply writes the new mock state back to the file)
  --env-file <file>      read LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL from a file
  --no-color             plain output (also honours NO_COLOR)
  --lang <en|ko>         screen language. Default: PROMPTPLAN_LANG, then LC_ALL / LC_MESSAGES / LANG, else English

Exit codes: 0 ok · 2 changes (plan --detailed-exitcode) · 1 error
`,

  // ---- cli ----
  "cli.errorLine": "promptplan: error: {message}\n",
  "cli.helpHint": "Run promptplan --help for usage.\n",
  "cli.unexpectedArg": 'unexpected argument "{arg}"',
  "cli.unknownCommand": 'unknown command "{command}" (plan, apply, pull, mock, demo)',
  "cli.labelFlag": "--label: {issue}",
  "cli.pullOneLabel": "pull takes exactly one --label",
  "cli.formatInvalid": "--format must be text, markdown or json",
  "cli.formatOnlyPlan": "--format is only for plan",
  "cli.langInvalid": "--lang must be en or ko",
  "cli.portRange": "--port must be 0-65535",
  "cli.applyNeedsYes": "apply needs --yes when not running in an interactive terminal (for example in CI)",
  "cli.askApply": "\nApply these changes? Only 'yes' is accepted: ",
  "cli.applyCancelled": "Apply cancelled.\n",
  "cli.mockStateWritten": "(practice mock state written back to {file})\n",
  "cli.parseUnknownOption": "unknown option {option}",
  "cli.parseBadOptionValue": "option {option} needs a valid value",
  "cli.parseUnexpectedPositional": "unexpected argument {option}",
  "cli.parseOther": "{message}",
  "os.error": "{code}: {message}",
  // ---- pull ----
  "pull.wrote": "+ wrote {file}\n",
  "pull.kept": "= kept {file} (exists; use --force to overwrite)\n",
  "pull.noLabel": '  no "{label}" version: {list}\n',
  "pull.unsafe": "  skipped names that are not safe file paths: {list}\n",
  "pull.summary": "Pulled: {written} written, {kept} kept\n",
  "pull.badTextBody": "{name}: unexpected text prompt body",
  "pull.badChatBody": "{name}: unexpected chat prompt body",
  // ---- mock command ----
  "mock.title": "promptplan practice mock — a fake Langfuse prompt API (not the real server)\n",
  "mock.url": "  LANGFUSE_BASE_URL={url}   any pk/sk keys are accepted · state lives in memory only\n",
  "mock.stop": "  Stop with Ctrl+C.\n",
  "mock.seedVersions": "mock seed: {name} versions must be 1, 2, 3, … (found {found})",
  "mock.cannotRead": "cannot read mock state file {file} ({code})",
  "mock.badJson": "mock state file is not valid JSON",
  "mock.needsPrompts": 'mock state file needs { "prompts": [...] }',
  "mock.needsNameVersions": "each mock prompt needs name and versions",
  "mock.badType": "mock prompt {name}: type must be text or chat",
  // ---- config ----
  "config.missingKeys": `No Langfuse keys found.
  Real Langfuse: set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (and LANGFUSE_BASE_URL for US or self-hosted),
                 for example in a .env file passed with --env-file .env (see .env.example).
  Practice:      add --mock-state <file> to run against the built-in practice mock, e.g.
                 --mock-state examples/remote-seed.json`,
  "config.cannotReadEnvFile": "cannot read --env-file ({code})",
  "config.badBaseUrl": "LANGFUSE_BASE_URL is not a valid URL",
  "target.mock": "practice mock (--mock-state)",
  "target.demo": "practice mock (demo)",
  "target.langfuse": "Langfuse at {host}",
  // ---- client ----
  "api.error": "Langfuse API {status} on {method} {path}: {detail}{hint}",
  "api.hint401": " — check LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL (EU, US and self-hosted use different URLs)",
  "api.hint403":
    " — the key may not be allowed to move a protected label (e.g. production); use an admin key or move it in the Langfuse UI",
  "api.unreachable": "cannot reach Langfuse ({method} {path}): {cause}",
  "api.timeout": "no response within {seconds}s",
  "api.tooManyPages": "Langfuse returned more than {max} pages of prompts; promptplan stops instead of planning on a partial list",
  "api.badList": "unexpected list response from Langfuse",
  // ---- files ----
  "files.folderNotFound": "prompt folder not found",
  "files.folderUnreadable": "cannot read prompt folder ({code})",
  "files.noPromptFiles": "no prompt files (.md, .yaml, .yml) in {dir}",
  "files.unknownKey": 'unknown key "{key}" (allowed: {allowed})',
  "files.mdIsText": ".md files are text prompts; write chat prompts as .yaml with messages:",
  "files.yamlIsChat": ".yaml files are chat prompts (type: chat); write text prompts as .md",
  "files.nameString": "name must be a string",
  "files.configMapping": "config must be a mapping",
  "files.commitString": "commitMessage must be a string",
  "files.listOfStrings": "{key} must be a list of strings, e.g. {key}: [staging]",
  "files.messagesList": "messages must be a non-empty list",
  "files.messageMapping": "{where} must be a mapping",
  "files.placeholderName": "{where}: placeholder needs a name",
  "files.unknownType": '{where}: unknown type "{type}"',
  "files.needsRoleContent": "{where} needs role and content strings (or placeholder: <name>)",
  "files.invalidYaml": "invalid YAML in {what}: {detail}",
  "files.whatFile": "file",
  "files.whatFrontMatter": "front matter",
  "files.yamlMapping": "{what} must be a YAML mapping",
  "files.noClosingFence": "front matter starts with --- but has no closing --- line",
  // ---- validate ----
  "rule.labelLatest": 'label "latest" is reserved — Langfuse moves it to the newest version automatically',
  "rule.labelLong": 'label "{label}" is longer than {max} characters',
  "rule.labelInvalid": 'label "{label}" is invalid — use lowercase letters, digits, "_", "-" or "." only',
  "rule.nameEmpty": "prompt name is empty",
  "rule.nameLong": "prompt name is longer than {max} characters",
  "rule.namePipe": 'prompt name "{name}" contains "|", which Langfuse does not allow',
  "rule.nameReserved": 'prompt name "{name}" is reserved by Langfuse ({reserved}) — rename the file or set name: in front matter',
  "rule.commitLong": "commit message is {length} characters; Langfuse allows {max}",
  "rule.nameDuplicate": 'prompt name "{name}" is also defined in {file}',
  "rule.typeChange": "type change {from} → {to} is not allowed — Langfuse keeps the first type; use a new prompt name",
  // ---- planner / warnings ----
  "plan.latestGone": "{name}: latest v{version} disappeared while planning — run plan again",
  "plan.applyHasErrors": "plan has {n} error(s); nothing was applied",
  "apply.messageFlag": "--message: {issue}",
  "warn.drift": "latest v{version} was created outside promptplan{note} and is not in your files — review it in Langfuse or copy the change into {file}",
  "warn.driftNote": ' (commit message: "{message}")',
  "warn.tagsChange": "tags change {from} → {to} for all versions of this prompt",
  "warn.tagsDiffer": "tags differ ({from} in Langfuse, {to} in file) — Langfuse only updates tags when a new version is created",
  "warn.variableRemoved": "variable removed: {name} (compared with v{version}) — callers passing it will be ignored",
  "warn.variableAdded": "variable added: {name} (compared with v{version}) — callers must now pass it",
  "warn.placeholderRemoved": "placeholder removed: {name} (compared with v{version})",
  "warn.placeholderAdded": "placeholder added: {name} (compared with v{version}) — callers must now fill it",
  // ---- plural counts ----
  "count.newVersion.one": "{n} new version",
  "count.newVersion.other": "{n} new versions",
  "count.labelMove.one": "{n} label move",
  "count.labelMove.other": "{n} label moves",
  "count.problem.one": "{n} problem",
  "count.problem.other": "{n} problems",
  "count.createdVersion.one": "{n} created version",
  "count.createdVersion.other": "{n} created versions",
  // ---- render: text / markdown ----
  "render.planHeader": "promptplan plan · {target}",
  "render.target": "target: {target} · labels: {labels}",
  "render.labelsFromFiles": "from files",
  "render.labelsOverride": "{labels} (--label)",
  "render.labelsNone": "no labels",
  "render.labelsList": "labels: {list}",
  "render.moveNew": "{label} (new) → v{to}",
  "render.move": "{label} v{from} → v{to}",
  "render.headCreate": "create v{version} ({labels})",
  "render.headNewVersion": "new version v{version} ({labels})",
  "render.headMove": "move {moves}",
  "render.headUnchanged": "unchanged v{version} ({labels})",
  "render.warnDrift": "drift {name}: {message}",
  "render.warnOther": "{name}: {message}",
  "render.summary": "Plan: {create} to create, {newVersion}, {labelMove}, {unchanged} unchanged",
  "render.errorsFound": "Error: {problems} found. Nothing was sent to Langfuse.",
  "render.unmanaged": "Not in your files (left alone): {list}",
  "render.noChanges": "No changes. Langfuse already matches your files.",
  "render.errorLine": "x {file}: {message}",
  "render.applied": "Applied: {created}, {moves}",
  "render.moved": "moved {labels} → v{version}",
  "render.created": "created v{version} ({labels})",
  "render.stopped": "Stopped at {name}. Not attempted: {list}",
  "render.none": "(none)",
  "render.fixAndRerun": "Fix the problem and run apply again — finished prompts will show as unchanged.",
  "md.title": "### promptplan plan",
  "md.errors": "**Error: {problems} found. Nothing was sent to Langfuse.**",
  "md.tableHeader": "| | Prompt | Change |",
  "md.warnings": "**Warnings**",
  // ---- demo ----
  "demo.title": "promptplan demo — practice mock mode\n",
  "demo.fake": "  The 'remote' is an in-memory fake of the Langfuse prompt API, not the real server.\n",
  "demo.files": "  Files:  examples/prompts/   Remote start state: examples/remote-seed.json (not modified)\n\n",
  "demo.step1": "== 1/4  plan: what would change? ==\n\n",
  "demo.step2": "\n== 2/4  apply: send only what changed ==\n\n",
  "demo.requests": "  requests sent: {post} POST, {patch} PATCH\n",
  "demo.step3": "\n== 3/4  plan again: nothing left to do ==\n\n",
  "demo.applyAgain": "  apply again: {created} new versions, {moves} label moves (idempotent)\n",
  "demo.step4": "\n== 4/4  why compare first? ==\n\n",
  "demo.naive": "  A script that POSTs every file on every CI run:  {start} → {naive} versions after 2 runs\n",
  "demo.smart": "  promptplan apply, then apply again:              {start} → {applied} → {second} versions\n",
  "demo.why": "  Langfuse makes a new version on every POST, even with identical content — so compare first.\n",
  "demo.tryIt": "\nTry it yourself: npx promptplan plan --dir examples/prompts --mock-state examples/remote-seed.json\n",
} as const;

export type MsgKey = keyof typeof en;

const ko: Record<MsgKey, string> = {
  help: `promptplan {version} — Langfuse 를 위한 Git 우선 프롬프트 배포 도구

사용법
  promptplan plan  [--dir prompts] [--label <l>]... [--format text|markdown|json]
                   [--detailed-exitcode] [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan apply [--dir prompts] [--label <l>]... [--yes] [--message <m>]
                   [--mock-state <file>] [--env-file <file>] [--no-color]
  promptplan pull  [--dir prompts] [--label production] [--force] [--mock-state <file>] [--env-file <file>]
  promptplan mock  [--port 3999] [--seed <file>]     Ctrl+C 를 누를 때까지 연습용 목 서버 실행
  promptplan demo                                    연습용 목에서 plan → apply → plan 시연

옵션
  --dir <path>           프롬프트 폴더(.md = 텍스트 프롬프트, .yaml/.yml = 채팅 프롬프트). 기본값: prompts
  --label <l>            파일의 라벨 대신 모든 프롬프트에 이 라벨 사용(승격)
  --format <f>           plan 출력 형식: text(기본), markdown(PR 코멘트), json
  --detailed-exitcode    plan 에서 변경이 있으면 종료 코드 2, 없으면 0
  --yes, -y              확인 없이 apply (대화형 터미널이 아니면 필수)
  --message, -m <m>      새 버전의 커밋 메시지("[promptplan] <m>" 로 저장)
  --force                pull 이 기존 파일을 덮어씀
  --mock-state <file>    Langfuse 대신 이 JSON 파일에서 읽은 연습용 목 사용
                         (apply 하면 새 목 상태를 파일에 되씀)
  --env-file <file>      LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL 을 파일에서 읽음
  --no-color             색 없는 출력(NO_COLOR 도 따름)
  --lang <en|ko>         화면 언어. 기본값: PROMPTPLAN_LANG, 그다음 LC_ALL / LC_MESSAGES / LANG, 그 외에는 영어

종료 코드: 0 성공 · 2 변경 있음(plan --detailed-exitcode) · 1 오류
`,

  "cli.errorLine": "promptplan: 오류: {message}\n",
  "cli.helpHint": "사용법은 promptplan --help 로 확인하세요.\n",
  "cli.unexpectedArg": '예상하지 못한 인자: "{arg}"',
  "cli.unknownCommand": '알 수 없는 명령: "{command}" (plan, apply, pull, mock, demo)',
  "cli.labelFlag": "--label: {issue}",
  "cli.pullOneLabel": "pull 에는 --label 을 정확히 하나만 줄 수 있습니다",
  "cli.formatInvalid": "--format 값은 text, markdown, json 중 하나여야 합니다",
  "cli.formatOnlyPlan": "--format 옵션은 plan 에서만 쓸 수 있습니다",
  "cli.langInvalid": "--lang 값은 en 또는 ko 여야 합니다",
  "cli.portRange": "--port 값은 0~65535 범위여야 합니다",
  "cli.applyNeedsYes": "대화형 터미널이 아닐 때(예: CI)에는 apply 에 --yes 가 필요합니다",
  "cli.askApply": "\n이 변경을 적용할까요? 'yes' 만 허용됩니다: ",
  "cli.applyCancelled": "apply 를 취소했습니다.\n",
  "cli.mockStateWritten": "(연습용 목 상태를 다음 파일에 되썼습니다: {file})\n",
  "cli.parseUnknownOption": "알 수 없는 옵션: {option}",
  "cli.parseBadOptionValue": "옵션 값이 올바르지 않습니다: {option}",
  "cli.parseUnexpectedPositional": "예상하지 못한 인자: {option}",
  "cli.parseOther": "인자를 해석할 수 없습니다: {message}",
  "os.error": "시스템 오류 {code}: {message}",

  "pull.wrote": "+ 기록함: {file}\n",
  "pull.kept": "= 유지함: {file} (이미 있음, 덮어쓰려면 --force)\n",
  "pull.noLabel": '  "{label}" 라벨이 붙은 버전 없음: {list}\n',
  "pull.unsafe": "  안전한 파일 경로가 아니어서 건너뛴 이름: {list}\n",
  "pull.summary": "pull 결과: 기록 {written}개, 유지 {kept}개\n",
  "pull.badTextBody": "{name}: 텍스트 프롬프트 본문 형식이 예상과 다릅니다",
  "pull.badChatBody": "{name}: 채팅 프롬프트 본문 형식이 예상과 다릅니다",

  "mock.title": "promptplan 연습용 목 — 가짜 Langfuse 프롬프트 API(실제 서버 아님)\n",
  "mock.url": "  LANGFUSE_BASE_URL={url}   pk/sk 키는 아무 값이나 받습니다 · 상태는 메모리에만 있습니다\n",
  "mock.stop": "  Ctrl+C 로 멈춥니다.\n",
  "mock.seedVersions": "목 시드: {name} 의 버전 번호는 1, 2, 3, … 순서여야 합니다(발견된 값 {found})",
  "mock.cannotRead": "목 상태 파일을 읽을 수 없습니다: {file} ({code})",
  "mock.badJson": "목 상태 파일이 올바른 JSON 이 아닙니다",
  "mock.needsPrompts": '목 상태 파일에는 { "prompts": [...] } 형태가 필요합니다',
  "mock.needsNameVersions": "목 프롬프트마다 name 과 versions 가 필요합니다",
  "mock.badType": "목 프롬프트 {name}: type 은 text 또는 chat 이어야 합니다",

  "config.missingKeys": `Langfuse 키를 찾을 수 없습니다.
  실제 Langfuse: LANGFUSE_PUBLIC_KEY 와 LANGFUSE_SECRET_KEY 를 설정하세요(US·셀프호스트는 LANGFUSE_BASE_URL 도).
                 예를 들어 .env 파일을 만들고 --env-file .env 로 넘기면 됩니다(.env.example 참고).
  연습용:        --mock-state <file> 을 붙이면 내장 연습용 목을 대상으로 실행합니다. 예:
                 --mock-state examples/remote-seed.json`,
  "config.cannotReadEnvFile": "--env-file 을 읽을 수 없습니다({code})",
  "config.badBaseUrl": "LANGFUSE_BASE_URL 이 올바른 URL 이 아닙니다",
  "target.mock": "연습용 목 (--mock-state)",
  "target.demo": "연습용 목 (demo)",
  "target.langfuse": "Langfuse 서버: {host}",

  "api.error": "Langfuse API {status} 오류 ({method} {path}): {detail}{hint}",
  "api.hint401": " — LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 와 LANGFUSE_BASE_URL 을 확인하세요(EU·US·셀프호스트는 URL 이 다릅니다)",
  "api.hint403":
    " — 이 키로는 보호된 라벨(예: production)을 옮길 수 없을 수 있습니다. 관리자 키를 쓰거나 Langfuse 화면에서 직접 옮기세요",
  "api.unreachable": "Langfuse 에 연결할 수 없습니다 ({method} {path}): {cause}",
  "api.timeout": "{seconds}초 안에 응답이 없습니다",
  "api.tooManyPages": "Langfuse 가 프롬프트 목록을 {max} 페이지보다 많이 돌려줬습니다. 일부만 보고 계획하지 않도록 중단합니다",
  "api.badList": "Langfuse 의 목록 응답 형식이 예상과 다릅니다",

  "files.folderNotFound": "프롬프트 폴더를 찾을 수 없습니다",
  "files.folderUnreadable": "프롬프트 폴더를 읽을 수 없습니다({code})",
  "files.noPromptFiles": "프롬프트 파일(.md, .yaml, .yml)이 없습니다: {dir}",
  "files.unknownKey": '알 수 없는 키 "{key}" (허용: {allowed})',
  "files.mdIsText": ".md 파일은 텍스트 프롬프트입니다. 채팅 프롬프트는 messages: 를 넣어 .yaml 로 쓰세요",
  "files.yamlIsChat": ".yaml 파일은 채팅 프롬프트입니다(type: chat). 텍스트 프롬프트는 .md 로 쓰세요",
  "files.nameString": "name 은 문자열이어야 합니다",
  "files.configMapping": "config 는 매핑이어야 합니다",
  "files.commitString": "commitMessage 는 문자열이어야 합니다",
  "files.listOfStrings": "문자열 목록이어야 하는 키: {key} (예: {key}: [staging])",
  "files.messagesList": "messages 는 비어 있지 않은 목록이어야 합니다",
  "files.messageMapping": "매핑이어야 합니다: {where}",
  "files.placeholderName": "{where}: placeholder 에는 name 이 필요합니다",
  "files.unknownType": '{where}: 알 수 없는 type "{type}"',
  "files.needsRoleContent": "{where} 에는 문자열 role 과 content 가 필요합니다(또는 placeholder: <name>)",
  "files.invalidYaml": "{what} 의 YAML 이 올바르지 않습니다: {detail}",
  "files.whatFile": "파일",
  "files.whatFrontMatter": "프론트매터",
  "files.yamlMapping": "YAML 매핑이어야 합니다: {what}",
  "files.noClosingFence": "프론트매터가 --- 로 시작하지만 닫는 --- 줄이 없습니다",

  "rule.labelLatest": '라벨 "latest" 는 예약어입니다 — Langfuse 가 최신 버전에 자동으로 붙입니다',
  "rule.labelLong": '라벨이 {max}자를 넘습니다: "{label}"',
  "rule.labelInvalid": '올바르지 않은 라벨: "{label}" — 영문 소문자, 숫자, "_", "-", "." 만 쓸 수 있습니다',
  "rule.nameEmpty": "프롬프트 이름이 비어 있습니다",
  "rule.nameLong": "프롬프트 이름이 {max}자보다 깁니다",
  "rule.namePipe": '프롬프트 이름에 Langfuse 가 허용하지 않는 "|" 문자가 들어 있습니다: "{name}"',
  "rule.nameReserved": 'Langfuse 예약어는 프롬프트 이름으로 쓸 수 없습니다: "{name}" ({reserved}) — 파일 이름을 바꾸거나 프론트매터에 name: 을 지정하세요',
  "rule.commitLong": "커밋 메시지가 {length}자입니다. Langfuse 는 {max}자까지 허용합니다",
  "rule.nameDuplicate": '프롬프트 이름이 다른 파일에도 정의되어 있습니다: "{name}" ({file})',
  "rule.typeChange": "허용되지 않는 type 변경: {from} → {to} — Langfuse 는 처음 정한 type 을 유지합니다. 새 프롬프트 이름을 쓰세요",

  "plan.latestGone": "{name}: 계획 중 최신 버전이 사라졌습니다 (v{version}) — plan 을 다시 실행하세요",
  "plan.applyHasErrors": "plan 에 오류 {n}건이 있어 아무것도 적용하지 않았습니다",
  "apply.messageFlag": "--message: {issue}",
  "warn.drift": "promptplan 밖에서 만들어진 최신 버전이 있습니다: v{version}{note} — 파일에 없는 내용이니 Langfuse 에서 확인하거나 변경을 {file} 에 옮기세요",
  "warn.driftNote": ' (커밋 메시지: "{message}")',
  "warn.tagsChange": "이 프롬프트 모든 버전의 tags 변경: {from} → {to}",
  "warn.tagsDiffer": "tags 가 다릅니다(Langfuse {from}, 파일 {to}) — Langfuse 는 새 버전을 만들 때만 tags 를 갱신합니다",
  "warn.variableRemoved": "변수 삭제: {name} (비교 기준 v{version}) — 이 변수를 넘기는 호출자의 값은 무시됩니다",
  "warn.variableAdded": "변수 추가: {name} (비교 기준 v{version}) — 호출자가 이제 이 변수를 넘겨야 합니다",
  "warn.placeholderRemoved": "플레이스홀더 삭제: {name} (비교 기준 v{version})",
  "warn.placeholderAdded": "플레이스홀더 추가: {name} (비교 기준 v{version}) — 호출자가 이제 채워야 합니다",

  "count.newVersion.one": "새 버전 {n}개",
  "count.newVersion.other": "새 버전 {n}개",
  "count.labelMove.one": "라벨 이동 {n}개",
  "count.labelMove.other": "라벨 이동 {n}개",
  "count.problem.one": "문제 {n}건",
  "count.problem.other": "문제 {n}건",
  "count.createdVersion.one": "생성된 버전 {n}개",
  "count.createdVersion.other": "생성된 버전 {n}개",

  "render.planHeader": "promptplan plan · {target}",
  "render.target": "대상: {target} · 라벨: {labels}",
  "render.labelsFromFiles": "파일 기준",
  "render.labelsOverride": "{labels} (--label)",
  "render.labelsNone": "라벨 없음",
  "render.labelsList": "라벨: {list}",
  "render.moveNew": "{label} (신규) → v{to}",
  "render.move": "{label} v{from} → v{to}",
  "render.headCreate": "생성 v{version} ({labels})",
  "render.headNewVersion": "새 버전 v{version} ({labels})",
  "render.headMove": "이동 {moves}",
  "render.headUnchanged": "변경 없음 v{version} ({labels})",
  "render.warnDrift": "드리프트 {name}: {message}",
  "render.warnOther": "{name}: {message}",
  "render.summary": "계획: 생성 {create}개, {newVersion}, {labelMove}, 변경 없음 {unchanged}개",
  "render.errorsFound": "오류: 발견된 {problems}. Langfuse 에는 아무것도 보내지 않았습니다.",
  "render.unmanaged": "파일에 없음(건드리지 않음): {list}",
  "render.noChanges": "변경 없음. Langfuse 가 이미 파일과 일치합니다.",
  "render.errorLine": "x {file}: {message}",
  "render.applied": "적용 결과: {created}, {moves}",
  "render.moved": "이동 {labels} → v{version}",
  "render.created": "생성 v{version} ({labels})",
  "render.stopped": "중단 지점: {name}. 시도하지 못한 항목: {list}",
  "render.none": "(없음)",
  "render.fixAndRerun": "문제를 고친 뒤 apply 를 다시 실행하세요 — 끝난 프롬프트는 변경 없음으로 표시됩니다.",
  "md.title": "### promptplan plan",
  "md.errors": "**오류: 발견된 {problems}. Langfuse 에는 아무것도 보내지 않았습니다.**",
  "md.tableHeader": "| | 프롬프트 | 변경 |",
  "md.warnings": "**경고**",

  "demo.title": "promptplan demo — 연습용 목 모드\n",
  "demo.fake": "  '원격' 은 Langfuse 프롬프트 API 를 메모리에 흉내 낸 가짜이며 실제 서버가 아닙니다.\n",
  "demo.files": "  파일:  examples/prompts/   원격 시작 상태: examples/remote-seed.json (수정하지 않음)\n\n",
  "demo.step1": "== 1/4  plan: 무엇이 바뀔까? ==\n\n",
  "demo.step2": "\n== 2/4  apply: 바뀐 것만 보내기 ==\n\n",
  "demo.requests": "  보낸 요청: POST {post}개, PATCH {patch}개\n",
  "demo.step3": "\n== 3/4  다시 plan: 할 일이 남지 않음 ==\n\n",
  "demo.applyAgain": "  다시 apply: 새 버전 {created}개, 라벨 이동 {moves}개 (멱등)\n",
  "demo.step4": "\n== 4/4  왜 먼저 비교할까? ==\n\n",
  "demo.naive": "  CI 실행마다 모든 파일을 POST 하는 스크립트:  2회 실행 후 버전 {start} → {naive}\n",
  "demo.smart": "  promptplan apply 후 다시 apply:             버전 {start} → {applied} → {second}\n",
  "demo.why": "  Langfuse 는 내용이 같아도 POST 할 때마다 새 버전을 만듭니다 — 그래서 먼저 비교해야 합니다.\n",
  "demo.tryIt": "\n직접 해 보기: npx promptplan plan --dir examples/prompts --mock-state examples/remote-seed.json\n",
};

export const MESSAGES: Record<Lang, Record<MsgKey, string>> = { en, ko };

/** A message key plus values for its {placeholders}. Values may be nested messages. */
export interface Msg {
  key: MsgKey;
  params?: Params;
}
export type ParamValue = string | number | Msg;
export type Params = Record<string, ParamValue>;

export function msg(key: MsgKey, params?: Params): Msg {
  return params === undefined ? { key } : { key, params };
}

/** Plural-aware count message, e.g. countMsg("problem", 2) → "2 problems". */
export function countMsg(base: "newVersion" | "labelMove" | "problem" | "createdVersion", n: number): Msg {
  return { key: `count.${base}.${n === 1 ? "one" : "other"}`, params: { n } };
}

function isMsg(value: ParamValue): value is Msg {
  return typeof value === "object";
}

/** Fill a template. Values are inserted as-is (never re-scanned), nested messages are formatted first. */
export function t(lang: Lang, key: MsgKey, params: Params = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return isMsg(value) ? t(lang, value.key, value.params) : String(value);
  });
}

export function fmt(lang: Lang, message: Msg): string {
  return t(lang, message.key, message.params);
}

/** An Error whose English `message` is the library default and whose key/params let the CLI localize it. */
export class PromptplanError extends Error {
  readonly i18n: Msg;
  constructor(key: MsgKey, params?: Params) {
    const message = msg(key, params);
    super(fmt("en", message));
    this.name = "PromptplanError";
    this.i18n = message;
  }
}

/** Text for any error in the given language. Unknown errors keep their own message. */
export function errorText(error: unknown, lang: Lang): string {
  if (error instanceof PromptplanError) return fmt(lang, error.i18n);
  const e = error as NodeJS.ErrnoException;
  if (lang !== "en" && typeof e?.code === "string" && /^E[A-Z0-9]+$/.test(e.code))
    return t(lang, "os.error", { code: e.code, message: e.message });
  return error instanceof Error ? error.message : String(error);
}

/** The i18n part for a PlanError / PlanWarning built from a message. */
export function planText(message: Msg): { message: string; i18n: Msg } {
  return { message: fmt("en", message), i18n: message };
}

/** Pick the language of one environment variable value: starts with "ko" → ko, anything else → en. */
function langOfValue(value: string): Lang {
  return value.trim().toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** Language from the environment: PROMPTPLAN_LANG, then LC_ALL, LC_MESSAGES, LANG (first non-empty wins). */
export function langFromEnv(env: Record<string, string | undefined>): Lang {
  for (const name of ["PROMPTPLAN_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") return langOfValue(value);
  }
  return "en";
}

export function isLang(value: string): value is Lang {
  return value === "en" || value === "ko";
}

/** Look for --lang <v> / --lang=<v> in raw arguments (before "--"), so even argument errors can be localized. */
export function langFlagFromArgv(argv: readonly string[]): string | undefined {
  let found: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") break;
    if (arg === "--lang") {
      const next = argv[i + 1];
      if (next !== undefined) found = next;
    } else if (arg.startsWith("--lang=")) found = arg.slice("--lang=".length);
  }
  return found;
}

/** --lang flag > environment. An invalid flag value is ignored here (the CLI reports it separately). */
export function resolveLang(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  if (flag !== undefined && isLang(flag)) return flag;
  return langFromEnv(env);
}
