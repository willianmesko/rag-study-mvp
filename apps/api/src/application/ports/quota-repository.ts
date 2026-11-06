export type QuotaResult = {
  allowed: boolean;
  used: number | null;
  limit: number;
};

export interface QuotaRepository {
  consumeQuestion(input: { tenantId: string; actorKey: string; tenantLimit: number; actorLimit: number }): Promise<QuotaResult>;
  consumeUpload(input: { tenantId: string; actorKey: string; bytes: number; limit: number }): Promise<QuotaResult>;
}
