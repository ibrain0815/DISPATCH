// src/components/HelpModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 프로그램 소개 및 사용 설명서 모달
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const GRADES = [
  { grade: 'S', color: 'bg-yellow-400 text-black', score: '85점+', desc: '완성도 높은 전신 패션 사진. 포즈·패션·화질이 모두 우수합니다.' },
  { grade: 'A', color: 'bg-green-500 text-white',  score: '70점+', desc: '좋은 전신 사진. 포즈 또는 패션 코디가 잘 나왔습니다.' },
  { grade: 'B', color: 'bg-blue-500 text-white',   score: '55점+', desc: '기본 품질을 갖춘 사진. 클로즈업 우수작 또는 전신 보통 수준.' },
  { grade: 'C', color: 'bg-gray-400 text-white',   score: '40점+', desc: '아쉬운 부분이 있는 사진. 개선 팁을 참고하세요.' },
  { grade: 'D', color: 'bg-red-400 text-white',    score: '~39점', desc: '품질이 낮거나 인물이 없는 사진.' },
];

const METRICS = [
  { icon: '📷', label: '화질',   desc: '선명도(흔들림)와 노출 상태를 평가합니다. 심각하게 흔들렸거나 화이트아웃/블랙아웃된 사진은 낮은 점수를 받습니다.' },
  { icon: '📐', label: '구도',   desc: '삼분법 교차점 배치, 머리 위 여백(헤드룸), 피사체 크기 비율을 기준으로 채점합니다.' },
  { icon: '💡', label: '조명',   desc: '밝기 분포의 다양성(히스토그램 엔트로피)으로 입체감 있는 조명을 평가합니다.' },
  { icon: '🌿', label: '배경',   desc: '배경의 단순도를 측정합니다. 흰 벽·단색 배경일수록 높은 점수를 받습니다.' },
  { icon: '😊', label: '표정',   desc: '얼굴 밝기, 좌우 대칭, 윤곽 선명도로 표정 상태를 평가합니다.' },
  { icon: '🧍', label: '포즈',   desc: '전신 사진 전용. 발끝 여백, 바디 채움, 자세 균형·역동성을 채점합니다.' },
  { icon: '👗', label: '패션',   desc: '전신 사진 전용. 의상 색상 조화(모노크롬·유사색·보색 등)를 평가합니다.' },
];

const STEPS = [
  {
    step: '01',
    title: '사진 업로드',
    desc: '화면 중앙에 사진 폴더를 드래그&드롭하거나, 클릭하여 파일을 선택합니다. JPG·PNG·HEIC 등 주요 형식을 지원하며 1,000장 이상도 처리 가능합니다.',
  },
  {
    step: '02',
    title: '자동 분석',
    desc: '3단계 파이프라인이 자동 실행됩니다.\n① 1차 필터: 심각한 흔들림·화이트아웃·인물 없는 사진 제거\n② 중복 제거: 유사 사진 그룹화 후 대표 1장 선별\n③ 정밀 분석: 7가지 지표로 채점 후 S~D 등급 산출',
  },
  {
    step: '03',
    title: '결과 확인',
    desc: '등급 탭(ALL·S·A·B·C·D)으로 분류된 사진을 확인합니다. 사진을 클릭하면 항목별 상세 점수·감점 요소·개선 팁이 표시됩니다.',
  },
  {
    step: '04',
    title: '사진 선택',
    desc: '원하는 사진을 클릭하여 선택(파란 테두리)하거나, 상단의 "전체 선택"을 사용합니다. 선택된 사진 수는 오른쪽 상단에 표시됩니다.',
  },
  {
    step: '05',
    title: '크롭 & 다운로드',
    desc: '하단 바에서 크롭 비율(1:1·4:5·3:4·9:16)을 선택한 뒤 "ZIP 다운로드" 버튼을 누르면 선택한 사진이 크롭되어 압축 파일로 저장됩니다.',
  },
];

export function HelpModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col mx-4">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">📸</span>
            <h2 className="text-lg font-bold text-gray-900">PhotoPick AI 도움말</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 스크롤 콘텐츠 */}
        <div className="overflow-y-auto px-6 py-5 space-y-7">

          {/* 프로그램 소개 */}
          <section>
            <h3 className="text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide">프로그램 소개</h3>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 leading-relaxed">
              <p>
                <strong className="text-gray-800">PhotoPick AI</strong>는 수백~수천 장의 패션·인물 사진을 자동으로 분석하여
                인스타그램에 올릴 최적의 베스트샷을 골라주는 AI 선별 도구입니다.
              </p>
              <p className="mt-2">
                화질·구도·조명·배경·표정 5가지 기본 지표와 전신 사진 전용 포즈·패션 2가지를 합산한
                <strong className="text-gray-800"> 7가지 지표의 평균 점수</strong>로 S~D 등급을 산출합니다.
                중복 촬영된 사진 그룹에서는 가장 높은 점수의 사진 1장만 추려냅니다.
              </p>
            </div>
          </section>

          {/* 사용 방법 */}
          <section>
            <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide">사용 방법</h3>
            <div className="space-y-3">
              {STEPS.map(({ step, title, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    {step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 등급 기준 */}
          <section>
            <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide">등급 기준</h3>
            <div className="space-y-2">
              {GRADES.map(({ grade, color, score, desc }) => (
                <div key={grade} className="flex items-start gap-3">
                  <span className={`flex-shrink-0 text-sm font-black px-2.5 py-0.5 rounded-lg ${color}`}>
                    {grade}
                  </span>
                  <div>
                    <span className="text-xs font-semibold text-gray-700">{score}</span>
                    <span className="text-xs text-gray-500 ml-2">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 평가 지표 */}
          <section>
            <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide">평가 지표</h3>
            <div className="space-y-2.5">
              {METRICS.map(({ icon, label, desc }) => (
                <div key={label} className="flex gap-2.5">
                  <span className="flex-shrink-0 text-base w-6 text-center">{icon}</span>
                  <div>
                    <span className="text-xs font-semibold text-gray-800">{label}</span>
                    <span className="text-xs text-gray-500 ml-2">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3 bg-blue-50 rounded-lg px-3 py-2">
              포즈·패션은 <strong className="text-blue-600">전신 사진 전용</strong> 지표입니다.
              클로즈업 사진은 기본 5개 지표 평균으로만 채점됩니다.
            </p>
          </section>

          {/* 자주 묻는 질문 */}
          <section>
            <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide">자주 묻는 질문</h3>
            <div className="space-y-3">
              {[
                {
                  q: '분석 결과에 사진이 너무 적게 나와요.',
                  a: '1차 필터는 심각한 흔들림·노출 불량·인물 없는 사진을 제거합니다. 전체 업로드 사진의 약 30%가 통과되며, 이 중 중복 제거 후 그룹 대표 사진만 최종 표시됩니다.',
                },
                {
                  q: '전신 사진인데 클로즈업으로 표시돼요.',
                  a: '얼굴 높이가 이미지 높이의 18% 이상이면 클로즈업으로 판정됩니다. 카메라를 더 멀리 두거나 줌을 줄여 전신이 모두 담기도록 촬영하면 포즈·패션 지표도 평가됩니다.',
                },
                {
                  q: '좋아 보이는 사진이 낮은 등급을 받았어요.',
                  a: '현재 알고리즘은 픽셀 분석 기반으로, 분위기·감성 등 주관적 요소는 반영하지 못합니다. 사진을 클릭하면 항목별 상세 점수와 개선 팁을 확인할 수 있습니다.',
                },
              ].map(({ q, a }) => (
                <div key={q} className="border border-gray-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-800">Q. {q}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">A. {a}</p>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-gray-100 flex-shrink-0 text-center">
          <p className="text-xs text-gray-400">PhotoPick AI v1.0.0 — 패션 인물 사진 자동 선별 도구</p>
        </div>

      </div>
    </div>
  );
}
