import type { Role } from "@bcp/shared";

export type AuthUserSnapshot = {
  id: string;
  username: string;
  displayName: string;
  roles: Role[];
  urgentBypass: boolean;
  tokenVersion: number;
};

export type AccessTokenPayload = {
  sub: string;
  username: string;
  roles: Role[];
  urgentBypass: boolean;
  tokenVersion: number;
};

export function toAccessTokenPayload(user: AuthUserSnapshot): AccessTokenPayload {
  return {
    sub: user.id,
    username: user.username,
    roles: user.roles,
    urgentBypass: user.urgentBypass,
    tokenVersion: user.tokenVersion,
  };
}

export function toPublicUser(user: AuthUserSnapshot) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles,
    capabilities: { urgentBypass: user.urgentBypass },
  };
}
