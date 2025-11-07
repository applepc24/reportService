'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from '../../styles/report.module.css';

type Step = 1 | 2 | 3;

type AdviceRequestBody = {
  dongId: number;
  budgetLevel: string;
  concept: string;
  targetAge: string;
  openHours: string;
  question: string;
};

type AdviceResponse = {
  advice: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export default function ReportWizardPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);

  const [dongId, setDongId] = useState<string>('1');
  const [budgetLevel, setBudgetLevel] = useState<string>('중간');
  const [concept, setConcept] = useState<string>('');
  const [targetAge, setTargetAge] = useState<string>('20-30대');
  const [openHours, setOpenHours] = useState<string>('저녁 중심');
  const [question, setQuestion] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);

  const goNext = () => {
    setError(null);
    if (currentStep < 3) {
      setCurrentStep((prev) => (prev + 1) as Step);
    }
  };

  const goPrev = () => {
    setError(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as Step);
    }
  };

  const handleGenerateReport = async () => {
    setError(null);
    setLoading(true);
    setReportMarkdown(null);

    const body: AdviceRequestBody = {
      dongId: Number(dongId),
      budgetLevel,
      concept: concept || '미정',
      targetAge,
      openHours,
      question:
        question.trim() ||
        '이 조건에서 이 동네에서 술집 창업을 할 때 전반적인 상권 분석과 전략을 알려줘.',
    };

    try {
      const res = await fetch(`${API_BASE}/report/advice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('advice error:', text);
        throw new Error(`리포팅 API 오류: ${res.status}`);
      }

      const data: AdviceResponse = await res.json();
      setReportMarkdown(data.advice);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? '리포팅 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => {
    const budgetPresets = ['낮음', '중간', '높음'];

    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>1. 기본 정보</h2>
        <p className={styles.cardDesc}>
          어디 동네에서 어느 정도 예산으로 시작할지 알려주세요.
        </p>

        <div>
          <label className={styles.label}>행정동 ID</label>
          <input
            type="number"
            value={dongId}
            onChange={(e) => setDongId(e.target.value)}
            className={`${styles.input} ${styles.inputSmall}`}
          />
          <span className={styles.inputHint}>
            (예: 1 → 연남동, 나중에 자동완성으로 바꿀 예정)
          </span>
        </div>

        <div>
          <div className={styles.label}>예산 수준</div>
          <div className={styles.chipGroup}>
            {budgetPresets.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBudgetLevel(b)}
                className={`${styles.chip} ${
                  budgetLevel === b ? styles.chipGreenActive : ''
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  };

  const renderStep2 = () => {
    const conceptPresets = ['와인바', '포차', '이자카야', '조용한 바', '칵테일 바'];
    const targetAgePresets = ['20-30대', '30-40대', '넓게(20-40대)'];
    const openHourPresets = ['저녁 중심', '심야 위주', '주말 위주'];

    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>2. 컨셉 & 타깃</h2>
        <p className={styles.cardDesc}>
          어떤 분위기의 술집을 누구에게 팔고 싶은지 선택해 주세요.
        </p>

        {/* 컨셉 */}
        <div>
          <div className={styles.label}>술집 컨셉</div>
          <div className={styles.chipGroup}>
            {conceptPresets.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConcept(c)}
                className={`${styles.chip} ${
                  concept === c ? styles.chipIndigoActive : ''
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            placeholder="직접 입력 (예: 내추럴와인 바, LP바 등)"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            className={styles.input}
          />
        </div>

        {/* 타깃 연령 */}
        <div>
          <div className={styles.label}>타깃 연령대</div>
          <div className={styles.chipGroup}>
            {targetAgePresets.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTargetAge(t)}
                className={`${styles.chip} ${
                  targetAge === t ? styles.chipOrangeActive : ''
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            placeholder="예: 20대 후반 위주, 30-40대 직장인 등"
            value={targetAge}
            onChange={(e) => setTargetAge(e.target.value)}
            className={styles.input}
          />
        </div>

        {/* 영업 시간대 */}
        <div>
          <div className={styles.label}>영업 시간대</div>
          <div className={styles.chipGroup}>
            {openHourPresets.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOpenHours(o)}
                className={`${styles.chip} ${
                  openHours === o ? styles.chipSkyActive : ''
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          <input
            placeholder="예: 평일 저녁 + 주말 심야, 주 5일 운영 등"
            value={openHours}
            onChange={(e) => setOpenHours(e.target.value)}
            className={styles.input}
          />
        </div>
      </section>
    );
  };

  const renderStep3 = () => {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          3. 마지막으로, 하고 싶은 말
        </h2>
        <p className={styles.cardDesc}>
          리포트에 꼭 반영되었으면 하는 고민이나 상황이 있다면 적어주세요.
          <br />
          아무것도 안 적으면 기본적으로 이 조건에서의 전체 상권 분석을 해줄 거예요.
        </p>

        <textarea
          rows={5}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className={styles.textarea}
          placeholder={`예시)
- 연남동에서 조용한 와인바를 하고 싶은데, 기존 가게들과 어떻게 차별화해야 할까?
- 예산이 크지 않은데 인테리어/메뉴/마케팅 중 어디에 더 투자하는 게 좋을까?
- 직장인 퇴근 이후 손님을 타깃으로 잡고 싶어.`}
        />

        <button
          type="button"
          onClick={handleGenerateReport}
          disabled={loading}
          className={`${styles.btnPrimary} ${
            loading ? styles.btnPrimaryLoading : ''
          }`}
        >
          {loading ? '리포팅 생성 중…' : '리포팅 분석 시작'}
        </button>
      </section>
    );
  };

  return (
    <main className={styles.main}>
      {/* 헤더 */}
      <header className={styles.header}>
        <h1 className={styles.title}>
          🍶 PubInsight Seoul — 술집 창업 설문 리포팅
        </h1>
        <p className={styles.subtitle}>
          3단계 설문을 마치면, 선택한 동네와 조건을 기반으로 데이터 기반 창업 리포트를 만들어 줄게.
        </p>
      </header>

      {/* 스텝 인디케이터 */}
      <section className={styles.stepBar}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`${styles.stepItem} ${
              currentStep === s ? styles.stepItemActive : ''
            }`}
          >
            {s === 1 && '1. 기본'}
            {s === 2 && '2. 컨셉'}
            {s === 3 && '3. 디테일'}
          </div>
        ))}
      </section>

      {/* 에러 */}
      {error && <div className={styles.error}>{error}</div>}

      {/* 스텝 카드 */}
      {currentStep === 1 && renderStep1()}
      {currentStep === 2 && renderStep2()}
      {currentStep === 3 && renderStep3()}

      {/* 이전/다음 버튼 */}
      <section className={styles.navBar}>
        <button
          type="button"
          onClick={goPrev}
          disabled={currentStep === 1}
          className={
            currentStep === 1
              ? `${styles.btn} ${styles.btnOutlineDisabled}`
              : `${styles.btn} ${styles.btnOutline}`
          }
        >
          이전
        </button>
        {currentStep < 3 && (
          <button
            type="button"
            onClick={goNext}
            className={`${styles.btn} ${styles.btnNext}`}
          >
            다음
          </button>
        )}
      </section>

      {/* 리포트 결과 */}
      <section className={styles.resultCard}>
        <h2 className={styles.resultTitle}>🧾 리포트 결과</h2>
        {loading && (
          <div className={styles.resultPlaceholder}>
            데이터와 조건을 바탕으로 리포트를 작성 중입니다…
          </div>
        )}
        {!loading && reportMarkdown && (
          <div className={styles.resultText}>
            <ReactMarkdown>{reportMarkdown}</ReactMarkdown>
          </div>
        )}
        {!loading && !reportMarkdown && (
          <div className={styles.resultPlaceholder}>
            설문을 마치고 <b>“리포팅 분석 시작”</b> 버튼을 누르면 결과가 여기에 나와요.
          </div>
        )}
      </section>
    </main>
  );
}
