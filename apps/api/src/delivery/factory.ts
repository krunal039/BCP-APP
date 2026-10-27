import type { Env } from "../env.js";
import { AcsSmsDeliveryAdapter } from "./acs-sms.js";
import { ExpoPushSender } from "./expo-push.js";
import {
  StubDeliveryAdapter,
  StubSmsExpoDeliveryAdapter,
  type DeliveryPort,
} from "./port.js";
import { StubPushSender, type PushSender } from "./push-sender.js";

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

/**
 * Live Expo Push when EXPO_PUSH_ENABLED=true (or 1).
 * EXPO_ACCESS_TOKEN is optional (recommended in production for rate limits / auth).
 * Leave disabled in CI so fan-out never hits exp.host.
 */
export function isExpoPushEnabled(env: Pick<Env, "EXPO_PUSH_ENABLED">): boolean {
  return env.EXPO_PUSH_ENABLED === true;
}

export function createPushSender(env: Env): PushSender {
  if (!isExpoPushEnabled(env)) {
    return new StubPushSender();
  }
  return new ExpoPushSender({
    accessToken: env.EXPO_ACCESS_TOKEN,
  });
}

export function createDeliveryPort(env: Env): {
  deliveryPort: DeliveryPort;
  stubDelivery: StubDeliveryAdapter;
  pushSender: PushSender;
} {
  const stubDelivery = new StubDeliveryAdapter();
  const pushSender = createPushSender(env);

  if (isAcsConfigured(env)) {
    return {
      stubDelivery,
      pushSender,
      deliveryPort: new AcsSmsDeliveryAdapter({
        connectionString: env.ACS_CONNECTION_STRING!,
        fromPhoneNumber: env.ACS_PHONE_NUMBER!,
        pushSender,
      }),
    };
  }

  if (isExpoPushEnabled(env)) {
    return {
      stubDelivery,
      pushSender,
      deliveryPort: new StubSmsExpoDeliveryAdapter(pushSender),
    };
  }

  return { deliveryPort: stubDelivery, stubDelivery, pushSender };
}
