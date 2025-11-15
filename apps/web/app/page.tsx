"use client"; // ← 이 줄만 추가하면 됩니다!

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";
import { fetchAdvice, AdviceResponse } from "@/lib/api";

type DongOption = {
  id: number;
  name: string;
  code: string;
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
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedDongId, setSelectedDongId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [barType, setBarType] = useState("");
  const [capital, setCapital] = useState("");
  const [targetAge, setTargetAge] = useState("");
  const [userQuestion, setUserQuestion] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dongOptions, setDongOptions] = useState<DongOption[]>([]);

  const [adviceResult, setAdviceResult] = useState<AdviceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 검색어 없으면 리스트 비우기
    if (!searchQuery.trim()) {
      setDongOptions([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await fetch(
          `${
            process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000"
          }/dong/search?q=${encodeURIComponent(searchQuery)}`
        );
        const data: DongOption[] = await res.json();
        setDongOptions(data);
      } catch (e) {
        console.error(e);
        setDongOptions([]);
      }
    }, 300); // 0.3초 디바운스

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
    setShowReport(true); // 리포트 영역으로 스크롤만 먼저
    setError(null);

    try {
      const result = await fetchAdvice({
        dongId: selectedDongId,
        concept: barType,
        budgetLevel: capital,
        targetAge,
        // 아직 UI에 운영시간 질문 없으니까 일단 기본 값 하나 넘겨두자
        openHours: "저녁 시간대 중심",
        question: userQuestion,
      });

      setAdviceResult(result);
      // 응답 받은 행정동 이름을 타이틀에 쓰고 싶으면:
      setSelectedDistrict(result.report.dong.name);
      scrollToSection("report-section");
    } catch (e: any) {
      console.error(e);
      setError(
        e?.message ??
          "리포트를 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setIsLoading(false);
    }
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
              {isLoading ? (
                // 🔄 로딩 스켈레톤 그대로 사용
                <div className="space-y-6">
                  <div className="h-8 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                  <div className="h-12 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                  <div className="space-y-3">
                    <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                    <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                    <div className="h-6 bg-gradient-to-r from-muted via-muted/50 to-muted rounded animate-shimmer bg-[length:1000px_100%]" />
                  </div>
                </div>
              ) : adviceResult ? (
                <>
                  <div className="text-sm text-primary font-semibold mb-2">
                    AI 상권 리포트
                  </div>
                  <h2 className="text-4xl font-bold mb-6">
                    {adviceResult.report.dong.name} 술집 상권 분석 & 창업 조언
                  </h2>

                  {/* LLM이 준 마크다운 텍스트 그대로 보여주기 (간단히 pre 태그) */}
                  <div className="prose prose-invert max-w-none text-foreground/90">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                      {adviceResult.advice}
                    </pre>
                  </div>

                  {/* 주변 실제 술집 예시 */}
                  {adviceResult.places.length > 0 && (
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
              ) : (
                // showReport=true 이지만 adviceResult가 아직 없을 때
                <div className="text-sm text-muted-foreground">
                  아직 리포트 데이터가 없습니다. 다시 시도해 주세요.
                </div>
              )}
            </Card>
          </div>
        </section>
      )}
      {isLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface/95 rounded-2xl px-8 py-6 shadow-xl text-center max-w-sm mx-4">
            <div className="mb-4 flex justify-center">
              <div className="h-10 w-10 rounded-full border-4 border-surface/40 border-t-primary animate-spin" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              리포트를 만들고 있어요
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              동별 상권 데이터와 AI 분석을 조합해서
              <br />
              맞춤 리포트를 생성하는 중입니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
