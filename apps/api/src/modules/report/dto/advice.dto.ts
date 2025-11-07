export interface AdviceDto {
    dongId: number;         // 동 ID
    budgetLevel: string;    // 예: "낮음" | "중간" | "높음"
    concept: string;        // 예: "와인바", "포차", "조용한바"
    targetAge: string;      // 예: "20-30대"
    openHours?: string;     // 예: "저녁 중심", "심야 위주"
    question: string;       // 사용자가 실제로 입력한 질문
  }