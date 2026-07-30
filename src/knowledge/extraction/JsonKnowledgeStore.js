import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const empty = () => ({ version: 1, entities: [], facts: [], relations: [], processedChunks: [], updatedAt: null });
const norm = s => String(s ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const id = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 18)}`;

export class JsonKnowledgeStore {
  constructor({ file }) { this.file = file; }
  async load() { try { return { ...empty(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; } catch (e) { if (e.code === 'ENOENT') return empty(); throw e; } }
  async save(data) { await fs.mkdir(path.dirname(this.file), { recursive: true }); const tmp=`${this.file}.tmp`; data.updatedAt=new Date().toISOString(); await fs.writeFile(tmp,JSON.stringify(data,null,2),'utf8'); await fs.rename(tmp,this.file); }
  async mergeExtraction({ documentId, chunk, extraction }) {
    const data = await this.load();
    const entityMap = new Map(data.entities.map(x => [`${x.type}:${norm(x.canonicalName)}`, x]));
    const localIds = new Map();
    for (const raw of extraction.entities ?? []) {
      const type = String(raw.type ?? 'concept').toLowerCase();
      const canonicalName = String(raw.canonicalName ?? raw.name ?? '').trim();
      if (!canonicalName) continue;
      const key = `${type}:${norm(canonicalName)}`;
      let entity = entityMap.get(key);
      if (!entity) {
        entity = { id: id('ent', key), type, canonicalName, aliases: [], descriptions: [], createdAt: new Date().toISOString() };
        data.entities.push(entity); entityMap.set(key, entity);
      }
      entity.aliases = [...new Set([...(entity.aliases ?? []), ...(raw.aliases ?? []).map(String).filter(Boolean)])];
      if (raw.description) entity.descriptions = [...new Set([...(entity.descriptions ?? []), String(raw.description)])].slice(-20);
      localIds.set(String(raw.localId ?? raw.name ?? canonicalName), entity.id);
      localIds.set(canonicalName, entity.id);
    }
    for (const raw of extraction.facts ?? []) {
      const subjectEntityId = localIds.get(String(raw.subjectRef ?? raw.subject ?? '')) ?? null;
      const objectEntityId = localIds.get(String(raw.objectRef ?? raw.object ?? '')) ?? null;
      const predicate = String(raw.predicate ?? 'related_to').trim().toLowerCase();
      const value = raw.value == null ? null : String(raw.value).trim();
      if (!subjectEntityId || (!objectEntityId && !value)) continue;
      const sourceText = String(raw.sourceText ?? '').trim().slice(0, 800);
      const factKey = `${subjectEntityId}|${predicate}|${objectEntityId ?? value}|${chunk.id}`;
      if (data.facts.some(x => x.key === factKey)) continue;
      data.facts.push({ id:id('fact',factKey), key:factKey, subjectEntityId, predicate, objectEntityId, value, documentId, chunkId:chunk.id, sourceText, confidence:Number(raw.confidence ?? .75), status:'extracted', createdAt:new Date().toISOString() });
    }
    if (!data.processedChunks.includes(chunk.id)) data.processedChunks.push(chunk.id);
    await this.save(data);
    return { entities: data.entities.filter(x => data.facts.some(f => f.documentId===documentId && (f.subjectEntityId===x.id || f.objectEntityId===x.id))).length, facts: data.facts.filter(x=>x.documentId===documentId).length };
  }
  async removeDocument(documentId) { const d=await this.load(); d.facts=d.facts.filter(x=>x.documentId!==documentId); d.processedChunks=d.processedChunks.filter(x=>!x.startsWith(`${documentId}:`)); const used=new Set(d.facts.flatMap(x=>[x.subjectEntityId,x.objectEntityId]).filter(Boolean)); d.entities=d.entities.filter(x=>used.has(x.id)); await this.save(d); }
  async stats(documentId) { const d=await this.load(); const facts=documentId?d.facts.filter(x=>x.documentId===documentId):d.facts; const ids=new Set(facts.flatMap(x=>[x.subjectEntityId,x.objectEntityId]).filter(Boolean)); return { entities:ids.size, facts:facts.length, relations:facts.filter(x=>x.objectEntityId).length, processedChunks:documentId?d.processedChunks.filter(x=>x.startsWith(`${documentId}:`)).length:d.processedChunks.length, updatedAt:d.updatedAt }; }
}
