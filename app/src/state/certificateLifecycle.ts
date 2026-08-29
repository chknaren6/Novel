import { type CertificateStatus, ToolError } from "@/lib/types";

// From 04-DATA-AND-STATE-SPEC.md "Certificate lifecycle".
const CERTIFICATE_TRANSITIONS: Record<CertificateStatus, CertificateStatus[]> = {
  draft: ["valid"],
  valid: ["consumed", "superseded"],
  consumed: ["broken"],
  broken: ["compensated"],
  compensated: [],
  superseded: [],
};

export function assertValidCertificateTransition(from: CertificateStatus, to: CertificateStatus): void {
  const allowed = CERTIFICATE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ToolError("POLICY_VIOLATION", `Cannot transition certificate from "${from}" to "${to}"`, false);
  }
}
