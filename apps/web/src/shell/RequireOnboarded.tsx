import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { PageLoading } from '@tittel/ui'
import { loadOrg, type Org } from '../lib/useOrg.ts'

/**
 * The app itself waits until setup is finished (/welcome). If the workspace
 * can't be read the app comes up anyway, to show its own errors: a server
 * problem shouldn't look like being sent back to the start.
 */
export function RequireOnboarded() {
  const [state, setState] = useState<Org | 'failed' | null>(null)
  useEffect(() => { loadOrg().then(setState).catch(() => setState('failed')) }, [])
  if (state === null) return <PageLoading />
  if (state !== 'failed' && !state.onboardedAt) return <Navigate to="/welcome" replace />
  return <Outlet />
}
