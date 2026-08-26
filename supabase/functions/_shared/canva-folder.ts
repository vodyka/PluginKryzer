const FOLDERS_URL = "https://api.canva.com/rest/v1/folders";
const FOLDERS_MOVE_URL = "https://api.canva.com/rest/v1/folders/move";

// deno-lint-ignore no-explicit-any
export async function getOrCreateClientFolder(
  supabase: any,
  accessToken: string,
  cliente: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("canva_client_folders")
    .select("folder_id")
    .eq("cliente", cliente)
    .maybeSingle();

  if (existing) return existing.folder_id;

  const res = await fetch(FOLDERS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: `Agencia - ${cliente}`, parent_folder_id: "root" }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Falha ao criar pasta do cliente "${cliente}": ${JSON.stringify(json)}`);
  }

  const folderId = json.folder.id;

  // Best-effort save — if two requests race to create the same client's
  // folder for the first time, whichever insert loses just keeps using its
  // own (now orphaned) folder id for this one call; vanishingly rare given
  // the Tampermonkey agent syncs one product at a time.
  await supabase
    .from("canva_client_folders")
    .upsert({ cliente, folder_id: folderId }, { onConflict: "cliente" });

  return folderId;
}

export async function moveDesignToFolder(
  accessToken: string,
  designId: string,
  folderId: string,
): Promise<void> {
  const res = await fetch(FOLDERS_MOVE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to_folder_id: folderId, item_id: designId }),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Falha ao mover design ${designId} para pasta ${folderId}: HTTP ${res.status} ${text}`);
  }
}
