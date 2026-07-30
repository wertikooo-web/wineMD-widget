import fs from 'node:fs/promises';
import path from 'node:path';

function safeId(value) {
  const id = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id)) throw Object.assign(new Error('Invalid dataset id'), { code: 'INVALID_DATASET_ID' });
  return id;
}

export class BenchmarkDatasetRepository {
  constructor({ directory }) { this.directory = directory; }
  async ensure() { await fs.mkdir(this.directory, { recursive: true }); }
  file(datasetId) { return path.join(this.directory, `${safeId(datasetId)}.json`); }
  async save(dataset) {
    await this.ensure();
    const tmp = `${this.file(dataset.datasetId)}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(dataset, null, 2), 'utf8');
    await fs.rename(tmp, this.file(dataset.datasetId));
    return dataset;
  }
  async get(datasetId) { return JSON.parse(await fs.readFile(this.file(datasetId), 'utf8')); }
  async list() {
    await this.ensure();
    const names = (await fs.readdir(this.directory)).filter(x => x.endsWith('.json'));
    const items=[];
    for (const name of names) {
      try { const d=JSON.parse(await fs.readFile(path.join(this.directory,name),'utf8')); items.push({datasetId:d.datasetId,title:d.title,documentId:d.documentId,createdAt:d.createdAt,updatedAt:d.updatedAt,stats:d.stats}); } catch {}
    }
    return items.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  }
  async remove(datasetId) { await fs.unlink(this.file(datasetId)); }
}
