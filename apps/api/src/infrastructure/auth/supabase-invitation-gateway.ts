import { createClient } from "@supabase/supabase-js";
import type { InvitationGateway } from "../../application/integrations/workspace-invitations.js";
import { IntegrationFailure } from "../../application/integrations/retry-policy.js";
import { providerRequestSignal } from "../http/provider-client.js";
export class SupabaseInvitationGateway implements InvitationGateway {
  private readonly client;
  constructor(
    url: string | undefined,
    key: string | undefined,
    private readonly redirectTo: string | undefined,
  ) {
    this.client =
      url && key
        ? createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: {
              fetch: (url, init) =>
                fetch(url, {
                  ...init,
                  redirect: "error",
                  signal: providerRequestSignal(init?.signal),
                }),
            },
          })
        : null;
  }
  async send(email: string) {
    if (!this.client || !this.redirectTo)
      throw new IntegrationFailure("permanent_rejection");
    let result: Awaited<
      ReturnType<typeof this.client.auth.admin.inviteUserByEmail>
    >;
    try {
      result = await this.client.auth.admin.inviteUserByEmail(email, {
        redirectTo: this.redirectTo,
      });
    } catch {
      throw new IntegrationFailure("transport_unknown");
    }
    if (result.error || !result.data.user) {
      const status = result.error?.status;
      throw new IntegrationFailure(
        status === 429
          ? "rate_limited"
          : status && status >= 400 && status < 500
            ? "permanent_rejection"
            : "transport_unknown",
        status,
      );
    }
    return result.data.user.id;
  }
}
