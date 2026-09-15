export type FirmwareIdentity = {
  raw: string;
  family: string;
  branch: string;
  date: string;
  ecuTarget: string;
  definitionHash: string;
};

export function parseFirmwareIdentity(signature: string): FirmwareIdentity | null {
  const raw = signature.trim();
  if (!raw) return null;

  const match = raw.match(
    /^(.+?)\s+([^.\s]+)\.(\d{4})\.(\d{2})\.(\d{2})\.([^.]+)\.([^.\s]+)$/,
  );
  if (!match) return null;

  const [, family, branch, year, month, day, ecuTarget, definitionHash] = match;
  return {
    raw,
    family: family.trim(),
    branch,
    date: `${year}-${month}-${day}`,
    ecuTarget,
    definitionHash,
  };
}

export function firmwareIdentitySummary(signature: string): string {
  const identity = parseFirmwareIdentity(signature);
  if (!identity) {
    const trimmed = signature.trim();
    if (trimmed.length <= 54) return trimmed;
    return `${trimmed.slice(0, 51)}…`;
  }

  return [
    identity.family,
    identity.date,
    identity.ecuTarget,
  ].join(' · ');
}

export function firmwareIdentityDetail(signature: string): string {
  const identity = parseFirmwareIdentity(signature);
  if (!identity) return signature.trim();

  return [
    identity.family,
    identity.branch,
    identity.date,
    identity.ecuTarget,
    `definition ${identity.definitionHash}`,
  ].join(' · ');
}
