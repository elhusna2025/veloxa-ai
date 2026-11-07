import { graphRequest } from './meta-graph';
import { ApiError } from './http';

export interface AuthorizedMetaPage {
  id: string;
  name: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string };
}
type ReadGraph = (path: string, values: Record<string, string>) => Promise<unknown>;
const fields = 'id,name,access_token,tasks,instagram_business_account{id,username}';
const pageFields = 'id,name,access_token,instagram_business_account{id,username}';

/** Some Business assignments omit the selected Page from /me/accounts.
 * Query only Page IDs that Meta itself included in the verified token's granular grants.
 */
export async function discoverMetaPages(token: string, selectedIds: string[], read: ReadGraph = (path, values) => graphRequest(path, token, 'GET', values)) {
  const pages = new Map<string, AuthorizedMetaPage>();
  const deniedTasks = new Set<string>();
  const consider = (page: AuthorizedMetaPage, explicitPublishGrant = false) => {
    if (!page || !/^\d+$/.test(page.id) || typeof page.name !== 'string' || !page.access_token) return;
    const contentTask = page.tasks?.some(task => ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT', 'PROFILE_PLUS_FULL_CONTROL'].includes(task));
    if (Array.isArray(page.tasks) && !contentTask) { deniedTasks.add(page.id); return; }
    if (!contentTask && !explicitPublishGrant) return;
    pages.set(page.id, page);
    if (pages.size > 200) throw new ApiError(400, 'Pilih maksimal 200 Page saat memberikan izin Meta.');
  };
  let after: string | undefined;
  for (let index = 0; index < 100; index++) {
    const result = await read('me/accounts', { fields, limit: '100', ...(after ? { after } : {}) }) as { data?: AuthorizedMetaPage[]; paging?: { next?: string; cursors?: { after?: string } } };
    if (!Array.isArray(result.data)) throw new ApiError(502, 'Daftar Page Meta belum dapat dibaca.');
    result.data.forEach(page => consider(page));
    if (!result.paging?.next) break;
    after = result.paging.cursors?.after;
    if (!after || index === 99) throw new ApiError(400, 'Daftar Page belum lengkap. Batasi Page yang dipilih saat memberikan izin.');
  }
  for (const id of [...new Set(selectedIds)].filter(id => /^\d+$/.test(id) && !pages.has(id) && !deniedTasks.has(id)).slice(0, 20)) {
    // `tasks` is account-edge metadata, not a general Page-node field.
    // These IDs must come specifically from Meta's pages_manage_posts granular grant.
    consider(await read(id, { fields: pageFields }) as AuthorizedMetaPage, true);
  }
  if (!pages.size) throw new ApiError(400, 'Tidak ditemukan Facebook Page dengan izin membuat konten. Periksa akses Page Anda.');
  return [...pages.values()];
}
