import { apiRequest } from "../../lib/api.js";
import {
  getState,
  setState,
  subscribe,
  getActiveStorageKey,
} from "../../lib/store.js";

const inventoryKey = (userId, businessId) =>
  `vendora:inventory-sync:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;

const serialize = (products) =>
  JSON.stringify(
    products.map((product) => ({
      id: product.id,
      name: product.name,
      aliases: product.aliases || [],
      unit: product.unit,
      price: Number(product.price) || 0,
      cost: Number(product.cost) || 0,
      qty: Number(product.qty) || 0,
      lowAt: Number(product.lowAt) || 0,
      ...(product.updatedAt !== undefined
        ? { updatedAt: product.updatedAt }
        : {}),
    }))
  );

const parseInventory = (value) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export function startInventorySync({ userId, businessId }) {
  if (!userId || !businessId) {
    throw new Error("A verified user and business are required.");
  }

  const key = inventoryKey(userId, businessId);
  const expectedAccountKey =
    `vendora:account:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;

  const isCorrectAccount = () =>
    getActiveStorageKey() === expectedAccountKey;

  let stopped = false;
  let uploading = false;
  let initialized = false;
  let timer = null;
  let version = null;
  let conflict = false;

  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  })();

  let acknowledged = stored?.acknowledged ?? null;
  let lastObserved = serialize(getState().products);

  function saveMetadata() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          acknowledged,
          version,
          updatedAt: Date.now(),
        })
      );
    } catch {
      console.warn("[Vendora] Inventory sync metadata could not be saved.");
    }
  }

  function schedule(delay = 800) {
    if (stopped || !isCorrectAccount() || conflict || !initialized) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      upload().catch((error) => {
        console.error("[Vendora] Inventory sync failed:", error);
      });
    }, delay);
  }

  async function upload() {
    if (stopped || !isCorrectAccount() || uploading || conflict || !initialized) return;

    const current = serialize(getState().products);

    if (current === acknowledged) return;

    uploading = true;

    try {
      const inventory = parseInventory(current);

      if (!inventory) {
        throw new Error("Unable to serialize inventory.");
      }

      const result = await apiRequest("/api/inventory", {
        method: "PUT",
        businessId,
        body: {
          inventory,
          expectedUpdatedAt: version,
        },
      });

      if (stopped || !isCorrectAccount()) return;

      version = result.updatedAt;
      acknowledged = current;
      saveMetadata();

      console.info("[Vendora] Inventory synchronized.");

      if (serialize(getState().products) !== acknowledged) {
        schedule(0);
      }
    } catch (error) {
      if (stopped || !isCorrectAccount()) return;

      if (error.status === 409) {
        try {
          const latest = await apiRequest("/api/inventory", {
            businessId,
          });

          if (stopped || !isCorrectAccount()) return;

          const remote = serialize(latest.inventory || []);
          const local = serialize(getState().products);

          if (remote === acknowledged) {
            // The version changed, but the server inventory
            // still matches our last acknowledged snapshot.
            // Retry with the current server version.
            version = latest.updatedAt ?? null;
            saveMetadata();

            console.info(
              "[Vendora] Inventory version refreshed. Retrying pending changes."
            );

            // The retry must happen after uploading becomes false.
            setTimeout(() => {
              if (
                !stopped &&
                isCorrectAccount() &&
                !conflict &&
                local !== acknowledged
              ) {
                schedule(0);
              }
            }, 0);

            return;
          }

          // Actual server inventory changed.
          // Never overwrite another device's changes.
          conflict = true;

          console.error(
            "[Vendora] Inventory conflict: server data changed. Local changes preserved. Automatic upload stopped."
          );
        } catch (refreshError) {
          console.warn(
            "[Vendora] Unable to refresh inventory version. Local changes preserved.",
            refreshError
          );

          schedule(15000);
        }

        return;
      }

      console.warn(
        "[Vendora] Inventory upload unavailable. Local changes remain saved.",
        error
      );

      schedule(15000);
    } finally {
      uploading = false;
    }
  }

  const unsubscribe = subscribe(() => {
    if (stopped || !isCorrectAccount()) return;

    const current = serialize(getState().products);

    if (current === lastObserved) return;

    lastObserved = current;
    schedule();
  });

  async function initialize() {
    try {
      const result = await apiRequest("/api/inventory", {
        businessId,
      });

      if (stopped || !isCorrectAccount()) return;

      version = result.updatedAt ?? null;

      const remote = serialize(result.inventory || []);
      const local = serialize(getState().products);

      // Do not apply an initialization response after the
      // active business has changed.
      if (stopped || !isCorrectAccount()) return;

      // Capture the current local inventory only after the
      // server response arrives, so edits made during the
      // request are included in conflict detection.

      if (acknowledged === null) {
        if (local === remote) {
          acknowledged = local;
        } else if (
          local === "[]" &&
          result.initialized &&
          Array.isArray(result.inventory)
        ) {
          setState((draft) => {
            draft.products = structuredClone(result.inventory);
          });

          acknowledged = serialize(getState().products);
          lastObserved = acknowledged;
        } else if (local !== "[]") {
          // Existing local products may be unsynced.
          // Never replace remote inventory without a known baseline.
          conflict = true;
          console.warn(
            "[Vendora] Local and server inventory differ without a sync baseline. Automatic upload paused."
          );
        } else if (!result.initialized) {
          acknowledged = local;
        }
      } else if (acknowledged === local) {
        // No pending local edits: safely accept the current server copy.
        if (remote !== local) {
          setState((draft) => {
            draft.products = structuredClone(result.inventory || []);
          });

          acknowledged = serialize(getState().products);
          lastObserved = acknowledged;
        }
      } else if (remote === acknowledged) {
        // Only local inventory changed. The server still matches
        // the last acknowledged inventory, so upload may proceed.
        console.info(
          "[Vendora] Local inventory changes pending synchronization."
        );
      } else {
        // Both local and server inventories differ from the baseline.
        // Never overwrite either automatically.
        conflict = true;
        console.warn(
          "[Vendora] Inventory conflict detected. Local data preserved; automatic upload paused."
        );
      }

      initialized = true;
      saveMetadata();

      if (!conflict && serialize(getState().products) !== acknowledged) {
        schedule(0);
      }
    } catch (error) {
      if (!stopped && isCorrectAccount()) {
        console.warn(
          "[Vendora] Inventory sync waiting for connection.",
          error
        );
      }
    }
  }

  const onOnline = () => {
    if (!isCorrectAccount()) return;
    if (!initialized) {
      initialize();
    } else {
      schedule(0);
    }
  };

  window.addEventListener("online", onOnline);

  initialize();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", onOnline);
  };
}