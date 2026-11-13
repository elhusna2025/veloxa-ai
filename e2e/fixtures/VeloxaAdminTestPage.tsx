'use client';

import { VeloxaSuperAdmin } from '@/components/VeloxaSuperAdmin';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data as T;
}

export default function VeloxaAdminTestPage() {
  return <main><VeloxaSuperAdmin request={request} onWorkspace={() => {}} onSignOut={() => {}} /></main>;
}
