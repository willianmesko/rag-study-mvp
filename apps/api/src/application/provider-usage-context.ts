import { AsyncLocalStorage } from "node:async_hooks";
export type ProviderUsageScope = {
  tenantId: string;
  actorKey: string;
  purpose?: "evaluation";
};
const scopes = new AsyncLocalStorage<ProviderUsageScope>(),
  receipts = new AsyncLocalStorage<string>();
export const withProviderUsageScope = <T>(
  value: ProviderUsageScope,
  work: () => T,
) => scopes.run(value, work);
export const currentProviderUsageScope = () => scopes.getStore();
export const withProviderReceipt = <T>(key: string, work: () => T) =>
  receipts.run(key, work);
export const currentProviderReceipt = () => receipts.getStore();
