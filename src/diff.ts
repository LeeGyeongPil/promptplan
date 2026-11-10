// 줄 단위 unified diff — LCS(최장 공통 부분열)로 직접 구현해 의존성을 늘리지 않는다.
// 프롬프트는 길어야 수백 줄이라 O(n·m) 표로 충분하다.

export interface DiffOptions {
  context?: number;
}

type Op = { kind: " " | "-" | "+"; line: string };

// 표가 너무 커지면(아주 긴 프롬프트) 줄 맞추기 대신 "전부 지우고 전부 추가"로 보여 준다.
const MAX_CELLS = 4_000_000;

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [...a.map((line) => ({ kind: "-" as const, line })), ...b.map((line) => ({ kind: "+" as const, line }))];
  }
  // table[i][j] = a[i..], b[j..] 의 LCS 길이 (뒤에서부터 채운다)
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }
  // 앞에서부터 따라가며 같은 줄은 " ", a 만 있으면 "-", b 만 있으면 "+"
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i] as string });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) {
      ops.push({ kind: "-", line: a[i] as string });
      i++;
    } else {
      ops.push({ kind: "+", line: b[j] as string });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "-", line: a[i++] as string });
  while (j < m) ops.push({ kind: "+", line: b[j++] as string });
  return ops;
}

/**
 * a → b 의 unified diff 본문(hunk 들)을 줄 목록으로 돌려준다. 같으면 빈 목록.
 * 머리줄(---/+++)은 호출하는 쪽이 붙인다.
 */
export function unifiedDiff(a: string[], b: string[], options: DiffOptions = {}): string[] {
  const context = options.context ?? 3;
  const ops = lcsOps(a, b);
  if (ops.every((op) => op.kind === " ")) return [];

  // 바뀐 줄 위치를 모아 앞뒤 context 줄과 함께 hunk 로 묶는다.
  const changed: number[] = [];
  ops.forEach((op, index) => {
    if (op.kind !== " ") changed.push(index);
  });
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  // 각 op 앞까지 a·b 에서 몇 줄을 지났는지 세어 두면 hunk 머리의 줄 번호를 바로 구할 수 있다.
  const aBefore: number[] = [];
  const bBefore: number[] = [];
  let aCount = 0;
  let bCount = 0;
  for (const op of ops) {
    aBefore.push(aCount);
    bBefore.push(bCount);
    if (op.kind !== "+") aCount++;
    if (op.kind !== "-") bCount++;
  }

  const out: string[] = [];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end);
    const aLen = slice.filter((op) => op.kind !== "+").length;
    const bLen = slice.filter((op) => op.kind !== "-").length;
    // unified diff 규칙: 길이가 0 이면 시작 번호는 "그 앞 줄" 번호
    const aStart = aLen === 0 ? (aBefore[start] as number) : (aBefore[start] as number) + 1;
    const bStart = bLen === 0 ? (bBefore[start] as number) : (bBefore[start] as number) + 1;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  return out;
}
