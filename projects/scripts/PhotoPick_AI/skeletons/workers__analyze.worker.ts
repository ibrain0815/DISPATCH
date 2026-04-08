// src/workers/analyze.worker.ts
// 3차 정밀 분석 Worker: MediaPipe Face Mesh + 구도/표정/조명/배경 종합

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';
import { compositionTotalScore, ruleOfThirdsScore, gazeLeadingSpaceScore, headroomScore, tiltScore } from '../engine/composition';
import { evaluateExpression } from '../engine/expression';
import { exposureScore } from '../engine/exposure';
import { computeLaplacianVariance, sharpnessScore } from '../engine/blur';
import { buildAnalysis } from '../engine/scorer';
import type { AnalyzeWorkerInput, AnalyzeWorkerOutput, FaceData } from '../types';

// MediaPipe Face Mesh 초기화 (Worker 내에서 1회)
// NOTE: @mediapipe/face_mesh를 CDN에서 로드하거나 public/models에서 로드
let faceMesh: any = null;

async function initFaceMesh() {
  if (faceMesh) return faceMesh;

  // TODO: import { FaceMesh } from '@mediapipe/face_mesh'; 로 변경 가능
  // Worker 환경에서 WASM 경로 설정 필요
  const { FaceMesh } = await import('@mediapipe/face_mesh');
  faceMesh = new FaceMesh({
    locateFile: (file: string) => `/models/face_mesh/${file}`,
  });
  await faceMesh.initialize();
  return faceMesh;
}

self.onmessage = async (e: MessageEvent<AnalyzeWorkerInput>) => {
  const { id, fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    const fm = await initFaceMesh();

    // 640px 리사이즈 (MediaPipe 권장 해상도)
    const { imageData, originalWidth, originalHeight } = await loadAndResize(file, 640, 640);
    const gray = toGrayscale(imageData);
    const histogram = computeHistogram(gray);

    // ── 화질 점수 ───────────────────────────────────────
    const sharpVar = computeLaplacianVariance(gray, imageData.width, imageData.height);
    const sharp = sharpnessScore(sharpVar);
    const { score: expScore } = exposureScore(histogram, gray.length);
    const qualityScore = Math.round(sharp * 0.6 + expScore * 0.4);

    // ── MediaPipe 얼굴 분석 ──────────────────────────────
    // createImageBitmap → HTML Canvas → MediaPipe
    const bitmap = await createImageBitmap(imageData);

    let faceData: FaceData = {
      centerX: 0.5, centerY: 0.4,
      width: 0.3, height: 0.4,
      yaw: 0, pitch: 0,
      eyeAspectRatio: 0.3,
      smileScore: 50,
    };

    let compositionScore = 50;
    let expressionScore = 50;
    const penalties: any[] = [];

    fm.onResults((results: any) => {
      if (!results.multiFaceLandmarks?.[0]) return;
      const lm = results.multiFaceLandmarks[0]; // 468개 랜드마크

      // 얼굴 bbox (정규화 좌표)
      const xs = lm.map((p: any) => p.x);
      const ys = lm.map((p: any) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);

      const w = imageData.width;
      const h = imageData.height;

      faceData = {
        centerX: ((minX + maxX) / 2) * w,
        centerY: ((minY + maxY) / 2) * h,
        width: (maxX - minX) * w,
        height: (maxY - minY) * h,
        yaw: 0,   // TODO: 3D 랜드마크로 각도 추정
        pitch: 0,
        eyeAspectRatio: 0.3,
        smileScore: 50,
      };

      // 구도 점수
      const rot = ruleOfThirdsScore({ x: faceData.centerX, y: faceData.centerY }, w, h);
      const gaze = gazeLeadingSpaceScore({ x: faceData.centerX, y: faceData.centerY }, faceData.yaw, w);
      const hr = headroomScore({ x: minX * w, y: minY * h, width: faceData.width, height: faceData.height }, h);
      const tilt = tiltScore(
        { x: lm[33].x * w, y: lm[33].y * h },
        { x: lm[263].x * w, y: lm[263].y * h }
      );
      compositionScore = compositionTotalScore({ ruleOfThirds: rot, gazeSpace: gaze, headroom: hr, tilt });

      // 표정 점수
      const expr = evaluateExpression(lm);
      expressionScore = expr.score;
      faceData.eyeAspectRatio = expr.eyeAspectRatio;
      faceData.smileScore = expr.smile;
      penalties.push(...expr.penalties);
    });

    await fm.send({ image: bitmap });
    bitmap.close();

    // ── 조명/배경 (간이 구현 — Phase 4에서 고도화) ──────
    const lightingScore = 70; // TODO: 조명 방향 분석
    const backgroundScore = 70; // TODO: BodyPix 배경 분리

    // ── 최종 분석 조립 ───────────────────────────────────
    const analysis = buildAnalysis({
      qualityScore,
      expressionScore,
      compositionScore,
      lightingScore,
      backgroundScore,
      penalties,
      tips: [],
      faceData,
    });

    const result: AnalyzeWorkerOutput = { id, analysis };
    self.postMessage(result);
  } catch (err) {
    // 분석 실패 시 기본값으로 처리 (필터는 통과했으므로 C등급)
    const fallback: AnalyzeWorkerOutput = {
      id,
      analysis: {
        compositionScore: 50, expressionScore: 50, qualityScore: 50,
        lightingScore: 50, backgroundScore: 50, totalScore: 50,
        grade: 'C', penalties: [], tips: ['분석 중 오류가 발생했습니다'],
        faceData: { centerX: 0.5, centerY: 0.4, width: 0.3, height: 0.4, yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 50 },
      },
    };
    self.postMessage(fallback);
  }
};
