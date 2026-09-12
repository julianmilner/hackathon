// Run async jobs with a fixed concurrency, in order. Rejections are collected and
// re-thrown together once the pool drains so one bad tile does not stop the rest.
export async function runPool(jobs: Array<() => Promise<void>>, concurrency: number) {
  let next = 0
  const errors: unknown[] = []
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try {
        await job()
      } catch (err) {
        errors.push(err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
  if (errors.length) {
    console.warn(`${errors.length} tile job(s) failed`, errors[0])
  }
}
