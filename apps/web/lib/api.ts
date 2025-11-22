// lib/api.ts
const API_BASE =
  typeof window === "undefined"
    // 서버(SSR/빌드)에서는 기존 env나 localhost 사용
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000")
    // 브라우저(클라이언트)에서는 무조건 Vercel rewrite 경로 사용
    : "/api";

export type AdviceRequest = {
  dongId: number;
  budgetLevel: string;
  concept: string;
  targetAge: string;
  openHours: string;
  question?: string;
};

export type AdvicePlace = {
  name: string;
  category: string;
  url?: string | null;
};

export type AdviceResponse = {
  report: {
    dong: {
      id: number;
      name: string;
      code: string | null;
    };
    // 나머지 필드는 지금 안 써도 되면 생략해도 됨. (필요해지면 확장)
  };
  advice: string; // LLM이 만들어준 마크다운 텍스트
  places: AdvicePlace[];
};

export async function fetchAdvice(
  payload: AdviceRequest
): Promise<AdviceResponse> {
  const res = await fetch(`${API_BASE}/report/advice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch advice (${res.status}) ${res.statusText} ${text}`
    );
  }

  return res.json();
}