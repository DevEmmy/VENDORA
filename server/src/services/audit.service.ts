// Allowlisted operational events only: never serialize requests or thrown errors.
export function logAvailability(
  event: "request-unavailable" | "worker-unavailable" | "maintenance-unavailable",
  requestId?: string,
  diagnostic?: { operation: "webhook-processing" | "message-delivery" | "delivery-cleanup" | "session-cleanup" | "http-request"; hint: string },
) {
  console.error(JSON.stringify({ event, ...(requestId ? { requestId } : {}), ...diagnostic, at: new Date().toISOString() }));
}
