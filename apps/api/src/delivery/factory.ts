import type { Env } from "../env.js";
import { AcsSmsDeliveryAdapter } from "./acs-sms.js";
import { StubDeliveryAdapter, type DeliveryPort } from "./port.js";

/**
 * Prefer ACS when both connection string and from-number are set;
 * otherwise keep the in-memory stub (CI / local without Azure secrets).
 */
export function isAcsConfigured(env: Pick<
  Env,
  "ACS_CONNECTION_STRING" | "ACS_PHONE_NUMBER"
>): boolean {
  return Boolean(env.ACS_CONNECTION_STRING && env.ACS_PHONE_NUMBER);
}

export function createDeliveryPort(env: Env): {
  deliveryPort: DeliveryPort;
  stubDelivery: StubDeliveryAdapter;
} {
  const stubDelivery = new StubDeliveryAdapter();
  if (!isAcsConfigured(env)) {
    return { deliveryPort: stubDelivery, stubDelivery };
  }
  return {
    stubDelivery,
    deliveryPort: new AcsSmsDeliveryAdapter({
      connectionString: env.ACS_CONNECTION_STRING!,
      fromPhoneNumber: env.ACS_PHONE_NUMBER!,
    }),
  };
}
