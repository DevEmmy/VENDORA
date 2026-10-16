import { apiRequest } from "../../lib/api.js";
import {
  getState,
  subscribe,
  getActiveStorageKey,
} from "../../lib/store.js";

const accountKey = (userId, businessId) =>
  `vendora:account:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;

const getSales = () =>
  (getState().txns || []).filter(
    (txn) => txn?.type === "sale" && typeof txn.id === "string"
  );

const serializeSales = () => JSON.stringify(getSales());

export function startSalesSync({ userId, businessId }) {
  if (!userId || !businessId) {
    throw new Error("A verified user and business are required.");
  }

  const expectedKey = accountKey(userId, businessId);
  const isCorrectAccount = () =>
    getActiveStorageKey() === expectedKey;

  let stopped = false;
  let uploading = false;
  let conflict = false;
  let timer = null;
  let acknowledged = null;
  let lastObserved = serializeSales();

  const active = () => !stopped && isCorrectAccount();

  function schedule(delay = 800) {
    if (!active() || conflict) return;

    clearTimeout(timer);

    timer = setTimeout(() => {
      upload().catch((error) => {
        if (active()) {
          console.error("[Vendora] Sales sync failed:", error);
        }
      });
    }, delay);
  }

  async function upload() {
    if (!active() || uploading || conflict) return;

    const snapshot = serializeSales();

    if (snapshot === acknowledged) return;

    let sales;

    try {
      sales = JSON.parse(snapshot);
    } catch {
      console.error("[Vendora] Unable to serialize sales.");
      return;
    }

    uploading = true;

    try {
      // Backend supports batches of up to 1,000 sales.
      for (let i = 0; i < sales.length; i += 100) {
        if (!active()) return;

        await apiRequest("/api/sales/sync", {
          method: "POST",
          businessId,
          body: {
            sales: sales.slice(i, i + 100),
          },
        });

        if (!active()) return;
      }

      if (!active()) return;

      acknowledged = snapshot;

      console.info("[Vendora] Sales synchronized.");
    } catch (error) {
      if (!active()) return;

      if (error.status === 409) {
        conflict = true;

        console.error(
          "[Vendora] Sales conflict detected. Local records preserved; automatic uploads paused.",
          error
        );

        return;
      }

      console.warn(
        "[Vendora] Sales upload unavailable. Local records remain saved.",
        error
      );

      schedule(15000);
    } finally {
      uploading = false;

      if (
        active() &&
        !conflict &&
        acknowledged !== null &&
        serializeSales() !== acknowledged
      ) {
        schedule(0);
      }
    }
  }

  const unsubscribe = subscribe(() => {
    if (!active()) return;

    const current = serializeSales();

    if (current === lastObserved) return;

    lastObserved = current;
    schedule();
  });

  const onOnline = () => {
    if (active()) schedule(0);
  };

  window.addEventListener("online", onOnline);

  // Upload pending local sales after login or refresh.
  schedule(0);

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", onOnline);
  };
}