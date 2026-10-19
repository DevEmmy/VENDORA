import { ZodError } from "zod";

export type StartupStage =
  | "configuration"
  | "signing keys"
  | "database"
  | "Redis"
  | "application"
  | "HTTP listener"
  | "delivery";
export function startupHint(stage: StartupStage, error: unknown): string {
  if (error instanceof ZodError) {
    return `Invalid environment fields: ${[...new Set(error.issues.map((issue) => issue.path.join(".")))].join(", ")}`;
  }
  // Inspect internally, but report only fixed hints. Driver errors can contain URLs.
  const inspect = (value: unknown, depth = 0): string => {
    if (depth > 4 || typeof value !== "object" || value === null) return "";
    const record = value as Record<string, unknown>;
    return [
      record.code,
      record.message,
      inspect(record.cause, depth + 1),
      inspect(record.meta, depth + 1),
      inspect(record.driverAdapterError, depth + 1),
    ]
      .filter((value) => typeof value === "string")
      .join(" ");
  };
  const details = inspect(error);
  if (stage === "configuration" && /Voice configuration missing:/.test(details))
    return details;
  if (/EADDRINUSE/.test(details))
    return "The configured PORT is already in use; stop the existing server instance or choose another PORT.";
  if (
    /SELF_SIGNED_CERT|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|self.signed|certificate/i.test(
      details,
    )
  )
    return "TLS certificate verification failed; configure the provider CA using DATABASE_CA_FILE (keep DATABASE_TLS=true).";
  if (/ENOENT/.test(details))
    return "A configured file could not be read; check DATABASE_CA_FILE and file permissions.";
  if (/28P01|authentication failed|WRONGPASS|P1000/i.test(details))
    return "Authentication failed; check this dependency's username/password.";
  if (/42501|permission denied/i.test(details))
    return "Database permissions are missing; apply the runtime grants.";
  if (/42P01|P2021|does not exist/i.test(details))
    return "Application tables are missing; verify migrations and the target database.";
  if (/P2022|42703/i.test(details))
    return "Application columns are missing; verify migrations and the target database.";
  if (/P2024|P2028|transaction.*timed out|transaction.*expired/i.test(details))
    return "Database transaction or connection acquisition timed out; check database latency and pool capacity.";
  if (stage === "signing keys")
    return "Check matching RSA keys with PKCS8 private and SPKI public PEM headers.";
  if (stage === "database")
    return "Check DATABASE_URL, provider CA, network connectivity, migrations and runtime grants.";
  if (stage === "Redis")
    return "Check the rediss:// TCP URL, password and network connectivity.";
  if (stage === "delivery")
    return "Check database connectivity, DELIVERY_URL, DELIVERY_TOKEN, RECOVERY_ORIGIN and DELIVERY_ENCRYPTION_KEY; also check delivery-provider availability.";
  if (stage === "configuration")
    return "Check server/.env origins, TLS/cookie policy and paired provider settings.";
  return "Check application configuration and local file permissions.";
}
