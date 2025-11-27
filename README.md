# SnapReport (v1) — AI 상권 리포트 생성기

**1인 술집 창업자를 위한** 상권·매출·트래픽 지표 + **Trend RAG(Agent)** + AI 조언을 결합해  
“내가 이 동네에 술집을 내면 어떨지”를 **한 페이지 리포트**로 만들어주는 서비스입니다.

- Frontend: Next.js (Wizard UI)
- Backend: NestJS (Report API + Worker)
- Infra: AWS EC2 + RDS(PostgreSQL) + Redis

> 핵심: **느린 LLM을 API에서 분리**하고(BullMQ), **RAG Agent + 캐싱**으로 비용/지연을 줄여 “사용자 대기 UX”를 제거했습니다.

---

## Demo
- https://report-service-ebon.vercel.app/
- API Health: `GET /health`

---

## Key Features

### 1) Wizard 기반 리포트 생성 UX
- 행정동 검색 → 컨셉/예산/타깃 입력 → 고민 질문 → 리포트 생성
- 결과는 `jobId` 기반 비동기 Polling으로 표시 (UI 멈춤/타임아웃 방지)

### 2) “상권 지표 리포트” (일부 동 지원)
- 행정동 단위로 지표를 모아 “지금 창업해도 되는지” 판단 근거 제공
- 포함 지표(프로젝트에 존재하는 테이블 기준):
  - `traffic_metrics` (유동/트래픽)
  - `store_metrics` (상가/점포)
  - `sales_metrics` (매출)
  - `facility_metrics` (시설/인프라)
  - `ta_change_metrics` (TA 변화)
  - `poi_pub` + `review` (주변 술집/리뷰)
- **현재 v1에서는 데이터가 적재된 “일부 동”만 완전한 결과가 나옵니다.**

### 3) Trend RAG (Agentic RAG)
- 사용자의 질문/컨셉을 바탕으로 **트렌드 검색 쿼리를 생성**하고(LLM),
- 네이버 블로그에서 관련 글을 수집 → 요약/임베딩 저장 → Hybrid 검색으로 컨텍스트 구성
- 최종적으로 “상권 데이터 + 트렌드 근거 + 창업 조언”까지 한 번에 생성

**TrendDocs 파이프라인**
1. LLM이 “트렌드 검색어” 생성 (fallback 포함)
2. Naver Blog 검색
3. 문서 저장 + 임베딩(RAG 저장)
4. Hybrid Search로 관련 문서만 리트리브
5. LLM이 최종 조언 생성

### 4) Async Job Queue (BullMQ) + Worker
- API는 즉시 응답하고, 오래 걸리는 작업은 Worker에서 처리합니다.
- `/report/advice` → `jobId` 반환 → `/report/advice/:jobId`로 상태 Polling

### 5) Redis Cache
- 동일 조건의 RAG/리포트는 캐싱으로 재계산 감소
- 실제 로그에서 `[CACHE HIT] ragKey=...` 확인 가능

---

## Architecture (High-level)

![Architecture](docs/snapreport.drawio.png)

- DB: PostgreSQL(RDS), 테이블: `dong`, `traffic_metrics`, `store_metrics`, `sales_metrics`, `facility_metrics`, `ta_change_metrics`, `poi_pub`, `review`, `trend_docs` 등

---

## Tech Stack

### Frontend
- Next.js / React / TypeScript
- TailwindCSS + shadcn/ui
- Wizard UI + 결과 렌더링(ReactMarkdown)

### Backend
- NestJS / TypeScript
- TypeORM + PostgreSQL (RDS)
- BullMQ + ioredis (Job Queue / Worker)
- External APIs
  - OpenAI (조언 생성 / 트렌드 쿼리 생성)
  - Naver Blog Search (트렌드 문서 수집)
  - Kakao Local (주변 술집 POI 예시)

### Infra
- AWS EC2
- AWS RDS (PostgreSQL, SSL)
- Redis (Queue/Cache)

---

## API Overview

### 1) 동 검색
- `GET /dong/search?q=방배`
  - 행정동 검색 자동완성

### 2) 리포트 생성 (비동기)
- `POST /report/advice`
  - body: `dongId`, `concept`, `budget`, `age`, `hours`, `question` 등
  - response: `{ jobId }`

### 3) 결과 Polling
- `GET /report/advice/:jobId`
  - 상태: `waiting | active | completed | failed`
  - completed 시 리포트/조언 반환

### 4) Health (운영 확인)
- `GET /health`
- `GET /health/bullmq-test`

---

## Database (v1)

- `dong`: 행정동 마스터
- `traffic_metrics`: 트래픽 지표
- `store_metrics`: 상가/점포 지표
- `sales_metrics`: 매출 지표
- `facility_metrics`: 시설 지표
- `ta_change_metrics`: TA 변화 지표
- `poi_pub`: 주변 술집 POI
- `review`: 리뷰
- `trend_docs`: 트렌드 문서(네이버 기반 RAG 저장소)

> v1 데이터는 “일부 동”만 완전 적재되어 있으며, 나머지는 점진적으로 확장 예정입니다.

## Performance Test (k6) Summary

> 결론 한 줄: **서버/DB/Redis 병목은 거의 없고, 전체 체감 지연은 LLM(특히 advice completion)이 지배**합니다.  
> 그래서 v1에서는 **BullMQ + Worker로 LLM 작업을 API에서 분리**해 UX(대기/타임아웃)를 제거했고, **RAG 캐싱**으로 반복 비용을 줄였습니다.

---

### 1) Latency Breakdown (로그 기반)

#### A. “쿼리/리포트만” (외부 의존성 OFF)
- `POST /report/advice` (순수 쿼리/리포트 로직): **~165ms**
- `buildReport TOTAL`: **~155–186ms**
  - dong+quarterSeries: ~49–74ms  
  - Promise.all(metrics + kakao): ~105–112ms

✅ 의미: **DB/서버 자체는 빠름**

#### B. “풀 파이프라인” (RAG + LLM ON)
- `generateAdvice TOTAL`: **~25–32s**
  - `OpenAI advice completion`: **~17–43s** (가장 큰 비중)
  - `RAG searchHybrid`: **~0.3–2.0s**
  - `Naver searchBlogs`: **~150–165ms**
  - `saveFromNaverBlogs (embed + save)`: 최적화 후 **0–40ms** 수준

✅ 의미: **E2E 지연의 대부분은 LLM**이 결정

---

### 2) 구조 개선 효과 (Blocking → Queue)

| 항목 | 개선 전 (블로킹) | 개선 후 (BullMQ + Worker + Polling) | 효과 |
| --- | --- | --- | --- |
| 요청 흐름 | API가 LLM 끝날 때까지 대기 | API는 즉시 `jobId` 반환 | UX 지연/타임아웃 제거 |
| 안정성 | 느린 요청이 API 자원 점유 | LLM은 Worker에서 격리 | 장애 전파 차단 |
| RAG 반복 비용 | 매 요청마다 Hybrid + 저장 | 캐싱/중복 제거 | 반복 비용 감소 |
| 확장 방식 | API scale만으로 한계 | Worker scale로 처리량 확장 | 수평 확장 용이 |

---

### 3) k6 시나리오 별 결과

#### S1 — Smoke Test (기능 검증)
- 시나리오: `POST 1회 → Polling → Completed`
- 성공률: **100%**
- 평균 HTTP 응답시간: **~2.52ms**
- E2E (LLM OFF): **~1.0s**

#### S2 — Baseline (단일 사용자 반복)
- 반복: 5회
- 평균 iteration duration (LLM ON): **~35.3s**
- HTTP 실패율: **0%**

#### S3 — Load Test (VU 30 동시)
- `http_req_failed`: **0%**
- HTTP latency: **~3–7ms**
- 처리량:
  - **~16.4 rps (HTTP)**  
  - **~5.46 rps (E2E, Polling 포함)**

✅ 결론: **서버/Redis/DB는 VU 30에서도 안정적**이며, 병목은 LLM 대기열/응답시간

---

### 4) LLM 포함 시 “운영 Sweet Spot” 가이드

LLM ON 환경에서는 동시 요청이 커질수록 **대기열 누적 → E2E 증가**가 명확했습니다.

| 시나리오 | VU | 평균 E2E(LLM 포함) | p95 | HTTP 지연(ms) | 실패율 |
| --- | --- | --- | --- | --- | --- |
| s4 | 1–3 | ~31s | ~37s | 4–7ms | 0% |
| s5 | 5 | 28–29s | ~34.6s | 3–5ms | 0% |
| s6 | 10 | ~34.4s | ~48s | 3–5ms | 0% |
| s7 | 20 | ~52.6s | ~90s | 3–5ms | 0% |
| s8 | 30 | ~56.6s | ~98s | 3–7ms | 0% |
| s9 | 40 | ~87.6s | ~147s | 3–7ms | 0% |

**권장 운영 범위:** 동시 요청 **10–20 VU** (UX + 대기열 균형)

---

### 5) Cache 효과 (RAG 재사용)

- 캐시 MISS 시: `searchHybrid` **~400–1500ms**
- 캐시 HIT 시: RAG 재계산 회피(로그에서 `[CACHE HIT] ragKey=...` 확인)

> 참고: 최종 E2E는 여전히 LLM 응답시간이 지배하지만, **RAG 비용/지연을 안정적으로 제거**해 변동성을 줄였습니다.

