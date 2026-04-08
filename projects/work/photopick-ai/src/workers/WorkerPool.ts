// src/workers/WorkerPool.ts
// 코어 수 기반 범용 Worker 풀 매니저

interface Task<TInput, TOutput> {
  data: TInput;
  resolve: (result: TOutput) => void;
  reject: (error: Error) => void;
}

export class WorkerPool<TInput, TOutput> {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Task<TInput, TOutput>[] = [];

  private createWorker: () => Worker;
  private poolSize: number;

  constructor(
    createWorker: () => Worker,
    poolSize: number = Math.min(navigator.hardwareConcurrency ?? 4, 8)
  ) {
    this.createWorker = createWorker;
    this.poolSize = poolSize;
    for (let i = 0; i < this.poolSize; i++) {
      const w = this.createWorker();
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** 단일 작업 실행 */
  exec(data: TInput): Promise<TOutput> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.dispatch();
    });
  }

  /** 배치 실행 + 진행률 콜백 */
  async execBatch(
    items: TInput[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TOutput[]> {
    let completed = 0;
    return Promise.all(
      items.map((item) =>
        this.exec(item).then((result) => {
          completed++;
          onProgress?.(completed, items.length);
          return result;
        })
      )
    );
  }

  private dispatch() {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const task = this.queue.shift()!;
      const worker = this.idle.pop()!;

      worker.onmessage = (e: MessageEvent<TOutput>) => {
        this.idle.push(worker);
        task.resolve(e.data);
        this.dispatch();
      };

      worker.onerror = (e) => {
        this.idle.push(worker);
        task.reject(new Error(e.message));
        this.dispatch();
      };

      // Transferable로 ArrayBuffer 전송 (복사 없이 이동 — 메모리 효율)
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

  terminate() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.idle = [];
  }
}
