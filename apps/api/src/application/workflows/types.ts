import { z } from "zod";

export const workflowKinds = ["chat", "ingestion", "evaluation"] as const;
export type WorkflowKind = (typeof workflowKinds)[number];
export type WorkflowStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkflowScope = {
  tenantId: string;
  actorId: string;
  runId: string;
};
export const workflowBudgetSchema = z.strictObject({
  maxSteps: z.number().int().min(1).max(100),
  maxCalls: z.number().int().min(1).max(1_024),
  maxInputTokens: z.number().int().min(1).max(4_000_000),
  maxOutputTokens: z.number().int().min(0).max(64_000),
  maxCostMicros: z.number().int().min(0).max(100_000_000),
  timeoutMs: z.number().int().min(1_000).max(600_000),
});
export type WorkflowBudget = z.infer<typeof workflowBudgetSchema>;
export type Reservation = {
  steps?: number;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
};
export type WorkflowSnapshot = WorkflowScope & {
  kind: WorkflowKind;
  version: string;
  status: WorkflowStatus;
  stage: string | null;
  steps: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  budget: WorkflowBudget;
  attempts: number;
  errorCode: string | null;
  resultId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  deadlineAt: Date;
  approvedBy: string | null;
};
export type WorkflowAdmission = WorkflowScope & {
  kind: WorkflowKind;
  version: string;
  input: unknown;
  budget: WorkflowBudget;
};
export type WorkflowLease = WorkflowSnapshot & {
  leaseToken: string;
  input: unknown;
};

export class WorkflowGuardError extends Error {
  constructor(
    readonly code:
      | "budget_exceeded"
      | "lease_lost"
      | "cancelled"
      | "deadline_exceeded"
      | "authorization_revoked"
      | "definition_changed"
      | "state_limit"
      | "queue_full",
  ) {
    super(`Workflow stopped: ${code}.`);
    this.name = "WorkflowGuardError";
  }
}
export class WorkflowApprovalPending extends Error {
  constructor() {
    super("This workflow is waiting for owner approval.");
    this.name = "WorkflowApprovalPending";
  }
}

export interface WorkflowRepository {
  admit(input: WorkflowAdmission): Promise<WorkflowSnapshot>;
  claim(kinds: readonly WorkflowKind[]): Promise<WorkflowLease | null>;
  heartbeat(lease: WorkflowLease): Promise<boolean>;
  release(lease: WorkflowLease): Promise<void>;
  finish(
    lease: WorkflowLease,
    status: "completed" | "failed" | "waiting_approval",
    resultId?: string,
    errorCode?: string,
  ): Promise<boolean>;
  reserve(
    lease: WorkflowLease,
    amount: Reservation,
    stage?: string,
  ): Promise<void>;
  event(
    lease: WorkflowLease,
    stage: string,
    outcome: string,
    durationMs?: number,
  ): Promise<void>;
  get(scope: WorkflowScope): Promise<WorkflowSnapshot | null>;
  list(
    tenantId: string,
    kind: WorkflowKind,
    limit: number,
  ): Promise<WorkflowSnapshot[]>;
  approve(scope: WorkflowScope, userId: string): Promise<boolean>;
  cancel(scope: WorkflowScope): Promise<boolean>;
  effect<T>(
    lease: WorkflowLease,
    key: string,
    reservation: Reservation,
    operation: () => Promise<T>,
  ): Promise<T>;
  prune(): Promise<number>;
}
export type WorkflowHandler = {
  version: string;
  authorize: (lease: WorkflowLease) => Promise<boolean>;
  run: (
    lease: WorkflowLease,
    signal: AbortSignal,
  ) => Promise<{ waiting?: boolean; resultId?: string }>;
};
export interface WorkflowEngine {
  readonly repository: WorkflowRepository;
  register(kind: WorkflowKind, handler: WorkflowHandler): void;
  submit(input: WorkflowAdmission): Promise<WorkflowSnapshot>;
  cancel(scope: WorkflowScope): Promise<boolean>;
  start(): void;
  close(): Promise<void>;
}
