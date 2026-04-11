// src/workers/WorkerPool.ts
// 범용 Web Worker 풀 — CPU 코어 수만큼 Worker를 미리 생성해 병렬 처리 성능을 극대화합니다
// 사용 예: 1000장 사진을 8개 Worker가 나눠 동시에 분석

/** 대기 중인 단일 작업 구조체 */
interface Task<TInput, TOutput> {
  data: TInput;
  resolve: (result: TOutput) => void;  // 작업 성공 시 호출
  reject: (error: Error) => void;      // 작업 실패 시 호출
}

export class WorkerPool<TInput, TOutput> {
  private workers: Worker[] = [];       // 생성된 전체 Worker 목록
  private idle: Worker[] = [];          // 현재 작업 없이 대기 중인 Worker 목록
  private queue: Task<TInput, TOutput>[] = [];  // 처리 대기 중인 작업 큐

  private createWorker: () => Worker;   // Worker 생성 팩토리 함수
  private poolSize: number;             // 풀 크기 (CPU 코어 수, 최대 8개)

  /**
   * @param createWorker Worker 생성 팩토리 (예: () => new Worker(...))
   * @param poolSize     Worker 수 — 기본값: CPU 코어 수 (최대 8개)
   */
  constructor(
    createWorker: () => Worker,
    poolSize: number = Math.min(navigator.hardwareConcurrency ?? 4, 8)
  ) {
    this.createWorker = createWorker;
    this.poolSize = poolSize;

    // 풀 크기만큼 Worker를 미리 생성해 idle 목록에 등록
    for (let i = 0; i < this.poolSize; i++) {
      const w = this.createWorker();
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** 단일 작업 실행 — Promise로 결과 반환
   *  idle Worker 가 없으면 큐에 쌓였다가 빈 자리가 생기면 자동 실행됨 */
  exec(data: TInput): Promise<TOutput> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.dispatch(); // 즉시 처리 가능한지 시도
    });
  }

  /** 여러 작업을 한꺼번에 실행하고 진행률 콜백으로 완료 개수를 알려줌
   *  모든 작업이 완료되면 결과 배열(입력 순서 보장)을 반환 */
  async execBatch(
    items: TInput[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TOutput[]> {
    let completed = 0;
    return Promise.all(
      items.map((item) =>
        this.exec(item).then((result) => {
          completed++;
          onProgress?.(completed, items.length); // 진행률 업데이트
          return result;
        })
      )
    );
  }

  /** 대기 큐에서 작업을 꺼내 idle Worker 에 배정하는 내부 스케줄러
   *  idle Worker 가 없거나 큐가 비면 아무것도 하지 않음 */
  private dispatch() {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const task = this.queue.shift()!;  // 가장 오래된 작업 꺼냄 (FIFO)
      const worker = this.idle.pop()!;   // 사용 가능한 Worker 하나 배정

      // Worker 응답 수신 → 결과 반환 + Worker 반납 + 다음 작업 시도
      worker.onmessage = (e: MessageEvent<TOutput>) => {
        this.idle.push(worker);      // Worker 반납
        task.resolve(e.data);        // 결과 전달
        this.dispatch();             // 다음 대기 작업 처리
      };

      // Worker 오류 발생 → 에러 전파 + Worker 반납
      worker.onerror = (e) => {
        this.idle.push(worker);
        task.reject(new Error(e.message));
        this.dispatch();
      };

      // ArrayBuffer는 Transferable로 보내 복사 없이 소유권 이전 (메모리 절약)
      const transferables: Transferable[] = [];
      if (
        task.data &&
        typeof task.data === 'object' &&
        'fileBuffer' in task.data &&
        (task.data as any).fileBuffer instanceof ArrayBuffer
      ) {
        transferables.push((task.data as any).fileBuffer);
      }
      worker.postMessage(task.data, transferables);
    }
  }

  /** 모든 Worker 강제 종료 — 파이프라인 완료 후 반드시 호출해 메모리 해제 */
  terminate() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.idle = [];
  }
}
