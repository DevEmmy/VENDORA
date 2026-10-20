import {
  encryptReplicaEnvelope,
  decryptReplicaEnvelope,
  parseScope,
} from './encryptedReplicaRepository.js';
import { emptyReplica } from '../sync/outbox.js';
import { registerMigrationInProgress } from './accountStorage.js';

export class MigrationError extends Error {
  constructor(message, stage = 'unknown', cause = null) {
    super(message);
    this.name = 'MigrationError';
    this.stage = stage;
    this.cause = cause;
  }
}

export const DOMAIN_KEYS = Object.freeze([
  'products',
  'txns',
  'customers',
  'ledger',
  'invoiceSeq',
]);

export function accountStorageKey(userId, businessId) {
  return `vendora:account:${encodeURIComponent(String(userId))}:${encodeURIComponent(
    String(businessId)
  )}:v1`;
}

export function extractAccountState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const domainKeySet = new Set(DOMAIN_KEYS);
  const accountState = {};

  for (const [key, value] of Object.entries(snapshot)) {
    if (!domainKeySet.has(key) && key !== 'localSync') {
      accountState[key] = structuredClone(value);
    }
  }

  return accountState;
}

export function verifyReplicaIntegrity(original, migrated) {
  if (!migrated || typeof migrated !== 'object') {
    throw new MigrationError('Migrated replica is not a valid object.', 'verification');
  }

  // Verify outbox operations (preserving IDs, sequences, actions)
  const origOutbox = original.outbox || [];
  const migOutbox = migrated.outbox || [];

  if (origOutbox.length !== migOutbox.length) {
    throw new MigrationError(
      `Outbox count mismatch: expected ${origOutbox.length}, got ${migOutbox.length}.`,
      'verification'
    );
  }

  for (let i = 0; i < origOutbox.length; i++) {
    const o = origOutbox[i];
    const m = migOutbox[i];
    if (o.id !== m.id || o.action !== m.action || o.sequence !== m.sequence) {
      throw new MigrationError(
        `Outbox operation mismatch at index ${i}: expected ID ${o.id}, got ${m.id}.`,
        'verification'
      );
    }
  }

  // Verify cursor & nextSequence
  if (original.cursor !== migrated.cursor) {
    throw new MigrationError(
      `Cursor mismatch: expected ${original.cursor}, got ${migrated.cursor}.`,
      'verification'
    );
  }

  if (original.nextSequence !== migrated.nextSequence) {
    throw new MigrationError(
      `Next sequence mismatch: expected ${original.nextSequence}, got ${migrated.nextSequence}.`,
      'verification'
    );
  }

  // Verify canonical collections
  for (const col of ['products', 'sales', 'movements']) {
    const origKeys = Object.keys(original.canonical?.[col] || {});
    const migKeys = Object.keys(migrated.canonical?.[col] || {});
    if (origKeys.length !== migKeys.length) {
      throw new MigrationError(
        `Canonical collection '${col}' count mismatch: expected ${origKeys.length}, got ${migKeys.length}.`,
        'verification'
      );
    }
  }

  // Verify domain data
  if (original.domain) {
    if (!migrated.domain) {
      throw new MigrationError('Domain state missing in migrated replica.', 'verification');
    }
    for (const key of DOMAIN_KEYS) {
      const origVal = original.domain[key];
      const migVal = migrated.domain[key];
      if (Array.isArray(origVal)) {
        if (!Array.isArray(migVal) || origVal.length !== migVal.length) {
          throw new MigrationError(
            `Domain collection '${key}' length mismatch.`,
            'verification'
          );
        }
      }
    }
  }

  // Verify account state (localStorage snapshot preservation)
  if (original.accountState) {
    for (const key of Object.keys(original.accountState)) {
      if (!(key in (migrated.accountState || {}))) {
        throw new MigrationError(
          `Account state key '${key}' missing from migrated replica.`,
          'verification'
        );
      }
    }
  }

  return true;
}

export async function getMigrationStatus({ repository, scope }) {
  const currentRaw = await repository.readRaw(scope);
  const migrationState = await repository.readRaw(`migration_state:${scope}`);
  const staged = await repository.readRaw(`migration_staged:${scope}`);
  const backup = await repository.readRaw(`migration_backup:${scope}`);

  return {
    isMigrated: Boolean(currentRaw && currentRaw._encrypted === true),
    state: migrationState?.state || 'not_started',
    hasStaged: Boolean(staged),
    hasBackup: Boolean(backup),
    revision: currentRaw?._encrypted ? currentRaw.revision : null,
  };
}

export async function resumeOrRecoverMigration({
  repository,
  scope,
  accountKey,
  localStorage = globalThis.localStorage,
}) {
  const currentRaw = await repository.readRaw(scope);
  const migrationState = await repository.readRaw(`migration_state:${scope}`);
  const status = await getMigrationStatus({ repository, scope });
  const { userId, businessId } = parseScope(scope);
  const storageKey = accountStorageKey(userId, businessId);

  // Scenario 1 & 2: If scope already contains an active encrypted replica
  // (whether at revision 1, or revision 2+ if a new sale was recorded before cleanup)
  if (currentRaw && currentRaw._encrypted === true) {
    let decrypted = null;
    try {
      decrypted = await decryptReplicaEnvelope(accountKey, scope, currentRaw);
    } catch (err) {
      // FAIL CLOSED: Never replace active encrypted replica with a stale plaintext backup!
      // Preserve all records (active scope, backups, and localStorage) intact.
      throw new MigrationError(
        'Active encrypted storage exists at scope but cannot be decrypted with the provided key. Failing closed to preserve records.',
        'recovery',
        err
      );
    }

    if (!decrypted || typeof decrypted !== 'object' || !Array.isArray(decrypted.outbox)) {
      throw new MigrationError(
        'Active encrypted storage decrypted to an invalid structure. Failing closed to preserve records.',
        'recovery'
      );
    }

    // Verified decryptable active replica! Clean up leftover staging/backup records safely.
    // The active encrypted replica at scope is LEFT UNTOUCHED at its current revision.
    if (status.hasStaged) await repository.deleteRaw(`migration_staged:${scope}`);
    if (status.hasBackup) await repository.deleteRaw(`migration_backup:${scope}`);
    await repository.deleteRaw(`migration_snapshot_backup:${scope}`);
    await repository.deleteRaw(`migration_state:${scope}`);
    if (localStorage?.removeItem) {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }

    return {
      status: 'recovered_and_cleaned',
      scope,
      revision: currentRaw.revision,
    };
  }

  // Pre-activation crash recovery (preparing, staged, verifying)
  if (
    migrationState?.state === 'preparing' ||
    migrationState?.state === 'staged' ||
    migrationState?.state === 'verifying'
  ) {
    // If scope was wiped/corrupted, restore original plaintext from backup
    if (!currentRaw && status.hasBackup) {
      const backup = await repository.readRaw(`migration_backup:${scope}`);
      if (backup) {
        await repository.writeRaw(scope, backup);
      }
    }

    // Clean up staging artifacts and reset to not_started so migration can run cleanly
    if (status.hasStaged) await repository.deleteRaw(`migration_staged:${scope}`);
    if (status.hasBackup) await repository.deleteRaw(`migration_backup:${scope}`);
    await repository.deleteRaw(`migration_snapshot_backup:${scope}`);
    await repository.deleteRaw(`migration_state:${scope}`);

    return { status: 'rolled_back_to_plaintext', scope };
  }

  return { status: 'idle', scope };
}

export async function migrateAccountStorage({
  repository,
  scope,
  accountKey,
  localStorage = globalThis.localStorage,
  options = {},
}) {
  if (!accountKey) {
    throw new MigrationError('A valid account encryption key is required.', 'initialization');
  }
  if (!scope || typeof scope !== 'string') {
    throw new MigrationError('A valid scope string is required.', 'initialization');
  }

  const runMigration = async () => {
    const { userId, businessId } = parseScope(scope);
    const storageKey = accountStorageKey(userId, businessId);

    // Check if crash recovery from a prior interrupted migration is needed
    await resumeOrRecoverMigration({ repository, scope, accountKey, localStorage });

    // Check if already migrated
    const initialRaw = await repository.readRaw(scope);
  if (initialRaw && initialRaw._encrypted === true) {
    return {
      status: 'already_migrated',
      scope,
      revision: initialRaw.revision,
    };
  }

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // --- Step 1: Read Plaintext Data from IndexedDB and localStorage ---
    const currentRaw = await repository.readRaw(scope);
    if (currentRaw && currentRaw._encrypted === true) {
      return {
        status: 'already_migrated',
        scope,
        revision: currentRaw.revision,
      };
    }

    const sourceAtStartJson = JSON.stringify(currentRaw || null);

    let legacyReplica = currentRaw ? structuredClone(currentRaw) : null;
    let localSnapshot = null;
    let snapshotAtStartRaw = null;

    if (localStorage?.getItem) {
      try {
        snapshotAtStartRaw = localStorage.getItem(storageKey);
        if (snapshotAtStartRaw) {
          localSnapshot = JSON.parse(snapshotAtStartRaw);
        }
      } catch {
        // Storage unavailable or invalid JSON
      }
    }

    if (!legacyReplica && !localSnapshot) {
      legacyReplica = emptyReplica();
    } else if (!legacyReplica) {
      legacyReplica = emptyReplica();
    }

    // Build comprehensive replica preserving outbox, canonical, domain, and account snapshot fields
    const comprehensiveReplica = {
      ...emptyReplica(),
      ...structuredClone(legacyReplica),
    };

    // Incorporate domain fields from localSnapshot if missing from replica
    if (!comprehensiveReplica.domain && localSnapshot) {
      comprehensiveReplica.domain = {
        products: structuredClone(localSnapshot.products || []),
        txns: structuredClone(localSnapshot.txns || []),
        customers: structuredClone(localSnapshot.customers || []),
        ledger: structuredClone(localSnapshot.ledger || []),
        invoiceSeq: localSnapshot.invoiceSeq || 0,
      };
    }

    // Incorporate non-domain account snapshot fields (profile, staff, savings, credits, cac, etc.)
    if (localSnapshot) {
      const extracted = extractAccountState(localSnapshot);
      comprehensiveReplica.accountState = {
        ...(comprehensiveReplica.accountState || {}),
        ...extracted,
      };
    }

    // Preserve all outbox operations and their IDs exactly
    comprehensiveReplica.outbox = (legacyReplica.outbox || []).map(item => structuredClone(item));
    comprehensiveReplica.canonical = structuredClone(
      legacyReplica.canonical || { products: {}, sales: {}, movements: {} }
    );
    comprehensiveReplica.mappings = structuredClone(
      legacyReplica.mappings || { products: {}, sales: {}, customers: {} }
    );

    // --- Step 2: Stage: Preparation (Create durable recovery backups) ---
    await repository.writeRaw(`migration_backup:${scope}`, structuredClone(legacyReplica));
    if (localSnapshot) {
      await repository.writeRaw(
        `migration_snapshot_backup:${scope}`,
        structuredClone(localSnapshot)
      );
    }
    await repository.writeRaw(`migration_state:${scope}`, {
      state: 'preparing',
      startedAt: Date.now(),
      scope,
    });

    if (options.simulateCrashAt === 'preparing') {
      throw new MigrationError('Simulated crash during preparation.', 'preparing');
    }

    // --- Step 3: Stage: Encrypted Staging ---
    const revision = 1;
    const stagedEnvelope = await encryptReplicaEnvelope(
      accountKey,
      scope,
      comprehensiveReplica,
      revision
    );

    await repository.writeRaw(`migration_staged:${scope}`, stagedEnvelope);
    await repository.writeRaw(`migration_state:${scope}`, {
      state: 'staged',
      stagedAt: Date.now(),
      scope,
    });

    if (options.simulateCrashAt === 'staged') {
      throw new MigrationError('Simulated crash during staging.', 'staged');
    }

    // --- Step 4: Stage: Verification ---
    await repository.writeRaw(`migration_state:${scope}`, {
      state: 'verifying',
      scope,
    });

    const readBackStaged = await repository.readRaw(`migration_staged:${scope}`);
    if (!readBackStaged || readBackStaged._encrypted !== true) {
      throw new MigrationError(
        'Verification failed: staged record missing or unencrypted.',
        'verifying'
      );
    }

    const decryptedStaged = await decryptReplicaEnvelope(accountKey, scope, readBackStaged);
    verifyReplicaIntegrity(comprehensiveReplica, decryptedStaged);

    if (options.simulateCrashAt === 'verifying') {
      throw new MigrationError('Simulated crash during verification.', 'verifying');
    }

    // --- Pre-activation source consistency check ---
    // Check if localStorage snapshot changed during staging
    const latestSnapshotRaw = localStorage?.getItem ? localStorage.getItem(storageKey) : null;
    if (latestSnapshotRaw !== snapshotAtStartRaw) {
      // Snapshot changed while staging was in progress; clean staging and retry with fresh snapshot
      await repository.deleteRaw(`migration_staged:${scope}`);
      continue;
    }

    // --- Step 5: Stage: Activation (Atomic source comparison) ---
    await repository.writeRaw(`migration_state:${scope}`, {
      state: 'activating',
      scope,
    });

    // Atomically write the verified encrypted envelope to scope ONLY IF the source record hasn't changed!
    let activation;
    if (typeof repository.activateEnvelopeWithSourceCheck === 'function') {
      activation = await repository.activateEnvelopeWithSourceCheck(
        scope,
        stagedEnvelope,
        sourceAtStartJson
      );
    } else {
      // Direct fallback
      const current = await repository.readRaw(scope);
      if (JSON.stringify(current || null) !== sourceAtStartJson) {
        activation = { activated: false, reason: 'source_changed' };
      } else {
        await repository.writeRaw(scope, stagedEnvelope);
        activation = { activated: true };
      }
    }

    if (!activation.activated) {
      // Source changed in IndexedDB while staging was in progress! Clean staging and retry with fresh source!
      await repository.deleteRaw(`migration_staged:${scope}`);
      continue;
    }

    // Confirm that active scope is indeed now encrypted
    const activatedRaw = await repository.readRaw(scope);
    if (!activatedRaw || activatedRaw._encrypted !== true) {
      await repository.writeRaw(scope, legacyReplica);
      throw new MigrationError(
        'Activation failed: encrypted envelope could not be confirmed at scope.',
        'activating'
      );
    }

    if (options.simulateCrashAt === 'activating') {
      throw new MigrationError('Simulated crash during activation.', 'activating');
    }

    // --- Step 6: Stage: Cleanup (Verified safe purge) ---
    await repository.writeRaw(`migration_state:${scope}`, {
      state: 'cleaning',
      scope,
    });

    // Remove plaintext snapshot from localStorage
    if (localStorage?.removeItem) {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }

    // Clean up temporary staging and backup records
    await repository.deleteRaw(`migration_staged:${scope}`);
    await repository.deleteRaw(`migration_backup:${scope}`);
    await repository.deleteRaw(`migration_snapshot_backup:${scope}`);
    await repository.deleteRaw(`migration_state:${scope}`);

    return {
      status: 'migrated',
      scope,
      revision: 1,
      outboxCount: comprehensiveReplica.outbox.length,
    };
  }

    throw new MigrationError(
      `Failed to migrate storage for ${scope} due to persistent concurrent updates.`,
      'activation'
    );
  };

  const migrationPromise = (typeof repository.executeUnderLock === 'function')
    ? repository.executeUnderLock(scope, runMigration)
    : runMigration();

  registerMigrationInProgress(scope, migrationPromise);
  return migrationPromise;
}
