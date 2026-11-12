'use client';

import { VeloxaSuperAdmin } from '@/components/VeloxaSuperAdmin';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data as T;
}

export default function VeloxaAdminTestPage() {
  return <main className="min-h-dvh bg-[#f8f5f7] px-4 py-6 sm:px-8"><VeloxaSuperAdmin request={request} /></main>;
}
