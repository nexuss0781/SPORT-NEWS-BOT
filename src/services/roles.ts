import { Api } from "teleproto";
import { config } from "../config";
import { getCopyClient } from "./copyService";
import { getConfig, updateConfig } from "./storage";

export type Role = "owner" | "admin";

export interface RoleMember {
  id: number;
  name: string;
  removable?: boolean;
}

// Owner = the operator (env ADMIN_IDS/ADMIN_USERNAMES, immutable) + any DB-stored owners.
export async function isOwner(
  userId: number | undefined,
  username?: string
): Promise<boolean> {
  if (!userId) return false;
  if (config.adminIds.includes(userId)) return true;
  if (username && config.adminUsernames.includes(username.toLowerCase().replace(/^@/, ""))) {
    return true;
  }
  const cfg = await getConfig();
  return (cfg.owners || []).includes(userId);
}

// Admin (journalist) = a DB-stored admin. Owners can also post news.
export async function isAdminRole(
  userId: number | undefined,
  username?: string
): Promise<boolean> {
  if (!userId) return false;
  const cfg = await getConfig();
  if ((cfg.admins || []).includes(userId)) return true;
  if (username) {
    const normalized = username.toLowerCase().replace(/^@/, "");
    return Object.values(cfg.roleNames || {}).some(
      (name) => String(name).toLowerCase() === normalized
    );
  }
  return false;
}

// Anyone allowed to review/publish the news queue.
export async function canPost(
  userId: number | undefined,
  username?: string
): Promise<boolean> {
  return (await isOwner(userId, username)) || (await isAdminRole(userId, username));
}

// True when there is at least one owner anywhere (env operator or DB-stored),
// so the UI can allow bootstrapping the first owner from the chat.
export async function hasAnyOwner(): Promise<boolean> {
  if (config.adminIds.length > 0 || config.adminUsernames.length > 0) return true;
  const cfg = await getConfig();
  return (cfg.owners || []).length > 0;
}

export async function getRoleMembers(role: Role): Promise<RoleMember[]> {
  const cfg = await getConfig();
  const ids = role === "owner" ? cfg.owners || [] : cfg.admins || [];
  const names = cfg.roleNames || {};
  const out: RoleMember[] = [];
  for (const id of ids) {
const isOperator =
        config.adminIds.includes(id) ||
        config.adminUsernames.includes(String(names[String(id)] || id).toLowerCase());
      out.push({ id, name: `@${names[String(id)] || id}`, removable: !isOperator });
    }
    if (role === "owner") {
      // Operator env ids always count as owners, show them at the end.
      for (const id of config.adminIds) {
        if (!ids.includes(id)) out.push({ id, name: `@${names[String(id)] || id}`, removable: false });
      }
    }
  return out;
}

export async function addRoleMember(role: Role, id: number, name?: string): Promise<boolean> {
  const cfg = await getConfig();
  const ids = role === "owner" ? cfg.owners || [] : cfg.admins || [];
  // The operator (env ADMIN_IDS) is a permanent owner; no need to re-add.
  if (config.adminIds.includes(id)) return false;
  if (ids.includes(id)) return false;
  const roleNames = { ...(cfg.roleNames || {}) };
  if (name) roleNames[String(id)] = name.replace(/^@/, "");
  if (role === "owner") {
    await updateConfig({ owners: [...ids, id], roleNames });
  } else {
    await updateConfig({ admins: [...ids, id], roleNames });
  }
  return true;
}

export async function removeRoleMember(role: Role, id: number): Promise<boolean> {
  const cfg = await getConfig();
  const ids = role === "owner" ? cfg.owners || [] : cfg.admins || [];
  if (!ids.includes(id)) return false;
  const updated: number[] = ids.filter((x) => x !== id);
  if (role === "owner") {
    await updateConfig({ owners: updated });
  } else {
    await updateConfig({ admins: updated });
  }
  return true;
}

function normalizeUsername(input: string): string {
  let u = String(input || "").trim();
  u = u.replace(/^@/, "");
  u = u.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "");
  u = u.split(/[/?#]/)[0];
  return u;
}

// Resolve a @username (or t.me/... handle) to a Telegram user id. Uses the
// MTProto session so private/journalist user accounts resolve too.
export async function resolveUsernameToId(
  input: string
): Promise<{ ok: true; id: number; username: string; name?: string } | { ok: false; error: string }> {
  const username = normalizeUsername(input);
  if (!username) return { ok: false, error: "No username found. Send something like @username." };

  const client = await getCopyClient();
  try {
    const res: any = await client.invoke(new Api.contacts.ResolveUsername({ username }));
    const users: any[] = res?.users || [];
    const user = users.find((u: any) => u.className === "User");
    if (!user) {
      return { ok: false, error: `"@${username}" is not a user (could be a channel).` };
    }
    const id = Number(user.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: `Could not resolve an id for "@${username}".` };
    }
    const name =
      user.username || [user.firstName, user.lastName].filter(Boolean).join(" ");
    return { ok: true, id, username, name: name || `@${username}` };
  } catch (error: any) {
    const msg = String(error?.errorMessage || error?.message || error);
    if (msg.includes("USERNAME_NOT_OCCUPIED")) {
      return { ok: false, error: `No Telegram user has "@${username}".` };
    }
    return { ok: false, error: `Could not resolve "@${username}": ${msg}` };
  }
}