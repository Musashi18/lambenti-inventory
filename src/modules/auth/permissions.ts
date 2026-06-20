export const USER_ROLES = ["ADMIN", "OPERATIONS", "PURCHASING", "ACCOUNTING", "VIEWER", "AGENT"] as const;

export type UserRoleName = (typeof USER_ROLES)[number];
export type LambentiActorType = "HUMAN" | "AGENT" | "SYSTEM";
export type ActorType = "USER" | "AGENT" | "SYSTEM";

export type LambentiActor = {
  id: string;
  type: LambentiActorType;
  role: UserRoleName;
};

export type AuthenticatedActor = LambentiActor & {
  actorType: ActorType;
  email?: string;
};

export type Permission =
  | "item:view"
  | "item:edit"
  | "stockMovement:create"
  | "receiving:confirm"
  | "cycleCount:manage"
  | "supplier:view"
  | "supplier:edit"
  | "purchaseRecommendation:view"
  | "purchaseRequest:draft"
  | "purchaseRequest:approve"
  | "purchaseOrder:create"
  | "invoice:create"
  | "invoice:approve"
  | "invoice:markPaid"
  | "accounting:view"
  | "integration:mutate"
  | "automation:view"
  | "automation:run"
  | "agentApi:read";

type ResolveEnv = {
  nodeEnv?: string;
  appSecret?: string;
  agentSecret?: string;
  allowLocalProductionAuth?: string;
  devUserId?: string;
  devUserRole?: string;
  devUserEmail?: string;
};

type ResolveOptions = {
  agentOnly?: boolean;
};

export type AuthResult =
  | { ok: true; actor: AuthenticatedActor }
  | { ok: false; status: 401 | 403 | 503; message: string };

const PERMISSIONS: Record<UserRoleName, Set<Permission>> = {
  ADMIN: new Set<Permission>([
    "item:view",
    "item:edit",
    "stockMovement:create",
    "receiving:confirm",
    "cycleCount:manage",
    "supplier:view",
    "supplier:edit",
    "purchaseRecommendation:view",
    "purchaseRequest:draft",
    "purchaseRequest:approve",
    "purchaseOrder:create",
    "invoice:create",
    "invoice:approve",
    "invoice:markPaid",
    "accounting:view",
    "integration:mutate",
    "automation:view",
    "automation:run",
    "agentApi:read"
  ]),
  OPERATIONS: new Set<Permission>([
    "item:view",
    "item:edit",
    "stockMovement:create",
    "receiving:confirm",
    "cycleCount:manage",
    "purchaseRecommendation:view",
    "automation:view",
    "automation:run"
  ]),
  PURCHASING: new Set<Permission>([
    "item:view",
    "supplier:view",
    "supplier:edit",
    "purchaseRecommendation:view",
    "purchaseRequest:draft",
    "purchaseRequest:approve",
    "purchaseOrder:create",
    "automation:view",
    "automation:run"
  ]),
  ACCOUNTING: new Set<Permission>([
    "item:view",
    "supplier:view",
    "invoice:create",
    "invoice:approve",
    "invoice:markPaid",
    "accounting:view"
  ]),
  VIEWER: new Set<Permission>([
    "item:view",
    "supplier:view",
    "purchaseRecommendation:view",
    "accounting:view",
    "automation:view"
  ]),
  AGENT: new Set<Permission>([
    "agentApi:read",
    "item:view",
    "supplier:view",
    "purchaseRecommendation:view",
    "purchaseRequest:draft",
    "automation:view"
  ])
};

export class AuthorizationError extends Error {
  status: 401 | 403 | 503;

  constructor(message: string, status: 401 | 403 | 503 = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export function hasPermission(actor: Partial<AuthenticatedActor> & Pick<AuthenticatedActor, "role">, permission: Permission) {
  return PERMISSIONS[actor.role]?.has(permission) ?? false;
}

export function assertPermission(actor: AuthenticatedActor, permission: Permission) {
  if (!hasPermission(actor, permission)) {
    throw new AuthorizationError(`${actor.role} does not have permission for ${permission}.`, 403);
  }
}

export function resolveActorFromHeaders(
  headers: Headers,
  env: ResolveEnv = readAuthEnv(),
  options: ResolveOptions = {}
): AuthResult {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  if (!isProduction) {
    return resolveDevelopmentActor(headers, env, options);
  }

  const bearer = bearerToken(headers);
  if (options.agentOnly) {
    if (!env.agentSecret) {
      return { ok: false, status: 503, message: "Agent auth is not configured for production." };
    }
    if (bearer !== env.agentSecret) {
      return { ok: false, status: 401, message: "Unauthorized agent request." };
    }
    return {
      ok: true,
      actor: {
        id: headers.get("x-lambenti-agent-id") ?? "authenticated-agent",
        role: "AGENT",
        type: "AGENT",
        actorType: "AGENT"
      }
    };
  }

  if (!env.appSecret && localProductionAppAuthAllowed(headers, env)) {
    return resolveDevelopmentActor(headers, env, options);
  }

  if (!env.appSecret) {
    return { ok: false, status: 503, message: "Application auth is not configured for production." };
  }
  if (bearer !== env.appSecret) {
    return { ok: false, status: 401, message: "Unauthorized request." };
  }

  const role = parseUserRole(headers.get("x-lambenti-user-role"));
  if (!role || role === "AGENT") {
    return { ok: false, status: 403, message: "Authenticated human role header is required." };
  }

  return {
    ok: true,
    actor: {
      id: headers.get("x-lambenti-user-id") ?? headers.get("x-lambenti-user-email") ?? "authenticated-user",
      role,
      type: "HUMAN",
      actorType: "USER",
      email: headers.get("x-lambenti-user-email") ?? undefined
    }
  };
}

export function readAuthEnv(): ResolveEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    appSecret: process.env.LAMBENTI_APP_AUTH_SECRET,
    agentSecret: process.env.LAMBENTI_AGENT_API_SECRET ?? process.env.LAMBENTI_ALIBABA_AGENT_SECRET,
    allowLocalProductionAuth: process.env.LAMBENTI_ALLOW_LOCAL_PROD_AUTH,
    devUserId: process.env.LAMBENTI_DEV_USER_ID,
    devUserRole: process.env.LAMBENTI_DEV_USER_ROLE,
    devUserEmail: process.env.LAMBENTI_DEV_USER_EMAIL
  };
}

export async function getCurrentActor(): Promise<AuthenticatedActor> {
  const headers = await safeNextHeaders();
  const result = resolveActorFromHeaders(headers ?? new Headers());
  if (result.ok) return result.actor;
  const failure = result as Extract<AuthResult, { ok: false }>;
  throw new AuthorizationError(failure.message, failure.status);
}

export async function requirePermission(permission: Permission): Promise<AuthenticatedActor> {
  const actor = await getCurrentActor();
  assertPermission(actor, permission);
  return actor;
}

export function authorizeAgentRequest(request: Request, env: ResolveEnv = readAuthEnv()): AuthResult {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production" && !env.agentSecret && localProductionAgentAuthAllowed(request, env)) {
    return {
      ok: true,
      actor: {
        id: request.headers.get("x-lambenti-agent-id") ?? "dev-agent",
        role: "AGENT",
        type: "AGENT",
        actorType: "AGENT"
      }
    };
  }
  return resolveActorFromHeaders(new Headers(request.headers), env, { agentOnly: true });
}

function localProductionAgentAuthAllowed(request: Request, env: ResolveEnv) {
  return truthy(env.allowLocalProductionAuth)
    && isLoopbackRequest(request)
    && headerHostIsLoopback(new Headers(request.headers));
}

function isLoopbackRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function resolveDevelopmentActor(headers: Headers, env: ResolveEnv, options: ResolveOptions): AuthResult {
  const role = parseUserRole(env.devUserRole ?? headers.get("x-lambenti-user-role")) ?? "ADMIN";
  const actorType: ActorType = role === "AGENT" || options.agentOnly ? "AGENT" : "USER";
  return {
    ok: true,
    actor: {
      id: env.devUserId ?? headers.get("x-lambenti-user-id") ?? (actorType === "AGENT" ? "dev-agent" : "dev-admin"),
      role: options.agentOnly ? "AGENT" : role,
      type: actorType === "AGENT" ? "AGENT" : "HUMAN",
      actorType,
      email: env.devUserEmail ?? headers.get("x-lambenti-user-email") ?? undefined
    }
  };
}

function localProductionAppAuthAllowed(headers: Headers, env: ResolveEnv) {
  return truthy(env.allowLocalProductionAuth) && headerHostIsLoopback(headers);
}

function headerHostIsLoopback(headers: Headers) {
  const host = hostnameFromHeader(headers.get("host"));
  if (!isLoopbackHost(host)) return false;

  for (const headerName of ["x-forwarded-host", "origin"] as const) {
    const headerHost = hostnameFromHeader(headers.get(headerName));
    if (headerHost && !isLoopbackHost(headerHost)) return false;
  }

  return true;
}

function isLoopbackHost(hostname: string | undefined) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function hostnameFromHeader(value: string | null) {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  if (!first) return undefined;
  try {
    return new URL(first.includes("://") ? first : `http://${first}`).hostname;
  } catch {
    return first.replace(/^\[/, "").replace(/\](:\d+)?$/, "").split(":")[0];
  }
}

function truthy(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function authFailureJson(result: Extract<AuthResult, { ok: false }>) {
  return Response.json({ error: result.message }, { status: result.status });
}

function bearerToken(headers: Headers) {
  const header = headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function parseUserRole(value: string | null | undefined): UserRoleName | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (USER_ROLES as readonly string[]).includes(upper) ? (upper as UserRoleName) : undefined;
}

async function safeNextHeaders(): Promise<Headers | undefined> {
  try {
    const nextHeaders = await import("next/headers");
    const readonlyHeaders = await nextHeaders.headers();
    const headers = new Headers();
    readonlyHeaders.forEach((value, key) => headers.set(key, value));
    return headers;
  } catch {
    return undefined;
  }
}
