/** One rAF for everything. No loop while idle. */
type Job = (now: number) => void;

const jobs = new Set<Job>();
let raf = 0;

export function requestFrame(job: Job) {
  jobs.add(job);
  if (!raf) raf = requestAnimationFrame(run);
}

function run(now: number) {
  raf = 0;
  const list = [...jobs];
  jobs.clear();
  for (const job of list) job(now);
}
