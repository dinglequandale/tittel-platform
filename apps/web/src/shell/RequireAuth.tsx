import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from '../lib/useSession.ts'

export function RequireAuth() {
  const { session, loading } = useSession()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}
