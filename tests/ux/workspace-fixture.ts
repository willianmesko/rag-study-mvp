import type { BrowserContext } from "@playwright/test";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const token = "fixture-workspace-token";
const authSession = {
  access_token: token,
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_at: 4_102_444_800,
  expires_in: 3600,
  user: { id: userId, email: "owner@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }
};

type GuideProgress = WorkspaceOnboardingProgress;
type Member = { userId: string; email: string; role: "owner" | "editor" | "viewer"; createdAt: string };

const date = "2026-09-04T12:00:00.000Z";
const workspace = { tenantId: workspaceId, tenantName: "Northstar Studio", tenantSlug: "northstar-studio", role: "owner" };
const team: Member[] = [
  { userId, email: "owner@example.test", role: "owner", createdAt: date },
  { userId: "33333333-3333-4333-a333-333333333333", email: "editor@example.test", role: "editor", createdAt: date },
  { userId: "44444444-4444-4444-a444-444444444444", email: "knowledge.reviewer.with.a.long.address@example.test", role: "viewer", createdAt: date }
];

export function workspaceFixture(initialProgress: GuideProgress | null = { goal: "it", step: "answer", completed: true }) {
  let progress = initialProgress;
  let members = [...team];
  const changes = { deleted: [] as string[], updated: [] as string[], invitations: [] as string[] };
  const root = `/v1/workspaces/${workspaceId}`;

  return {
    changes,
    async attach(context: BrowserContext) {
      await context.addInitScript((session) => {
        if (window.location.hostname === "127.0.0.1") localStorage.setItem("sb-fixture-auth-token", JSON.stringify(session));
      }, authSession);
      await context.route("https://fixture.supabase.co/**", (route) => route.abort());
      await context.route("**/health", (route) => route.fulfill({ json: { status: "ok" } }));
      await context.route("**/v1/**", async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        const method = request.method();
        const headers = request.headers();
        if (headers.authorization !== `Bearer ${token}`) return route.fulfill({ status: 401, json: { error: "Missing fixture session." } });
        if (pathname === "/v1/workspaces" && method === "GET") return route.fulfill({ json: { workspaces: [workspace] } });
        if (headers["x-workspace-id"] !== workspaceId) return route.fulfill({ status: 403, json: { error: "Wrong fixture workspace." } });

        if (pathname === `${root}/onboarding`) {
          if (method === "PATCH") progress = request.postDataJSON() as GuideProgress;
          return route.fulfill({ json: { progress } });
        }
        if (pathname === `${root}/invitations` && method === "POST") {
          changes.invitations.push(request.postDataJSON().email);
          return route.fulfill({ status: 409, json: { error: "The fixture member already has access." } });
        }
        if (pathname === `${root}/members` && method === "GET") return route.fulfill({ json: { members } });
        if (pathname.startsWith(`${root}/members/`)) {
          const memberId = pathname.split("/").at(-1)!;
          if (method === "DELETE") {
            changes.deleted.push(memberId);
            members = members.filter((member) => member.userId !== memberId);
            return route.fulfill({ status: 204 });
          }
          if (method === "PATCH") {
            changes.updated.push(memberId);
            const { role } = request.postDataJSON() as Pick<Member, "role">;
            members = members.map((member) => member.userId === memberId ? { ...member, role } : member);
            return route.fulfill({ status: 204 });
          }
        }
        if (pathname === "/v1/admin/documents") return route.fulfill({ json: { documents: [] } });
        if (pathname === "/v1/admin/uploads") return route.fulfill({ json: { jobs: [] } });
        if (pathname === "/v1/admin/evaluations") return route.fulfill({ json: { runs: [] } });
        if (pathname === "/v1/admin/usage") return route.fulfill({ json: {
          days: 30, summary: { requests: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, averageLatencyMs: 0, providerFailures: 0 },
          alert: { thresholdUsd: 1, triggered: false }
        } });
        return route.fulfill({ status: 404, json: { error: "Unrecognized fixture route." } });
      });
    }
  };
}
