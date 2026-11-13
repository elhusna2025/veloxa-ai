import { beginWorkspaceInvoice, checkWorkspaceInvoice, readWorkspaceBilling } from '@/lib/server/billing';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { return noStoreJson(await readWorkspaceBilling(request)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return noStoreJson(await beginWorkspaceInvoice(request), 201); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { return noStoreJson(await checkWorkspaceInvoice(request)); }
  catch (error) { return errorResponse(error); }
}
