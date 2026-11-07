// Deliberate public contracts and capabilities; concrete composition stays in the module factory.
export { type IdentityVerification, type MemberDirectory } from "./application/ports/identity-verifier.js";
export { type IdentityRequest, type RequestIdentity } from "./http/request-identity.js";
