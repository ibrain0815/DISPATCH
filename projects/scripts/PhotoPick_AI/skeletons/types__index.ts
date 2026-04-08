// src/types/index.ts
// PhotoPick AI — 전체 데이터 구조 타입 정의

/** 분석 파이프라인 단계 */
export type AnalysisStage = 'idle' | 'filtering' | 'deduping' | 'analyzing' | 'done';

/** 등급 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 인스타 크롭 비율 */
export type AspectRatio = '1:1' | '4:5' | '1.91:1' | '9:16';

/** 감점 유형 */
export type PenaltyType =
  | 'eyes_closed'    // 눈 감음 (EAR < 0.15)
  | 'half_blink'     // 반쯤 감음 (EAR 0.15~0.22)
  | 'mouth_open'     // 입 벌림
  | 'double_chin'    // 이중 턱 (pitch 각도)
  | 'tilted'         // 고개 기울어짐
  | 'blown_highlight'// 하이라이트 클리핑
  | 'heavy_shadow';  // 과도한 그림자

/** 감점 요소 */
export interface Penalty {
  type: PenaltyType;
  score: number;       // 감점값 (음수, 예: -20)
  description: string; // 사용자에게 보여줄 설명
}

/** EXIF 데이터 */
export interface ExifData {
  dateTime: Date | null;
  camera: string;
  focalLength: number | null;
  iso: number | null;
  gps: { lat: number; lng: number } | null;
}

/** 얼굴 정보 (크롭 & 표정 분석용) */
export interface FaceData {
  centerX: number;         // 정규화 좌표 (0~1)
  centerY: number;
  width: number;           // 사진 대비 너비 비율
  height: number;          // 사진 대비 높이 비율
  yaw: number;             // 좌우 회전각 (도)
  pitch: number;           // 상하 회전각 (도)
  eyeAspectRatio: number;  // 양눈 평균 EAR
  smileScore: number;      // 미소 점수 0~100
}

/** 정밀 분석 결과 */
export interface DetailedAnalysis {
  compositionScore: number;  // 구도 0~100
  expressionScore: number;   // 표정 0~100
  qualityScore: number;      // 화질 0~100 (블러+노출)
  lightingScore: number;     // 조명 0~100
  backgroundScore: number;   // 배경 0~100
  totalScore: number;        // 종합 0~100
  grade: Grade;
  penalties: Penalty[];
  tips: string[];            // 개선 포인트 (UI 표시용)
  faceData: FaceData;
}

/** 1차 필터 결과 */
export interface FilterResult {
  passed: boolean;
  sharpness: number;   // Laplacian 분산값 (기준: ≥50)
  brightness: number;  // 평균 밝기 0~255 (기준: 40~230)
  hasFace: boolean;    // 피부색 비율 기반 간이 판정
  faceSize: number;    // 피부색 픽셀 비율
  rejectReason?: string;
}

/** 개별 사진 데이터 — 전체 파이프라인 결과를 담는 메인 엔티티 */
export interface PhotoData {
  id: string;           // crypto.randomUUID()
  file: File;           // 원본 파일 참조
  fileName: string;
  thumbnailUrl: string; // 200×200 Object URL (표시 후 revoke)

  exif: ExifData | null;

  // 1차 필터 결과
  filterResult: FilterResult | null;

  // 2차 중복 제거
  phash: string | null;      // 64비트 퍼셉추얼 해시 (16진수 문자열)
  groupId: string | null;    // 유사 사진 클러스터 ID
  isGroupBest: boolean;      // 그룹 내 sharpness 최고 여부

  // 3차 정밀 분석
  analysis: DetailedAnalysis | null;
}

/** Worker 메시지 타입 */
export interface FilterWorkerInput {
  fileBuffer: ArrayBuffer;
  fileName: string;
  id: string;
}

export interface DedupWorkerInput {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
  dateTime: number | null; // timestamp (ms)
}

export interface DedupWorkerOutput {
  id: string;
  phash: string;
}

export interface AnalyzeWorkerInput {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
}

export interface AnalyzeWorkerOutput {
  id: string;
  analysis: DetailedAnalysis;
}
