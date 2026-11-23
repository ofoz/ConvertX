import { resourceLimits } from "./resourceLimits";

type Work = () => Promise<unknown>;
type Batch = {
  tasks: readonly Work[];
  next: number;
  running: number;
  finished: number;
  limit: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  failure?: { error: unknown };
};
export type Submission =
  { accepted: true; done: Promise<void> } | { accepted: false; reason: "duplicate" | "capacity" };

/** One bounded queue shared by every conversion request in this process. */
export class ConversionQueue {
  private batches = new Map<string, Batch>();
  private order: string[] = [];
  private running = 0;
  private queued = 0;

  constructor(
    private concurrency = resourceLimits.conversionConcurrency,
    private maxQueued = resourceLimits.maxQueuedFiles,
  ) {}

  getJobQueueState(jobId: string) {
    const batch = this.batches.get(jobId);
    return batch ? { queued: batch.tasks.length - batch.next, running: batch.running } : null;
  }

  trySubmitBatch(
    jobId: string,
    tasks: readonly Work[],
    perJobLimit = this.concurrency,
    onAccepted?: () => void,
  ): Submission {
    if (this.batches.has(jobId)) return { accepted: false, reason: "duplicate" };
    const limit = Math.max(1, Math.min(this.concurrency, perJobLimit));
    const immediatelyRunnable = Math.min(limit, this.concurrency - this.running, tasks.length);
    if (this.queued + tasks.length - immediatelyRunnable > this.maxQueued) {
      return { accepted: false, reason: "capacity" };
    }
    onAccepted?.();
    if (!tasks.length) return { accepted: true, done: Promise.resolve() };
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.batches.set(jobId, {
      tasks: [...tasks],
      next: 0,
      running: 0,
      finished: 0,
      limit,
      resolve,
      reject,
    });
    this.order.push(jobId);
    this.queued += tasks.length;
    this.pump();
    return { accepted: true, done };
  }

  private pump() {
    while (this.running < this.concurrency) {
      const index = this.order.findIndex((id) => {
        const batch = this.batches.get(id)!;
        return batch.next < batch.tasks.length && batch.running < batch.limit;
      });
      if (index === -1) return;
      const id = this.order.splice(index, 1)[0]!;
      const batch = this.batches.get(id)!;
      this.order.push(id); // Round robin between jobs; FIFO within each job.
      const task = batch.tasks[batch.next++]!;
      this.queued--;
      this.running++;
      batch.running++;
      void Promise.resolve()
        .then(task)
        .catch((error) => {
          batch.failure ??= { error };
        })
        .finally(() => {
          this.running--;
          batch.running--;
          batch.finished++;
          if (batch.finished === batch.tasks.length) {
            this.batches.delete(id);
            this.order = this.order.filter((key) => key !== id);
            if (batch.failure) batch.reject(batch.failure.error);
            else batch.resolve();
          }
          this.pump();
        });
    }
  }
}

export const conversionQueue = new ConversionQueue();
export const getJobQueueState = (jobId: string) => conversionQueue.getJobQueueState(jobId);
