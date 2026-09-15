const MAX_ARCHIVE_REASON_LENGTH = 500;

function fail(message) {
  throw new Error(message);
}

export function assertTuneLifecycleMetadata(tune, context = 'metadata') {
  const status = tune.lifecycleStatus;
  const archivedAt = tune.archivedAt;
  const archiveReason = tune.archiveReason;

  if (status === undefined) {
    if (archivedAt !== undefined || archiveReason !== undefined) {
      fail(`${context}: archivedAt/archiveReason require lifecycleStatus "Archived".`);
    }
    return { archived: false };
  }

  if (status !== 'Archived') {
    fail(`${context}: lifecycleStatus must be exactly "Archived" when supplied.`);
  }

  if (typeof archivedAt !== 'string' || !archivedAt.trim()) {
    fail(`${context}: archived tunes must contain archivedAt.`);
  }

  if (archiveReason !== undefined) {
    if (typeof archiveReason !== 'string' || !archiveReason.trim()) {
      fail(`${context}: "archiveReason" must be a non-empty string when supplied.`);
    }
    if (archiveReason.trim().length > MAX_ARCHIVE_REASON_LENGTH) {
      fail(
        `${context}: "archiveReason" exceeds the ${MAX_ARCHIVE_REASON_LENGTH}-character publication limit.`,
      );
    }
  }

  return {
    archived: true,
    archivedAt: archivedAt.trim(),
    ...(archiveReason !== undefined ? { archiveReason: archiveReason.trim() } : {}),
  };
}
