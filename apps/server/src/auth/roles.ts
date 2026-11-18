/**
 * Roles in team mode (S9-3, SPEC 16): owner, admin, member and viewer. Pure rules, so they can be read and tested without a server.
 * The owner does everything. An admin also manages the company (settings, departments, projects) but does not decide hires, merges, deploys
 * or the like. A member decides content and outreach only. A viewer reads. A signed-in person with no role is a viewer: the safe default.
 */
export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Approval kinds a member may decide: what the company says to the world. */
export const CONTENT_KINDS: readonly string[] = ['email.send', 'post.publish', 'dm.send', 'video.brief'];

/** Paths only the owner may write to: how autonomous the company is. */
const OWNER_ONLY = [/^\/api\/talent\/policy/, /^\/api\/owner/];
/** Paths an admin and the owner may write to: how the company is set up. */
const ADMIN_ONLY = [/^\/api\/settings/, /^\/api\/setup/, /^\/api\/companies/, /^\/api\/departments/, /^\/api\/code-projects/, /^\/api\/office\/decor/, /^\/api\/office\/undo/, /^\/api\/runtime-pauses/, /^\/api\/browser/];

const rank: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** May this role make this request? Reading is open to everyone signed in; the kind of an approval is checked separately by `mayDecide`. */
export function mayRequest(role: Role, method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (role === 'viewer') return false;
  if (OWNER_ONLY.some((re) => re.test(path))) return role === 'owner';
  if (ADMIN_ONLY.some((re) => re.test(path))) return rank[role] >= rank.admin;
  return true;
}

/** May this role decide an approval of this kind? */
export function mayDecide(role: Role, kind: string): boolean {
  if (role === 'owner') return true;
  if (role === 'viewer') return false;
  return CONTENT_KINDS.includes(kind);
}
