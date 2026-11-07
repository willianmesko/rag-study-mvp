export type BudgetAlertDeliveryStatus = "queued" | "sending" | "delivered" | "dead_letter";

export type BudgetAlertDeliveryCount = { status: BudgetAlertDeliveryStatus; count: number };
export type BudgetAlertDeliveryRecord = {
  id: string;
  status: BudgetAlertDeliveryStatus;
  attempts: number;
  reason: string | null;
  available_at: Date;
  created_at: Date;
  delivered_at: Date | null;
};
export type BudgetAlertStatus = {
  configured: boolean;
  channel: "webhook";
  windowDays: 30;
  deduplication: "daily";
  deliveries: BudgetAlertDeliveryCount[];
  recent: BudgetAlertDeliveryRecord[];
};
export type BudgetAlertReplayCommand = {
  tenantId: string;
  actorId: string;
  id: string;
  expectedAttempts: number;
  idempotencyKey: string;
};

export class DeliveryCommandError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "stale_state") {
    super(`Delivery command stopped: ${code}.`);
    this.name = "DeliveryCommandError";
  }
}

/** Durable delivery capability; storage, signing and retry implementations stay outside consumers. */
export interface BudgetAlertService {
  readonly configured: boolean;
  enqueue(tenantId: string): Promise<void>;
  status(tenantId: string): Promise<BudgetAlertStatus>;
  replay(input: BudgetAlertReplayCommand): Promise<{ replayed: boolean; id: string }>;
  work(): Promise<void>;
}
