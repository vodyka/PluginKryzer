const EXPORTS_URL = "https://api.canva.com/rest/v1/exports";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 30;

// Exports every page of a design as PNG and returns the download URLs in
// page order (Canva guarantees "the list is sorted by page order"). URLs
// are only valid for 24h — the caller must consume them promptly.
export async function exportDesignPagesAsPng(
  accessToken: string,
  designId: string,
  pageCount: number,
): Promise<string[]> {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  const startRes = await fetch(EXPORTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      design_id: designId,
      format: { type: "png", export_quality: "regular", pages },
    }),
  });

  const startJson = await startRes.json();
  if (!startRes.ok) {
    throw new Error(`Falha ao iniciar export do design ${designId}: ${JSON.stringify(startJson)}`);
  }

  const jobId = startJson.job.id;
  const jobUrl = `${EXPORTS_URL}/${jobId}`;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const res = await fetch(jobUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Erro ao consultar export job ${jobId}: ${JSON.stringify(json)}`);
    }
    if (json.job.status === "success") return json.job.urls;
    if (json.job.status === "failed") {
      throw new Error(`Export falhou para ${designId}: ${JSON.stringify(json.job.error)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Timeout esperando o export do design ${designId}.`);
}
