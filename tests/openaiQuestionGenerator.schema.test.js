import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIQuestionGenerator } from "../src/benchmark/OpenAIQuestionGenerator.js";

test("strict response schema requires every evidence property", async () => {
  let body;
  const generator = new OpenAIQuestionGenerator({
    apiKey: "sk-test-abcdefghijklmnopqrstuvwxyz",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ items: [] }) }) };
    }
  });

  await generator.generateBatch({
    document: { id: "doc" },
    chunks: [],
    count: 1,
    polarity: "positive",
    language: "ru"
  });

  const evidence = body.text.format.schema.properties.items.items.properties.evidence;
  assert.deepEqual(evidence.required, ["chunkId", "page", "quote"]);
  assert.deepEqual(Object.keys(evidence.properties), ["chunkId", "page", "quote"]);
});
