"use client"; // ← 이 줄만 추가하면 됩니다!

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";
import { getAdviceResult, AdviceResponse, queueAdviceJob } from "@/lib/api";

type DongOption = {
  id: number;
  name: string;
  code: string;
};

const toFriendlyLinks = (text: string): string => {
  // http로 시작하는 URL을 전부 [술집 구경하기](url) 형식으로 교체
  return text.replace(
    /(https?:\/\/[^\s)]+)/g,
    (url) => `[술집 구경하기](${url})`
  );
};

const BAR_TYPES = [
  "와인바",
  "이자카야",
  "포장마차/포차",
  "스포츠 펍",
  "칵테일바",
  "호프집",
  "아직 고민 중",
];

const CAPITAL_LEVELS = [
  { label: "소규모", desc: "5천만 원 이하" },
  { label: "중간", desc: "5천만 ~ 1.5억 원" },
  { label: "고급", desc: "1.5억 원 이상" },
];

const TARGET_AGES = [
  "20대 위주",
  "20~30대 직장인",
  "30~40대 중심",
  "40대 이상 단골 위주",
];

export default function Home() {
  const [step, setStep] = useState(0);
  const [_selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedDongId, setSelectedDongId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [barType, setBarType] = useState("");
  const [capital, setCapital] = useState("");
  const [targetAge, setTargetAge] = useState("");
  const [userQuestion, setUserQuestion] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dongOptions, setDongOptions] = useState<DongOption[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("idle");
  const [streamText, setStreamText] = useState<string>("");
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "streaming" | "done" | "error" | "stopped"
  >("idle");

  const esRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef<number>(0);

  useEffect(() => {
    return () => closeStream();
  }, []);

  const [adviceResult, setAdviceResult] = useState<AdviceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageLabel = (s: string) => {
    switch (s) {
      case "subscribed":
        return "연결됨";
      case "start":
        return "작업 시작";
      case "fetch_report":
        return "리포트 데이터 수집 중";
      case "fetch_report_done":
        return "리포트 데이터 수집 완료";
      case "generate_advice":
        return "조언 작성 중(스트리밍)";
      case "generate_advice_done":
        return "조언 작성 마무리";
      case "stopped":
        return "사용자가 중지함";
      case "error":
        return "오류 발생";
      default:
        return s || "진행 중";
    }
  };
  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  const fetchFinalResult = async (jid: string): Promise<AdviceResponse> => {
    // done 직후 GET이 아주 잠깐 늦을 수 있어서 2~3초만 가볍게 재시도
    const deadline = Date.now() + 3000;
    while (true) {
      const r = await getAdviceResult(jid);
      if (r.status === "completed" && r.result) return r.result;
      if (r.status === "failed")
        throw new Error(r.failedReason ?? "조언 생성 실패");
      if (Date.now() > deadline)
        throw new Error("완료 결과를 불러오지 못했습니다(타임아웃).");
      await new Promise((x) => setTimeout(x, 300));
    }
  };

  const openStream = (jid: string) => {
    closeStream();

    // 브라우저에서는 API_BASE가 "/api"였지? SSE도 동일하게 프록시로 태우자
    const url = `/api/report/advice/${jid}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    setStreamStatus("streaming");

    es.addEventListener("progress", (ev: any) => {
      try {
        const data = JSON.parse(ev.data);
        if (data?.stage) setStage(data.stage);
      } catch {}
    });

    es.addEventListener("delta_snapshot", (ev: any) => {
      try {
        const data = JSON.parse(ev.data);
        const seq = Number(data?.seq ?? 0);
        const text = typeof data?.text === "string" ? data.text : "";

        if (text && seq >= lastSeqRef.current) {
          lastSeqRef.current = seq;
          setStreamText(text); // ✅ replace
        }
      } catch {}
    });

    es.addEventListener("delta", (ev: any) => {
      try {
        const data = JSON.parse(ev.data);
        const seq = Number(data?.seq ?? 0);
        const text = typeof data?.text === "string" ? data.text : "";

        if (text && seq > lastSeqRef.current) {
          lastSeqRef.current = seq;
          setStreamText((prev) => prev + text); // ✅ append
        }
      } catch {}
    });

    es.addEventListener("done", async () => {
      try {
        setStreamStatus("done");
        closeStream();

        const final = await fetchFinalResult(jid);
        setAdviceResult(final); // ✅ 최종 확정(places 포함)
        setIsLoading(false);
      } catch (e: any) {
        setStreamStatus("error");
        setError(e?.message ?? "완료 처리 중 오류");
        setIsLoading(false);
      }
    });

    // 서버가 event: error 를 보내는 경우
    es.addEventListener("error", (ev: any) => {
      // 네트워크 에러도 여기로 올 수 있어서 data 파싱 가능한지로 구분
      if (typeof ev?.data === "string") {
        try {
          const data = JSON.parse(ev.data);
          setError(data?.detail ?? data?.message ?? "스트리밍 오류");
        } catch {
          setError("스트리밍 오류");
        }
        setStreamStatus("error");
        closeStream();
        setIsLoading(false);
      }
    });

    // 진짜 네트워크 끊김
    es.onerror = () => {
      // 여기선 즉시 종료만 하고, 필요하면 "폴링 복구"로 이어갈 수 있음
      setError("SSE 연결이 끊겼습니다. (네트워크/프록시 확인)");
      setStreamStatus("error");
      closeStream();
      setIsLoading(false);
    };
  };

  useEffect(() => {
    // 검색어 없으면 리스트 비우기
    if (!searchQuery.trim()) {
      setDongOptions([]);
      return;
    }
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/dong/search?q=${encodeURIComponent(searchQuery)}`
        );
        const data: DongOption[] = await res.json();
        setDongOptions(data);
      } catch (e) {
        console.error(e);
        setDongOptions([]);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: "smooth" });
  };
  const handleGenerateReport = async () => {
    if (!selectedDongId) {
      setError("먼저 창업할 동네를 선택해 주세요.");
      return;
    }
    if (!barType || !capital || !targetAge) {
      setError("Q2의 항목(술집 타입, 자본, 타깃 연령대)을 모두 선택해 주세요.");
      return;
    }

    setIsLoading(true);
    setShowReport(true);
    setError(null);
    setAdviceResult(null);

    setTimeout(() => scrollToSection("report-section"), 0);

    // ✅ 스트리밍용 상태 초기화
    setStreamText("");
    setStage("idle");
    setStreamStatus("idle");
    lastSeqRef.current = 0;

    try {
      const jid = await queueAdviceJob({
        dongId: selectedDongId,
        concept: barType,
        budgetLevel: capital,
        targetAge,
        openHours: "저녁 시간대 중심",
        question: userQuestion,
      });

      setJobId(jid);
      setStage("subscribed"); // UI 선반영(서버도 subscribed 줌)
      openStream(jid); // ✅ SSE 시작
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "리포트를 생성하는 중 오류가 발생했습니다.");
      setIsLoading(false);
    }
  };

  const showBanner = streamStatus !== "idle" && streamStatus !== "done";
  const bannerTitle =
    streamStatus === "stopped"
      ? "중지됨"
      : streamStatus === "error"
      ? "오류"
      : "생성 중";

  const handleStop = async () => {
    // 1) 프론트: 즉시 끊고 "멈춤" 상태
    setStreamStatus("stopped");
    setIsLoading(false);
    closeStream();

    // 2) 백엔드: best-effort cancel (엔드포인트 없으면 이 부분은 나중에)
    if (!jobId) return;
    try {
      await fetch(`/api/report/advice/${jobId}/cancel`, { method: "POST" });
    } catch {
      // cancel이 아직 없거나 실패해도 UX는 "멈춤" 유지
    }
  };

  const handleRetry = async () => {
    // 새 jobId로 다시 시작 (A: 기존 텍스트 보존을 원하면 streamText를 다른 state에 저장하고 비우지 마)
    closeStream();
    setStreamStatus("idle");
    setIsLoading(false);
    await handleGenerateReport();
  };

  return (
    <div className="min-h-screen bg-gradient-instagram">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm bg-surface/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-surface">Snap Report</h1>
          <div className="hidden md:flex gap-8">
            <button className="text-surface hover:text-surface/80 transition-colors">
              About
            </button>
            <button className="text-surface hover:text-surface/80 transition-colors">
              How it works
            </button>
            <button className="text-surface hover:text-surface/80 transition-colors">
              Contact
            </button>
          </div>
        </div>
      </nav>

      {showBanner && (
        <div className="fixed top-[72px] left-0 right-0 z-[70]">
          <div className="mx-auto max-w-4xl px-6">
            <div className="rounded-2xl bg-surface/95 backdrop-blur border border-border shadow-lg px-4 py-3 flex items-center justify-between">
              <div className="text-sm">
                <span className="font-semibold text-primary">
                  {bannerTitle}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {stageLabel(stage)}
                </span>
              </div>

              <div className="flex gap-2">
                {/* ✅ streaming일 때만 '중지' 노출 */}
                {streamStatus === "streaming" && (
                  <Button variant="outline" size="sm" onClick={handleStop}>
                    ⏹ 중지
                  </Button>
                )}

                {/* ✅ stopped/error 상태면 "계속 받기"로 같은 jobId 스트림 재연결 */}
                {(streamStatus === "stopped" || streamStatus === "error") &&
                  jobId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openStream(jobId)}
                    >
                      ▶ 계속 받기
                    </Button>
                  )}

                {/* ✅ 언제든 재시도 가능 */}
                <Button variant="secondary" size="sm" onClick={handleRetry}>
                  ↻ 다시 시도
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center px-6 pt-20">
        <div className="max-w-4xl mx-auto text-center animate-fade-in">
          <h2 className="text-6xl md:text-8xl font-bold text-surface mb-6">
            Snap Report
          </h2>
          <p className="text-2xl md:text-3xl text-surface mb-4 font-medium">
            1인 술집 창업자를 위한
            <br />
            상권·매출 기반 AI 컨설팅 리포트 서비스
          </p>
          <p className="text-lg md:text-xl text-surface/90 mb-8 max-w-2xl mx-auto leading-relaxed">
            행정동 상권 데이터와 AI 분석으로,
            <br />
            "내가 이 동네에 술집을 내면 어떨지"를 한 페이지 리포트로
            알려드립니다.
          </p>
          <Button
            onClick={() => {
              setStep(1);
              scrollToSection("onboarding-section");
            }}
            size="lg"
            className="bg-surface text-primary hover:bg-surface/90 text-xl px-12 py-6 rounded-full shadow-2xl hover:shadow-surface/50 transition-all hover:scale-105"
          >
            지금 상권 진단해보기
          </Button>
          <p className="text-surface/80 mt-6 text-sm">
            5분 안에 나만의 상권 리포트 만들기
          </p>
        </div>
      </section>

      {/* Onboarding Section */}
      <section
        id="onboarding-section"
        className="min-h-screen flex items-center justify-center px-6 py-20"
      >
        <div className="max-w-2xl w-full mx-auto">
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-3 mb-12">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className={`flex items-center ${num < 3 ? "gap-3" : ""}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                    step >= num
                      ? "bg-surface text-primary scale-110"
                      : "bg-surface/30 text-surface"
                  }`}
                >
                  {num}
                </div>
                {num < 3 && (
                  <div
                    className={`w-12 h-1 rounded transition-all ${
                      step > num ? "bg-surface" : "bg-surface/30"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Location */}
          {step === 1 && (
            <Card className="p-8 animate-slide-up bg-surface/95 backdrop-blur border-none shadow-2xl">
              <h3 className="text-3xl font-bold mb-2">
                Q1. 어느 동네에서 창업을 준비 중이신가요?
              </h3>
              <p className="text-muted-foreground mb-6">
                실제로 가게를 열고 싶은 서울 행정동을 선택해 주세요.
              </p>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="동 이름을 입력하세요 (예: 연남동, 상계5동…)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 py-6 text-lg rounded-2xl"
                />
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2 mb-8">
                {dongOptions.length === 0 && !!searchQuery && (
                  <div className="text-sm text-muted-foreground px-2">
                    검색 결과가 없습니다. 다른 동 이름을 입력해 보세요.
                  </div>
                )}

                {dongOptions.map((dong) => (
                  <button
                    key={dong.id}
                    onClick={() => {
                      setSelectedDongId(dong.id);
                      setSelectedDistrict(dong.name);
                      setSearchQuery(dong.name);
                    }}
                    className={`w-full text-left p-4 rounded-xl transition-all ${
                      selectedDongId === dong.id
                        ? "bg-gradient-instagram-alt text-surface shadow-lg scale-105"
                        : "bg-muted hover:bg-muted/80"
                    }`}
                  >
                    <div className="font-bold text-lg">{dong.name}</div>
                    {/* 구 이름 따로 없으니까 이 줄은 제거 */}
                  </button>
                ))}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedDongId}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 rounded-full px-8"
                >
                  다음으로
                </Button>
              </div>
            </Card>
          )}

          {/* Step 2: Concept */}
          {step === 2 && (
            <Card className="p-8 animate-slide-up bg-surface/95 backdrop-blur border-none shadow-2xl">
              <h3 className="text-3xl font-bold mb-2">
                Q2. 어떤 술집을 계획하고 계신가요?
              </h3>
              <p className="text-muted-foreground mb-8">
                가게의 분위기, 준비된 자본, 주 타깃 연령대를 골라 주세요.
              </p>

              <div className="space-y-8">
                {/* Bar Type */}
                <div>
                  <h4 className="font-semibold text-lg mb-4">술집 타입 선택</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {BAR_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => setBarType(type)}
                        className={`p-4 rounded-2xl font-medium transition-all ${
                          barType === type
                            ? "bg-gradient-instagram-alt text-surface shadow-lg scale-105"
                            : "bg-muted hover:bg-muted/80"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Capital */}
                <div>
                  <h4 className="font-semibold text-lg mb-4">
                    준비하신 자본 규모를 골라 주세요
                  </h4>
                  <div className="space-y-3">
                    {CAPITAL_LEVELS.map((cap) => (
                      <button
                        key={cap.label}
                        onClick={() => setCapital(cap.label)}
                        className={`w-full p-4 rounded-2xl text-left transition-all ${
                          capital === cap.label
                            ? "bg-gradient-instagram-alt text-surface shadow-lg"
                            : "bg-muted hover:bg-muted/80"
                        }`}
                      >
                        <div className="font-bold">{cap.label}</div>
                        <div className="text-sm opacity-80">{cap.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Age */}
                <div>
                  <h4 className="font-semibold text-lg mb-4">
                    주로 어떤 연령대를 타깃으로 하시나요?
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {TARGET_AGES.map((age) => (
                      <button
                        key={age}
                        onClick={() => setTargetAge(age)}
                        className={`p-4 rounded-2xl font-medium transition-all ${
                          targetAge === age
                            ? "bg-gradient-instagram-alt text-surface shadow-lg scale-105"
                            : "bg-muted hover:bg-muted/80"
                        }`}
                      >
                        {age}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-8">
                <Button
                  onClick={() => setStep(1)}
                  variant="outline"
                  size="lg"
                  className="rounded-full px-8"
                >
                  이전으로
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!barType || !capital || !targetAge}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 rounded-full px-8"
                >
                  다음으로
                </Button>
              </div>
            </Card>
          )}

          {/* Step 3: Question */}
          {step === 3 && (
            <Card className="p-8 animate-slide-up bg-surface/95 backdrop-blur border-none shadow-2xl">
              <h3 className="text-3xl font-bold mb-2">
                Q3. 지금 가장 고민되는 점을 적어 주세요
              </h3>
              <p className="text-muted-foreground mb-6">
                예를 들어, "이 동네에 와인바가 이미 너무 많은지 궁금해요", "30대
                직장인 손님을 많이 끌고 싶은데, 가능할까요?" 처럼 편하게 적어
                주세요.
              </p>

              <Textarea
                placeholder="예: 이 동네에서 조용한 와인바를 운영하고 싶은데, 경쟁이 얼마나 되는지와 손님이 어느 시간대에 몰리는지 알고 싶어요."
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                rows={6}
                className="mb-4 rounded-2xl text-lg p-6"
              />
              <p className="text-sm text-muted-foreground mb-8">
                비워두셔도 리포트는 생성됩니다.
              </p>

              <div className="flex justify-between">
                <Button
                  onClick={() => setStep(2)}
                  variant="outline"
                  size="lg"
                  className="rounded-full px-8"
                >
                  이전으로
                </Button>
                <Button
                  onClick={handleGenerateReport}
                  size="lg"
                  className="bg-gradient-instagram-alt hover:opacity-90 text-surface rounded-full px-8 shadow-2xl hover:scale-105 transition-all"
                >
                  리포팅 뽑아보기
                </Button>
              </div>
            </Card>
          )}
        </div>
      </section>
      {/* Report Section */}
      {(showReport || isLoading) && (
        <section
          id="report-section"
          className="min-h-screen flex items-center justify-center px-6 py-20"
        >
          <div className="max-w-4xl w-full mx-auto">
            <Card className="p-8 md:p-12 animate-slide-up bg-surface/95 backdrop-blur border-none shadow-2xl">
              {/** ✅ streamedAdvice 우선, 없으면 adviceResult.advice */}
              {(() => {
                const adviceText = streamText || adviceResult?.advice || "";

                if (isLoading && !adviceText) {
                  // 🔄 스트리밍 텍스트가 아직 0글자면 스켈레톤
                  return (
                    <div className="space-y-6">
                      <div className="h-8 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                      <div className="h-12 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                      <div className="space-y-3">
                        <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                        <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                        <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                      </div>
                    </div>
                  );
                }

                if (adviceText) {
                  return (
                    <>
                      <div className="text-sm text-primary font-semibold mb-2">
                        AI 상권 리포트
                      </div>
                      <h2 className="text-4xl font-bold mb-6">
                        {adviceResult?.report?.dong?.name ?? "선택한 동네"} 술집
                        상권 분석 & 창업 조언
                      </h2>

                      <div className="prose prose-invert max-w-none text-foreground/90">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: (props) => (
                              <a
                                {...props}
                                className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
                                target="_blank"
                                rel="noreferrer"
                              />
                            ),
                            h2: (props) => (
                              <h2
                                {...props}
                                className="text-2xl font-bold mt-6 mb-3 text-primary"
                              />
                            ),
                            h3: (props) => (
                              <h3
                                {...props}
                                className="text-xl font-semibold mt-4 mb-2 text-secondary"
                              />
                            ),
                            li: (props) => (
                              <li {...props} className="leading-relaxed" />
                            ),
                            p: (props) => (
                              <p {...props} className="leading-relaxed" />
                            ),
                          }}
                        >
                          {toFriendlyLinks(adviceText)}
                        </ReactMarkdown>
                      </div>

                      {/* ✅ places는 최종 adviceResult가 생겼을 때만 표시 */}
                      {!!adviceResult?.places?.length && (
                        <div className="mt-8 border-t border-border pt-6">
                          <h3 className="text-lg font-semibold mb-3 text-primary">
                            주변 실제 술집 예시 (카카오)
                          </h3>
                          <ul className="space-y-2 text-sm text-foreground/90">
                            {adviceResult.places.map((p, idx) => (
                              <li key={idx}>
                                <span className="font-medium">{p.name}</span>
                                <span className="ml-1 text-muted-foreground">
                                  ({p.category})
                                </span>
                                {p.url && (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="ml-2 text-sky-300 underline"
                                  >
                                    지도 보기
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {error && (
                        <div className="mt-4 text-sm text-red-400 bg-red-500/10 px-4 py-2 rounded-lg">
                          {error}
                        </div>
                      )}
                    </>
                  );
                }

                return (
                  <div className="text-sm text-muted-foreground">
                    {error
                      ? error
                      : "아직 리포트 데이터가 없습니다. 다시 시도해 주세요."}
                  </div>
                );
              })()}
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
