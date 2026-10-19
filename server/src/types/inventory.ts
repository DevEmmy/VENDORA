export interface InventoryActor {
  businessId: string;
  userId: string;
}

export interface OperationOutcome<T> {
  result: T;
  duplicate: boolean;
}
