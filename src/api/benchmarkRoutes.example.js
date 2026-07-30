export function registerBenchmarkRoutes(router, {
  requireAdmin,
  benchmarkDatasetService,
  datasetRepository
}) {
  router.post("/api/admin/benchmark/datasets/generate", requireAdmin,
    async (req, res) => {
      const { documentId, positiveCount = 50, negativeCount = 50 } = req.body ?? {};
      if (!documentId) {
        return res.status(400).json({ error: "DOCUMENT_ID_REQUIRED" });
      }

      const dataset = await benchmarkDatasetService.generate({
        documentId,
        positiveCount,
        negativeCount
      });

      return res.status(201).json(dataset);
    });

  router.get("/api/admin/benchmark/datasets", requireAdmin,
    async (_req, res) => {
      return res.json({ datasets: await datasetRepository.list() });
    });

  router.get("/api/admin/benchmark/datasets/:datasetId", requireAdmin,
    async (req, res) => {
      return res.json(await datasetRepository.get(req.params.datasetId));
    });
}
