// 작은 공용 함수들. 출력이 실행 환경(로캘·키 순서)에 따라 달라지지 않게 하는 것이 목적이다.

/** 코드포인트 순 비교 — localeCompare 는 로캘마다 결과가 달라 쓰지 않는다. */
export function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 정렬 + 중복 제거. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byCodepoint);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 키를 정렬해서 JSON 으로 만든다(객체 안쪽까지). 같은 값이면 언제나 같은 문자열. */
export function stableStringify(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(byCodepoint)) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** 작업 목록을 최대 limit 개씩 동시에 돌리고, 결과는 입력 순서대로 돌려준다. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
