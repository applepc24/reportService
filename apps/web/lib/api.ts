// lib/api.ts
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

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
    // Next 13+에서 클라이언트 컴포넌트에서 부르는 거라면 cache: "no-store" 안줘도 되지만
    // 필요하면 추가:
    // cache: "no-store",
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