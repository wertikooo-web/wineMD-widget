# Knowledge and retrieval

The approved document corpus is the factual boundary for closed-RAG answers.

## Design rules

- Preserve source identity from upload through parsing, chunking, indexing, retrieval, and answer evidence.
- An empty corpus, a document awaiting indexing, and an indexing failure are distinct states.
- Retrieval errors must not be converted into confident answers from model memory.
- Chunking and embedding changes require comparison on representative queries; do not treat a successful script exit as proof of retrieval quality.
- Uploaded files are untrusted input. Validate type, size, parser behavior, and stored metadata.
- Reindexing must avoid silent duplication and must expose partial failures.

## References

Inspect ingestion scripts, parsers, chunk records, embedding repositories, search functions, answer prompts, tests, and actual serialized data. Prefer evidence-bearing retrieval results over prose descriptions of the pipeline.

## Verification focus

Check one empty-corpus query, one answerable query with source evidence, and one unanswerable query. Confirm that failed parsing or embedding leaves inspectable state and does not publish incomplete content as ready.