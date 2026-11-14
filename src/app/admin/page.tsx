'use client'

import { useRemoteStore } from '@/lib/remote-store'
import { AdminPanel } from '@/components/admin/AdminPanel'

export default function AdminPage() {
  const { acceso } = useRemoteStore()
  if (!acceso?.esSuperadmin) return <p className="p-8 text-sm text-zinc-500">No encontrado.</p>
  return <AdminPanel />
}
