import type { Database } from "bun:sqlite";

/** The in-memory scheduler is intentionally single-process; pending work cannot survive a restart. */
export function recoverInterruptedJobs(database: Database) {
  const jobs = database.query("SELECT id, num_files FROM jobs WHERE status = 'pending'").all() as { id: number; num_files: number }[];
  const recover = database.transaction(() => {
    const recorded = database.query("SELECT DISTINCT file_name FROM file_names WHERE job_id = ?");
    const insert = database.query("INSERT INTO file_names (job_id, file_name, output_file_name, status) VALUES (?, ?, ?, 'Failed, check logs')");
    const finish = database.query("UPDATE jobs SET status = 'completed' WHERE id = ? AND status = 'pending'");
    try {
      for (const job of jobs) {
        const existing = new Set((recorded.all(job.id) as { file_name: string }[]).map((row) => row.file_name));
        const missing = Math.max(0, job.num_files - existing.size);
        let sequence = 0;
        for (let index = 0; index < missing; index++) {
          let label: string;
          do { label = `中断的文件 ${++sequence}（请重新上传）`; } while (existing.has(label));
          existing.add(label);
          insert.run(job.id, label, label);
        }
        finish.run(job.id);
      }
    } finally { recorded.finalize(); insert.finalize(); finish.finalize(); }
  });
  if (jobs.length) recover();
  return jobs.length;
}
