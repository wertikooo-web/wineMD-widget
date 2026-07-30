import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatasetValidator} from '../src/benchmark/DatasetValidator.js';
import {BenchmarkDatasetService} from '../src/benchmark/BenchmarkDatasetService.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const benchmarkDir=path.resolve(here,'../src/benchmark');

test('benchmark source contains no case-insensitive duplicate filenames',async()=>{
  const names=(await fs.readdir(benchmarkDir)).filter(name=>name.endsWith('.js'));
  const seen=new Map();
  for(const name of names){
    const key=name.toLowerCase();
    assert.equal(seen.has(key),false,`Case-insensitive duplicate: ${seen.get(key)} and ${name}`);
    seen.set(key,name);
  }
});

test('DatasetValidator exposes the contract used by BenchmarkDatasetService',()=>{
  const validator=new DatasetValidator();
  assert.equal(typeof validator.validate,'function');
  assert.equal(typeof validator.validateDataset,'undefined');
});

test('BenchmarkDatasetService fails fast for an incompatible validator',()=>{
  assert.throws(()=>new BenchmarkDatasetService({
    repository:{},registry:{},chunksFile:'x',generator:{},validator:{validateDataset(){}}
  }),/validator\.validate/);
});
