import { chatRunEventSchema, type ChatRunEvent, type QuestionInput } from "@rag-study/contracts";
import { ApiError } from "./rag-api";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const maxFrameLength = 256_000;

type WorkspaceSession = { accessToken: string; workspaceId: string };
type StreamObserver = (event: ChatRunEvent, sequence: number | null) => void;
type TerminalEvent = Extract<ChatRunEvent, { type: "completed" | "error" | "cancelled" }>;

export class StreamInterrupted extends Error {
  constructor() { super("The connection closed before the answer finished."); }
}

function headers(session?: WorkspaceSession) {
  return session ? { authorization: `Bearer ${session.accessToken}`, "x-workspace-id": session.workspaceId } : undefined;
}

async function checkResponse(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  throw new ApiError(body.error ?? body.message ?? "The request could not be completed.", response.status);
}

export async function startAnswerStream(input: QuestionInput, options: {
  signal: AbortSignal;
  workspace?: WorkspaceSession;
  runId?: string;
}, onEvent: StreamObserver): Promise<TerminalEvent> {
  const response = await fetch(`${apiBaseUrl}/v1/qa/stream`, {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json", ...headers(options.workspace) },
    body: JSON.stringify({ ...input, runId: options.runId })
  });
  return readStream(response, { allowLegacy: true, after: 0 }, onEvent);
}

export async function resumeAnswerStream(runId: string, after: number, workspace: WorkspaceSession,
  signal: AbortSignal, onEvent: StreamObserver): Promise<TerminalEvent> {
  const response = await fetch(`${apiBaseUrl}/v1/qa/runs/${encodeURIComponent(runId)}/events?after=${after}`, {
    headers: headers(workspace), signal, cache: "no-store"
  });
  return readStream(response, { allowLegacy: false, after }, onEvent);
}

export async function cancelAnswerRun(runId: string, workspace: WorkspaceSession, signal: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/v1/qa/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST", headers: headers(workspace), signal
  });
  await checkResponse(response);
  const result = await response.json() as { status?: string };
  if (result.status !== "cancelled" && result.status !== "completed" && result.status !== "failed") {
    throw new StreamInterrupted();
  }
  return result.status;
}

function legacyData(name: string, data: unknown) {
  switch (name) {
    case "completed": return { type: name, response: data };
    case "error": return { ...data as object, type: name, code: "execution_failed" };
    default: return { ...data as object, type: name };
  }
}

async function readStream(response: Response, options: { allowLegacy: boolean; after: number },
  onEvent: StreamObserver): Promise<TerminalEvent> {
  await checkResponse(response);
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    void response.body?.cancel().catch(() => {});
    throw new StreamInterrupted();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = options.after;
  let durable = !options.allowLegacy || cursor > 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      if (buffer.length > maxFrameLength) throw new StreamInterrupted();
      for (const frame of frames) {
        if (frame.length > maxFrameLength) throw new StreamInterrupted();
        const lines = frame.split(/\r?\n/);
        const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!name || !data) continue; // Heartbeats use SSE comment lines.
        const rawId = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
        const sequence = rawId === undefined ? null : Number(rawId);
        if (sequence === null && durable) throw new StreamInterrupted();
        if (sequence !== null) {
          durable = true;
          if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new StreamInterrupted();
          if (sequence <= cursor) continue;
          if (sequence !== cursor + 1) throw new StreamInterrupted();
        }

        let payload: unknown;
        try { payload = JSON.parse(data); } catch { throw new StreamInterrupted(); }
        const event = chatRunEventSchema.safeParse(sequence === null ? legacyData(name, payload) : payload);
        if (!event.success || event.data.type !== name) throw new StreamInterrupted();
        if (sequence !== null) cursor = sequence;
        onEvent(event.data, sequence);
        if (event.data.type === "completed" || event.data.type === "error" || event.data.type === "cancelled") return event.data;
      }
      if (done) throw new StreamInterrupted();
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
