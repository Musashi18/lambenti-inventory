export type IncomingReceiveActionState = {
  success: boolean;
  message: string;
  fieldErrors: Record<string, string[]>;
  domainErrorCode?: string;
  values: Record<string, string>;
};

export const emptyIncomingReceiveFormValues: Record<string, string> = {
  purchaseOrderLineId: "",
  quantity: "",
  lotCode: "",
  receivedAt: "",
  unitCost: "",
  currency: "USD",
  reference: "",
  notes: "",
  overrideReason: ""
};

export const initialIncomingReceiveActionState: IncomingReceiveActionState = {
  success: false,
  message: "",
  fieldErrors: {},
  values: emptyIncomingReceiveFormValues
};
