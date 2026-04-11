// src/types/index.ts
// PhotoPick AI 전체 프로젝트에서 사용하는 타입(인터페이스) 정의 모음
// 각 단계(필터 → 중복제거 → 분석)의 입출력 구조를 여기서 관리합니다

// ─────────────────────────────────────────────────────────
// 공통 열거형(Enum 대체 유니온 타입)
// ─────────────────────────────────────────────────────────

/** 분석 파이프라인의 현재 진행 단계
 *  idle → filtering → deduping → analyzing → done 순서로 진행 */
export type AnalysisStage = 'idle' | 'filtering' | 'deduping' | 'analyzing' | 'done';

/** 사진 품질 등급 (절대 점수 기준)
 *  S(85+) A(70+) B(55+) C(40+) D(40 미만) */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 인스타그램 지원 크롭 비율
 *  4:5=세로 피드, 1:1=정사각형, 1.91:1=가로 피드, 9:16=릴스 */
export type AspectRatio = '1:1' | '4:5' | '1.91:1' | '9:16';

/** 감점 유형 코드 — UI에서 아이콘/색상 매핑에 사용 */
export type PenaltyType =
  | 'eyes_closed'      // 눈 감음 (EAR < 0.15)
  | 'half_blink'       // 반쯤 감음 (EAR 0.15~0.22)
  | 'mouth_open'       // 입 벌림 (랜드마크 13-14 거리)
  | 'double_chin'      // 이중 턱 (pitch 각도 과대)
  | 'tilted'           // 고개 기울어짐 (tilt 각도 과대)
  | 'blown_highlight'  // 하이라이트 날림 — 과노출로 밝은 픽셀 15% 초과
  | 'heavy_shadow';    // 과도한 그림자 — 어두운 픽셀 10% 초과

// ─────────────────────────────────────────────────────────
// 공통 데이터 구조
// ─────────────────────────────────────────────────────────

/** 단일 감점 요소 — 패널티 목록에 담겨 DetailedAnalysis에 포함됨 */
export interface Penalty {
  type: PenaltyType;
  score: number;        // 감점값 (음수, 예: -15). 최종 점수에 × 0.5 로 반영
  description: string;  // 사용자에게 표시할 한국어 설명
}

/** EXIF 메타데이터 — 촬영 정보 (중복 제거 시간 비교에도 활용) */
export interface ExifData {
  dateTime: Date | null;              // 촬영 일시 (중복 제거 30초 이내 비교용)
  camera: string;                     // "제조사 모델명" 문자열
  focalLength: number | null;         // 초점 거리 (mm)
  iso: number | null;                 // ISO 감도
  gps: { lat: number; lng: number } | null; // GPS 좌표
}

/** 얼굴 위치·크기 정보 — 구도/표정 분석 및 크롭 기준점 산출에 사용
 *  analyze.worker 에서 피부색 픽셀 분포로 추정 (640px 리사이즈 기준 절대 좌표) */
export interface FaceData {
  centerX: number;          // 얼굴 중심 X 좌표 (px, 640px 기준)
  centerY: number;          // 얼굴 중심 Y 좌표 (px, 640px 기준)
  width: number;            // 얼굴 영역 너비 (px)
  height: number;           // 얼굴 영역 높이 (px)
  yaw: number;              // 좌우 회전각 (도) — 현재 미사용(0 고정)
  pitch: number;            // 상하 회전각 (도) — 현재 미사용(0 고정)
  eyeAspectRatio: number;   // 양눈 평균 EAR (0.3 고정 — MediaPipe 미사용)
  smileScore: number;       // 미소 점수 0~100 (expressionScore 와 동일값)
}

/** 3차 정밀 분석 최종 결과 — PhotoData.analysis 에 저장됨 */
export interface DetailedAnalysis {
  compositionScore: number;   // 구도 점수 0~100 (삼분법+헤드룸+얼굴크기)
  expressionScore: number;    // 표정 점수 0~100 (밝기+좌우대칭+디테일)
  qualityScore: number;       // 화질 점수 0~100 (선명도 60% + 노출 40%)
  lightingScore: number;      // 조명 점수 0~100 (히스토그램 엔트로피)
  backgroundScore: number;    // 배경 점수 0~100 (경계 색상 다양성)
  // 포즈·패션 점수 (모든 사진에 포함 — 클로즈업이면 0점)
  poseScore: number;          // 포즈 점수 0~100 (전신: 바디필+균형+역동성, 클로즈업: 0)
  fashionScore: number;       // 패션 점수 0~100 (전신: 색상조화+자신감, 클로즈업: 0)
  isFullBody: boolean;        // 전신 사진 여부 (얼굴 < 이미지 높이 18%)
  totalScore: number;         // 가중 합산 종합 점수 0~100
  grade: Grade;               // 절대 점수 기준 등급 (S/A/B/C/D)
  penalties: Penalty[];       // 감점 요소 목록
  tips: string[];             // 다음 촬영 개선 팁 (UI 하단 표시용)
  faceData: FaceData;         // 크롭 기준점 산출에 사용하는 얼굴 데이터
}

/** 1차 필터 결과 — 블러·노출·피부색 통과 여부 판정 */
export interface FilterResult {
  passed: boolean;          // 3가지 조건 모두 통과 시 true
  sharpness: number;        // Laplacian 분산값 (기준: ≥50 통과)
  brightness: number;       // 평균 밝기 0~255 (기준: 40~230)
  hasFace: boolean;         // 피부색 비율 5% 초과 시 인물 있다고 판정
  faceSize: number;         // 전체 픽셀 중 피부색 비율 (0~1)
  rejectReason?: string;    // 탈락 시 사유 문자열 (UI 표시용)
}

/** 전체 파이프라인 결과를 한 곳에 담는 핵심 엔티티
 *  업로드 → 필터 → 중복제거 → 분석 순으로 필드가 채워짐 */
export interface PhotoData {
  id: string;             // 업로드 시 생성되는 고유 ID (crypto.randomUUID)
  file: File;             // 원본 파일 참조 (다운로드/크롭 시 직접 사용)
  fileName: string;       // 표시용 파일명
  thumbnailUrl: string;   // 200×200 Object URL — 그리드 표시 후 revoke 필요

  exif: ExifData | null;  // EXIF 파싱 결과 (중복제거 시간 비교에 사용)

  // 1차 필터 결과 (filtering 단계에서 채워짐)
  filterResult: FilterResult | null;

  // 2차 중복 제거 결과 (deduping 단계에서 채워짐)
  phash: string | null;       // 64비트 퍼셉추얼 해시 (16진수 16자리)
  groupId: string | null;     // 유사 사진 클러스터 ID (예: "group_0")
  isGroupBest: boolean;       // 같은 그룹 중 선명도 최고 사진이면 true

  // 3차 정밀 분석 결과 (analyzing 단계에서 채워짐)
  analysis: DetailedAnalysis | null;
}

// ─────────────────────────────────────────────────────────
// Web Worker 메시지 타입 (메인 스레드 ↔ Worker 통신)
// ─────────────────────────────────────────────────────────

/** 1차 필터 Worker 입력 — ArrayBuffer로 전송해 복사 비용 없음 */
export interface FilterWorkerInput {
  fileBuffer: ArrayBuffer;  // Transferable — 메인 스레드에서 소유권 이전
  fileName: string;
  id: string;
}

/** 2차 중복 제거 Worker 입력 */
export interface DedupWorkerInput {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
  dateTime: number | null;  // EXIF 촬영 시각 timestamp (ms) — 시간 유사도 비교용
}

/** 2차 중복 제거 Worker 출력 */
export interface DedupWorkerOutput {
  id: string;
  phash: string;  // 계산된 퍼셉추얼 해시 (실패 시 randomUUID 반환)
}

/** 3차 정밀 분석 Worker 입력 */
export interface AnalyzeWorkerInput {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
}

/** 3차 정밀 분석 Worker 출력 */
export interface AnalyzeWorkerOutput {
  id: string;
  analysis: DetailedAnalysis;  // 분석 실패 시 전 항목 35점 D등급 반환
}
