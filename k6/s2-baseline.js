import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    baseline: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 5,          // ✅ 5번만 실제 end-to-end
      maxDuration: "30m",
    },
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";

// ---- util ----
function postAdvice(payload) {
  const res = http.post(
    `${BASE}/report/advice`,
    JSON.stringify(payload),
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, {
    "POST status 201/200": (r) => r.status === 201 || r.status === 200,
  });

  return res.json();
}

function pollAdvice(jobId, intervalMs = 1500, maxWaitMs = 60000) {
  const started = Date.now();

  while (true) {
    const r = http.get(`${BASE}/report/advice/${jobId}`);

    check(r, {
      "GET status 200": (x) => x.status === 200,
    });

    const body = r.json();
    const status = body.status;

    if (status === "completed") return body;
    if (status === "failed" || status === "not_found") return body;

    if (Date.now() - started > maxWaitMs) {
      return { ok: false, status: "timeout" };
    }

    sleep(intervalMs / 1000);
  }
}

// ---- main flow ----
export default function () {
  const payload = {
    dongId: 295,
    options: {
      concept: "와인바",
      budgetLevel: "고급",
      targetAge: "30대",
      openHours: "저녁~심야",
    },
    question: "주변 상권과 어울리는 고급 와인바 전략이 궁금해",
  };

  const queued = postAdvice(payload);

  check(queued, {
    "POST has jobId": (x) => !!x.jobId,
  });

  const result = pollAdvice(queued.jobId);

  check(result, {
    "final completed": (x) => x.ok === true && x.status === "completed",
  });

  sleep(1);
}