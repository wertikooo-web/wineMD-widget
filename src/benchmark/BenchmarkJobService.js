import crypto from 'node:crypto';

export class BenchmarkJobService {
  constructor({ datasetService }) {
    this.datasetService = datasetService;
    this.jobs = new Map();
  }

  create(input) {
    const jobId = `job-${crypto.randomUUID()}`;
    const job = { jobId, status: 'queued', phase: 'queued', message: 'Задание поставлено в очередь', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: { approved: 0, rejected: 0, generated: 0 } };
    this.jobs.set(jobId, job);
    queueMicrotask(async () => {
      this.update(jobId, { status: 'running', phase: 'starting', message: 'Подготовка документа' });
      try {
        const dataset = await this.datasetService.generate({ ...input, onProgress: progress => this.update(jobId, { phase: progress.phase, message: progress.message, progress }) });
        this.update(jobId, { status: 'completed', phase: 'complete', message: dataset.status === 'complete' ? 'Набор готов' : 'Набор готов частично', datasetId: dataset.datasetId, stats: dataset.stats });
      } catch (error) {
        this.update(jobId, { status: 'failed', phase: 'failed', message: error.message, error: error.code ?? 'BENCHMARK_GENERATION_FAILED' });
      }
    });
    return job;
  }

  update(jobId, patch) {
    const current = this.jobs.get(jobId);
    if (!current) return;
    this.jobs.set(jobId, { ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  get(jobId) { return this.jobs.get(jobId) ?? null; }
}
