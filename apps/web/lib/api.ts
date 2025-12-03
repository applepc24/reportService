function getApiBase() {
  const isServer = typeof window === "undefined";
  if (isServer) {
    // SSR/빌드/서버액션에서는 절대주소 필요
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  }
  return "/api";
}

const API_BASE = getApiBase();

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
  };
  advice: string;
  places: AdvicePlace[];
};
export type AdviceJobQueuedResponse = {
  ok: true;
  jobId: string;
  status: "queued";
};

// 2) 공통 fetch 유틸 (에러 메시지 통일)
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${path} failed (${res.status}) ${res.statusText} ${text}`
    );
  }

  return res.json();
}

// ---- 실제 API 함수 ----
export async function fetchAdviceSync(
  payload: AdviceRequest
): Promise<AdviceResponse> {
  return fetchJson<AdviceResponse>("/report/advice-sync", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// apps/web/lib/api.ts

export async function requestAdviceAsync(
  payload: AdviceRequest,
  opts?: {
    intervalMs?: number;
    maxWaitMs?: number;
    onTick?: (status: AdviceJobResultResponse["status"]) => void;
  }
): Promise<AdviceResponse> {
  // 1) 큐에 넣고 jobId 받기
  const queued = await fetchJson<AdviceJobQueuedResponse>("/report/advice", {
    method: "POST",
    body: JSON.stringify({
      dongId: payload.dongId,
      options: {
        budgetLevel: payload.budgetLevel,
        concept: payload.concept,
        targetAge: payload.targetAge,
        openHours: payload.openHours,
      },
      question: payload.question ?? "",
    }),
  });

  const jobId = queued.jobId;
  const intervalMs = opts?.intervalMs ?? 1500;
  const maxWaitMs = opts?.maxWaitMs ?? 100_000;
  const startedAt = Date.now();

  // 2) 폴링하면서 completed 될 때까지 기다렸다가 최종 AdviceResponse 반환
  while (true) {
    const res = await getAdviceResult(jobId);
    opts?.onTick?.(res.status);

    if (res.status === "completed") {
      if (!res.result) throw new Error("completed인데 result가 없습니다.");
      return res.result;
    }

    if (res.status === "failed") {
      throw new Error(res.failedReason ?? "조언 생성 실패");
    }

    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error("조언 생성이 너무 오래 걸려서 중단했습니다.");
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export type AdviceJobResultResponse = {
  ok: boolean;
  status:
    | "waiting"
    | "active"
    | "completed"
    | "failed"
    | "delayed"
    | "not_found";
  result: AdviceResponse | null;
  failedReason?: string | null;
};

export async function getAdviceResult(
  jobId: string
): Promise<AdviceJobResultResponse> {
  return fetchJson<AdviceJobResultResponse>(`/report/advice/${jobId}`);
}


export async function queueAdviceJob(payload: AdviceRequest): Promise<string> {
  const queued = await fetchJson<AdviceJobQueuedResponse>("/report/advice", {
    method: "POST",
    body: JSON.stringify({
      dongId: payload.dongId,
      options: {
        budgetLevel: payload.budgetLevel,
        concept: payload.concept,
        targetAge: payload.targetAge,
        openHours: payload.openHours,
      },
      question: payload.question ?? "",
    }),
  });

  return queued.jobId;
}
