// k6/s9-llm-stress-40vu.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

export const adviceE2E = new Trend("advice_e2e_ms");

export const options = {
  scenarios: {
    llm_40vu: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },  // 워밍업
        { duration: "40s", target: 20 },  // 슬슬 올리고
        { duration: "1m", target: 40 },   // 40 VU 도달
        { duration: "1m", target: 40 },   // 40 VU 유지
        { duration: "40s", target: 0 },   // 내려오기
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // LLM end-to-end 95%가 3분 이내면 "그래도 버틴다" 수준으로 보자
    advice_e2e_ms: ["p(95)<180000"],

    // HTTP 에러율은 여전히 1% 미만 유지 목표
    http_req_failed: ["rate<0.01"],
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

  const started = Date.now();

  const queued = postAdvice(payload);
  if (!queued.jobId) return;

  const result = pollAdvice(queued.jobId, 1500, 180000);

  const e2eMs = Date.now() - started;
  adviceE2E.add(e2eMs);

  check(result, {
    completed: (x) => x.ok === true && x.status === "completed",
  });

  // VU가 너무 빽빽하게 새 요청 안 던지게 1초 정도 쉬어줌
  sleep(1);
}