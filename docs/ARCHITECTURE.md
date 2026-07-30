# Architecture

Browser
  -> MediaRecorder
  -> /api/transcribe
  -> /api/answer
        -> KnowledgeService
             -> LocalKnowledgeProvider
             -> DocumentKnowledgeProvider
             -> Embeddings
        -> CatalogService
             -> LocalCatalogProvider
             -> WineMdCatalogProvider
        -> LLM
  -> UI

Admin
  -> /admin
  -> Login
  -> Upload documents
