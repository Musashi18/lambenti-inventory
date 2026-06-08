import { MovementType } from "@prisma/client";

export type MovementActionState = {
  success: boolean;
  message: string;
  fieldErrors: Record<string, string[]>;
  domainErrorCode?: string;
  values: Record<string, string>;
};

export const emptyMovementFormValues: Record<string, string> = {
  itemId: "",
  stockLotId: "",
  movementType: MovementType.RECEIVE,
  quantity: "",
  reason: "",
  reference: "",
  newLotCode: "",
  newLotReceivedAt: "",
  newLotUnitCost: "",
  newLotCurrency: "USD"
};

export const initialMovementActionState: MovementActionState = {
  success: false,
  message: "",
  fieldErrors: {},
  values: emptyMovementFormValues
};
