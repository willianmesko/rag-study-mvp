export type InvitationDeliveryRecord = {
  id: string;
  email: string;
  role: "viewer" | "editor";
  state: "sending" | "completed" | "retryable" | "failed" | "ambiguous";
  attempts: number;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Safe owner-facing history, excluding request hashes, credentials and leases. */
export interface InvitationDeliveryHistory {
  list(tenantId: string): Promise<InvitationDeliveryRecord[]>;
  prune(): Promise<void>;
}
