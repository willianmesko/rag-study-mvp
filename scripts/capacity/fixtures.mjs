import { createHash } from "node:crypto";
import { capacityProfile, chunkIdentityNumber } from "./profiles.mjs";

export const dimensions = 1024;
export const actorsPerWorkspace = 20;
export const workspaceCounts = capacityProfile("pilot").counts;
export const statement = "Records are kept for five days.";
export const fixtureModel = "capacity-fixture-v1";
export const uuid = (kind, value) => {
  if (!Number.isInteger(kind) || kind < 1 || kind > 9 || !Number.isInteger(value) || value < 0 || value > 999999999999)
    throw new Error("Invalid synthetic identity.");
  return `${kind}0000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};
export const key = (ordinal) => {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 99999) throw new Error("Invalid fixture key.");
  return `K${String(ordinal).padStart(5, "0")}`;
};
export const tokenFor = (actor) => `capacity-fixture_${actor}`;
export function actorFromToken(value) {
  const match = /^Bearer capacity-fixture_([1-9]0000000-0000-4000-8000-\d{12})$/.exec(value ?? "");
  return match?.[1] ?? null;
}
export function vectorFor(text) {
  const ordinal = Number(/K(\d{5})/.exec(text)?.[1] ?? 0);
  let state = ordinal + 1;
  const values = Array.from({ length: dimensions }, () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296 - 0.5;
  });
  const length = Math.hypot(...values);
  return values.map((value) => value / length);
}
export function samples(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Invalid measurement.");
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] * 1000) / 1000;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
}
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function seedCorpus(pool, counts = workspaceCounts, signal = new AbortController().signal) {
  const documents = new Map(), chunks = new Map(), workspaces = [];
  for (const [workspace, count] of counts.entries()) {
    signal.throwIfAborted();
    const tenantId = uuid(2, workspace + 1), documentId = uuid(3, workspace + 1);
    const actors = Array.from({ length: actorsPerWorkspace }, (_, index) => uuid(1, workspace * actorsPerWorkspace + index + 1));
    workspaces.push({ tenantId, documentId, actors, count, language: workspace % 2 === 1 ? "pt" : "en" });
    documents.set(documentId, tenantId);
    await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [tenantId, `capacity-${workspace}`, `Synthetic workspace ${workspace}`]);
    for (const [index, actor] of actors.entries()) await pool.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [tenantId, actor, index === 0 ? "owner" : "viewer"]);
    await pool.query("INSERT INTO documents(id,tenant_id,source,title,metadata) VALUES($1,$2,$3,$4,$5)",
      [documentId, tenantId, `capacity/${workspace}/handbook.md`, "Synthetic handbook", { format: "markdown", language: workspace % 2 === 1 ? "pt" : "en" }]);
    for (let offset = 0; offset < count; offset += 50) {
      signal.throwIfAborted();
      const rows = Array.from({ length: Math.min(50, count - offset) }, (_, index) => {
        const ordinal = offset + index;
        return { id: uuid(4, chunkIdentityNumber(workspace, ordinal)), ordinal,
          content: `${key(ordinal)}. ${statement} Synthetic ${workspace % 2 === 1 ? "procedimento de retenção" : "retention procedure"}.`,
          embedding: `[${vectorFor(key(ordinal)).join(",")}]`,
          metadata: { security: { promptInjectionRisk: "low", signals: [] } } };
      });
      for (const row of rows) chunks.set(row.id, { tenantId, documentId });
      await pool.query(`INSERT INTO chunks(id,document_id,ordinal,content,embedding,metadata)
        SELECT x.id,$1,x.ordinal,x.content,x.embedding::vector,x.metadata
        FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,ordinal integer,content text,embedding text,metadata jsonb)`,
      [documentId, JSON.stringify(rows)]);
    }
  }
  await pool.query("ANALYZE chunks"); await pool.query("ANALYZE documents");
  const tenantIds = new Set(workspaces.map(({ tenantId }) => tenantId));
  let ownershipLookups = 0;
  return { workspaces, documents, chunks, get ownershipLookups() { return ownershipLookups; },
    async hydrateSourceOwners(tenantId, sources) {
      if (!tenantIds.has(tenantId) || sources.length > 20) throw new Error("Invalid fixture ownership lookup.");
      const result = await pool.query(`SELECT c.id AS chunk_id,d.id AS document_id FROM chunks c
        JOIN documents d ON d.id=c.document_id WHERE d.tenant_id=$1 AND c.id=ANY($2::uuid[])`,
      [tenantId, [...new Set(sources.map(({ chunkId }) => chunkId))]]);
      ownershipLookups++;
      for (const row of result.rows) {
        documents.set(row.document_id, tenantId);
        chunks.set(row.chunk_id, { tenantId, documentId: row.document_id });
      }
    }
  };
}
