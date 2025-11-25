import http from "k6/http";
import { sleep, check } from "k6";
import { Trend } from "k6/metrics";

// end-to-end 시간(큐 넣고 완료까지)
const e2eTrend = new Trend("advice_e2e_ms");

// ✅ Smoke: VU 1명만, 1번만 실행
export const options = {
  vus: 1,
  iterations: 1,
};

// 환경변수로 바꿀 수 있게
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

function postAdvice() {
  const url = `${BASE_URL}/report/advice`;
  const payload = {
    dongId: 295, // 방배1동 같은 고정값
    options: {
      concept: "와인바",
      budgetLevel: "고급",
      targetAge: "30대",
      openHours: "저녁~심야",
    },
    question: "주변상권과 잘 어울리는 고급스러운 와인바를 차리고 싶어",
  };

  const res = http.post(url, JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });

  check(res, {
    "POST /report/advice 200": (r) => r.status === 201,
    "POST has jobId": (r) => !!r.json("jobId"),
  });

  return res.json("jobId");
}

function pollResult(jobId) {
  const url = `${BASE_URL}/report/advice/${jobId}`;

  const start = Date.now();
  const maxWaitMs = 30_000; // smoke는 30초 타임아웃

  while (true) {
    const res = http.get(url);
    check(res, { "GET status 200": (r) => r.status === 200 });

    const status = res.json("status");

    if (status === "completed") {
      const elapsed = Date.now() - start;
      e2eTrend.add(elapsed);

      check(res, {
        "result exists": (r) => r.json("result") !== null,
      });
      return;
    }

    if (status === "failed" || status === "not_found") {
      throw new Error(`job failed: status=${status}`);
    }

    if (Date.now() - start > maxWaitMs) {
      throw new Error("poll timeout");
    }

    sleep(1); // 1초마다 폴링
  }
}

export default function () {
  const jobId = postAdvice();
  pollResult(jobId);
}