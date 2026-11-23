import { expect, test } from "bun:test";

import { ConversionQueue } from "../../src/helpers/conversionQueue";

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

test("shares slots across jobs, rotates between jobs, and rejects full batches atomically", async () => {
  const queue = new ConversionQueue(2, 3);
  const starts: string[] = [];
  const gates = Array.from({ length: 5 }, deferred);
  const task = (index: number, name: string) => async () => {
    starts.push(name);
    await gates[index]!.promise;
  };
  const a = queue.trySubmitBatch("a", [task(0, "a1"), task(1, "a2"), task(2, "a3")]);
  const b = queue.trySubmitBatch("b", [task(3, "b1"), task(4, "b2")]);
  if (!a.accepted || !b.accepted) throw new Error("expected both submissions");
  expect(queue.getJobQueueState("a")).toEqual({ running: 2, queued: 1 });
  expect(queue.getJobQueueState("b")).toEqual({ running: 0, queued: 2 });
  expect(queue.trySubmitBatch("a", [task(0, "duplicate")])).toEqual({
    accepted: false,
    reason: "duplicate",
  });
  expect(
    queue.trySubmitBatch("c", [task(0, "excess")], 1, () => {
      throw new Error("must not admit");
    }),
  ).toEqual({ accepted: false, reason: "capacity" });
  await Promise.resolve();
  expect(starts).toEqual(["a1", "a2"]);
  try {
    gates[0]!.finish();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    gates[1]!.finish();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // After a dispatch to each waiting job, the second slot goes to the other job.
    expect(starts.slice(2)).toEqual(["a3", "b1"]);
  } finally {
    gates.forEach(({ finish }) => finish());
    await Promise.all([a.done, b.done]);
  }
  expect(starts).toHaveLength(5);
  expect(queue.getJobQueueState("a")).toBeNull();
  expect(queue.getJobQueueState("b")).toBeNull();
});

test("counts waiting files even when a per-job limit leaves a global slot idle", async () => {
  const queue = new ConversionQueue(2, 1);
  const gate = deferred();
  const task = () => gate.promise;
  expect(queue.trySubmitBatch("too-many", [task, task, task], 1)).toEqual({
    accepted: false,
    reason: "capacity",
  });
  const a = queue.trySubmitBatch("a", [task, task], 1);
  const b = queue.trySubmitBatch("b", [task]);
  expect(queue.getJobQueueState("a")).toEqual({ running: 1, queued: 1 });
  expect(queue.getJobQueueState("b")).toEqual({ running: 1, queued: 0 });
  expect(queue.trySubmitBatch("overflow", [task])).toEqual({ accepted: false, reason: "capacity" });
  gate.finish();
  if (a.accepted) await a.done;
  if (b.accepted) await b.done;
});

test("continues after a rejected file and releases the job when all files settle", async () => {
  const queue = new ConversionQueue(1, 2);
  const ran: string[] = [];
  const batch = queue.trySubmitBatch("a", [
    async () => {
      throw new Error("broken");
    },
    async () => {
      ran.push("second");
    },
  ]);
  if (!batch.accepted) throw new Error("expected admission");
  await expect(batch.done).rejects.toThrow("broken");
  expect(ran).toEqual(["second"]);
  expect(queue.getJobQueueState("a")).toBeNull();
});

test("does not launch files when the synchronous database claim throws", () => {
  const queue = new ConversionQueue(1, 1);
  let ran = false;
  expect(() =>
    queue.trySubmitBatch(
      "a",
      [
        async () => {
          ran = true;
        },
      ],
      1,
      () => {
        throw new Error("database busy");
      },
    ),
  ).toThrow("database busy");
  expect(queue.getJobQueueState("a")).toBeNull();
  expect(ran).toBe(false);
});
