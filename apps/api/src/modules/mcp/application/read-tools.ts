import {observeOperation} from "../../../platform/observability/observer.js";
import { isIP } from "node:net";
import { mcpReadToolInputSchemas, type McpReadToolName } from "@rag-study/contracts";
import { z } from "zod";
import type { RetrievedChunk } from "../../knowledge/index.js";
import { redactPii } from "../../../platform/security/pii-redaction.js";
import { assessPromptInjection } from "../../../platform/security/prompt-injection.js";
import type { EvaluationRun } from "../../evaluations/index.js";
import type { IngestionJob } from "../../ingestion/index.js";
import type { TenantRole } from "../../workspaces/index.js";
import type { McpSearch } from "./hybrid-search.js";

export type McpSourceRecord = {
  id: string;
  source: string;
  title: string | null;
  format: string | null;
  language: string | null;
  chunkCount: number;
  updatedAt: Date;
};
export type McpPassageRecord = Pick<RetrievedChunk, "chunkId" | "ordinal" | "content" | "security">;
export type McpSearchRecord = McpPassageRecord & Pick<RetrievedChunk, "documentId" | "source" | "title" | "score">;
export type McpIngestionRecord = Pick<IngestionJob, "id" | "documentId" | "status" | "progress" | "chunkCount" | "updatedAt">;
export type McpEvaluationRecord = Pick<EvaluationRun, "id" | "datasetName" | "datasetVersion" | "totalCases" | "hitRate"
  | "meanReciprocalRank" | "faithfulness" | "contextPrecision" | "injectionPassRate" | "passed" | "createdAt">;

export interface McpReadRepository {
  listSources(tenantId: string, limit: number, signal: AbortSignal): Promise<McpSourceRecord[]>;
  getIngestionStatus(tenantId: string, jobId: string, signal: AbortSignal): Promise<McpIngestionRecord | null>;
  getQualityReport(tenantId: string, limit: number, signal: AbortSignal): Promise<McpEvaluationRecord[]>;
  getDocument(tenantId: string, documentId: string, limit: number, signal: AbortSignal):
    Promise<{ document: McpSourceRecord; passages: McpPassageRecord[] } | null>;
  search(tenantId: string, lexicalQuery: string, limit: number, signal: AbortSignal): Promise<McpSearchRecord[]>;
}

const formats = z.enum(["pdf", "docx", "html", "markdown", "text"]);
const languages = z.enum(["pt", "en", "mixed", "und"]);
const roles = z.enum(["owner", "editor", "viewer"]);
const tenantIdSchema = z.uuid();
const maxMetadataChars = 1_000;
export const maxMcpPassageChars = 12_000;

export class McpReadToolForbiddenError extends Error {
  constructor() {
    super("Workspace owner access is required for the quality report.");
    this.name='McpReadToolForbiddenError';
  }
}

export class McpReadTools {
  constructor(private readonly reads: McpReadRepository, private readonly search: McpSearch) {}

  execute(input:Parameters<McpReadTools['run']>[0]):Promise<Record<string,unknown>>{return observeOperation({kind:'tool.call',name:input.tool},()=>this.run(input));}
  private async run({ tool, tenantId, userId, role, arguments: args, signal }: {
    tool: McpReadToolName;
    tenantId: string;
    userId: string;
    role: TenantRole;
    arguments: unknown;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    tenantIdSchema.parse(tenantId);
    tenantIdSchema.parse(userId);
    roles.parse(role);

    switch (tool) {
      case "list_sources": {
        const { limit = 10 } = mcpReadToolInputSchemas.list_sources.parse(args);
        const rows = await this.reads.listSources(tenantId, limit, signal);
        return { sources: rows.map(sourceView) };
      }
      case "get_ingestion_status": {
        const { jobId } = mcpReadToolInputSchemas.get_ingestion_status.parse(args);
        const job = await this.reads.getIngestionStatus(tenantId, jobId, signal);
        return { job: job ? {
          id: job.id, documentId: job.documentId, status: job.status, progress: job.progress,
          chunkCount: job.chunkCount, updatedAt: job.updatedAt.toISOString()
        } : null };
      }
      case "get_quality_report": {
        if (role !== "owner") throw new McpReadToolForbiddenError();
        const { limit = 5 } = mcpReadToolInputSchemas.get_quality_report.parse(args);
        const runs = await this.reads.getQualityReport(tenantId, limit, signal);
        return { runs: runs.map((run) => ({
          id: run.id, datasetName: safeLabel(run.datasetName, 100), datasetVersion: safeLabel(run.datasetVersion, 100),
          totalCases: run.totalCases, hitRate: run.hitRate, meanReciprocalRank: run.meanReciprocalRank,
          faithfulness: run.faithfulness, contextPrecision: run.contextPrecision, injectionPassRate: run.injectionPassRate,
          passed: run.passed, createdAt: run.createdAt.toISOString()
        })) };
      }
      case "get_document": {
        const { documentId, limit = 3 } = mcpReadToolInputSchemas.get_document.parse(args);
        const result = await this.reads.getDocument(tenantId, documentId, limit, signal);
        const passages = (result?.passages ?? []).flatMap((row) => {
          const preview = passageView(row);
          return preview ? [preview] : [];
        });
        return { document: result ? sourceView(result.document) : null, passages };
      }
      case "search_workspace": {
        const { query, limit = 5 } = mcpReadToolInputSchemas.search_workspace.parse(args);
        const masked = redactPii(query).text.replace(/\[REDACTED_[A-Z_]+\]/g, " ");
        const rows = masked.trim() ? await this.search.execute({ tenantId, userId, query: masked, limit, signal }) : [];
        const results = rows.flatMap((row, index) => {
          const preview = passageView(row);
          return preview ? [{
            ...preview, documentId: row.documentId, title: safeLabel(row.title, 160),
            url: publicCitationUrl(row.source), rank: index + 1,
            ...(Number.isFinite(row.score) && row.score >= -1 && row.score <= 1 ? { similarity: row.score } : {})
          }] : [];
        });
        return { results };
      }
      default:
        throw new Error("Workspace read tool is not allowlisted.");
    }
  }
}

function sourceView(source: McpSourceRecord) {
  return {
    id: source.id, title: safeLabel(source.title, 160), url: publicCitationUrl(source.source),
    format: formats.safeParse(source.format).data ?? null,
    language: languages.safeParse(source.language).data ?? null,
    chunkCount: source.chunkCount, updatedAt: source.updatedAt.toISOString()
  };
}

function isLowRisk(text: string): boolean {
  return assessPromptInjection(text).promptInjectionRisk === "low";
}

function maskedText(value: string): string {
  return redactPii(value).text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "");
}

function safeLabel(value: string | null, maxLength: number): string | null {
  if (!value || value.length > maxMetadataChars || !isLowRisk(value)) return null;
  return truncate(maskedText(value), maxLength) || null;
}

function passageView(passage: McpPassageRecord) {
  if (passage.security.promptInjectionRisk !== "low" || passage.security.signals.length
    || passage.content.length > maxMcpPassageChars || !isLowRisk(passage.content)) return null;
  const safe = maskedText(passage.content);
  const excerpt = truncate(safe, 500);
  return excerpt ? { chunkId: passage.chunkId, ordinal: passage.ordinal, excerpt, excerptTruncated: excerpt.length < safe.length } : null;
}

function publicCitationUrl(source: string): string | null {
  if (!source.startsWith("https://") || source.length > maxMetadataChars || /[\s\\\p{Cc}\p{Cf}]/u.test(source)) return null;
  try {
    const url = new URL(source);
    if (url.username || url.password || url.port || !url.hostname.includes(".") || isIP(url.hostname)
      || /\.(?:localhost|local|internal|home\.arpa|onion)\.?$/i.test(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.href.length > 240 || /[\p{Cc}\p{Cf}]/u.test(decodedPath) || !isLowRisk(decodedPath)
      || redactPii(decodedPath).count > 0) return null;
    return url.href;
  } catch {
    return null;
  }
}
