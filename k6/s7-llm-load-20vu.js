import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

export const adviceE2E = new Trend("advice_e2e_ms", true);

export const options = {
  scenarios: {
    llm_20vu: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "1m", target: 10 },
        { duration: "1m", target: 15 },
        { duration: "1m", target: 20 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    // s6에서 p95가 48s였으니까, s7은 90~120s 사이로 "안전선" 잡자
    advice_e2e_ms: ["p(95)<120000"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";

function postAdvice(payload) {
  const res = http.post(
    `${BASE}/report/advice`,
    JSON.stringify(payload),
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, {
    "POST 201/200": (r) => r.status === 201 || r.status === 200,
  });

  return res.json();
}

function pollAdvice(jobId, intervalMs = 1500, maxWaitMs = 180000) {
  const started = Date.now();

  while (true) {
    const r = http.get(`${BASE}/report/advice/${jobId}`);
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

  const t0 = Date.now();

  const queued = postAdvice(payload);
  if (!queued.jobId) return;

  const result = pollAdvice(queued.jobId, 1500, 180000);

  const e2e = Date.now() - t0;
  adviceE2E.add(e2e);

  check(result, {
    "completed": (x) => x.ok === true && x.status === "completed",
  });

  sleep(1);
}