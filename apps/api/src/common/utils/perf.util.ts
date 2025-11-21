// apps/api/src/common/utils/perf.util.ts

/**
 * PERF_FAKE_EXTERNAL 환경변수가 "true"면
 * 외부 API(OpenAI, 네이버, 카카오 등)를 실제로 호출하지 않고
 * 페이크 응답을 쓰는 모드로 동작하게 만든다.
 */
export function isPerfFakeExternal(): boolean {
  return process.env.PERF_FAKE_EXTERNAL === "false";
}

export function isPerfFakeLLM(): boolean {
  return process.env.PERF_FAKE_LLM === "false";
}

export function isPerfFakeDB(): boolean {
  return process.env.PERF_FAKE_DB === "false";
}

/**
 * 간단한 sleep 유틸 (네트워크 레이턴시 흉내낼 때 사용)
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fakeLLMResponse(tag: string) {
  return `
  [FAKE LLM:${tag}]
  - perf 측정용 더미 응답입니다.
  - 외부(OpenAI) 호출 없이 서버/DB 비용만 측정합니다.
  `.trim();
}
