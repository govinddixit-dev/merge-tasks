/**
 * generateExternalCustomerId — Single utility for generating PSRESTful external customer IDs.
 *
 * Format:
 *   Organizations: mkf_org_{id}
 *   Clients:       mkf_client_{id}
 *
 * IMPORTANT: These IDs are globally unique across both tables by prefix convention.
 * The mkf_org_ and mkf_client_ prefixes must never be changed without updating
 * both the organizations and clients CHECK constraints in migration 0087.
 * See: docs/build-log/phase-3/sub-accounts-architecture.md
 */

export function generateOrgExternalId(organizationId: number): string {
  return `mkf_org_${organizationId}`;
}

export function generateClientExternalId(clientId: number): string {
  return `mkf_client_${clientId}`;
}

/**
 * Parse the type and internal ID from an external customer ID.
 * Returns null if the format is not recognized.
 */
export function parseExternalCustomerId(
  externalId: string
): { type: "org" | "client"; id: number } | null {
  if (externalId.startsWith("mkf_org_")) {
    const id = parseInt(externalId.replace("mkf_org_", ""), 10);
    return isNaN(id) ? null : { type: "org", id };
  }
  if (externalId.startsWith("mkf_client_")) {
    const id = parseInt(externalId.replace("mkf_client_", ""), 10);
    return isNaN(id) ? null : { type: "client", id };
  }
  return null;
}
