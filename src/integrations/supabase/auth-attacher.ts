import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    if (typeof window === 'undefined') return next({ headers: {} })
    const token = window.localStorage.getItem('orbitfs_panel_session')
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} })
  },
)

export const requirePanelAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest()
    const token = request?.headers.get('authorization')?.replace(/^Bearer\s+/, '')
    if (!token) throw new Error('Not signed in')
    return next({ context: { panelSession: token } })
  },
)
