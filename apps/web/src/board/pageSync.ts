import type { BoardEditor } from './engine/editor.ts'
import type { ControlChannel } from './controlChannel.ts'
import type { FollowController } from './cameraSync.ts'

const BROADCAST_MS = 100

// Keeps every student on the same page as the tutor. The set of pages lives in
// the synced document (so everyone *has* them), but which page each person is
// *viewing* is local state and does NOT sync — so we relay the tutor's current
// page over the control channel, exactly like the camera.
//  - Tutor (host): broadcasts its current page whenever it changes.
//  - Student (guest): snaps to whatever page the tutor sends. With free reign on,
//    following is released so the student can browse pages on their own; turning
//    it back off snaps them to the tutor's current page. If a target page hasn't
//    arrived over sync yet, it's applied as soon as it does.
export function setupPageSync(
  editor: BoardEditor,
  channel: ControlChannel,
  isHost: boolean,
  initialFollow = true,
): FollowController {
  const cleanups: Array<() => void> = []

  if (!isHost) {
    // ---- Guest: follow the tutor's page (toggleable) ----
    let following = initialFollow
    let last: string | null = null // latest page the tutor announced

    // A no-op until the page exists here, and a student who wanders while
    // following lands back on it: both are this one check on every change.
    const settle = () => {
      if (following && last && editor.getCurrentPageId() !== last) editor.setCurrentPage(last)
    }

    cleanups.push(
      channel.on('page', (m) => {
        if (typeof m.pageId !== 'string') return
        last = m.pageId
        settle()
      }),
    )
    cleanups.push(editor.subscribe(settle))

    return {
      stop: () => cleanups.forEach((fn) => fn()),
      setFollow: (follow: boolean) => {
        following = follow
        settle()
      },
    }
  }

  // ---- Host: broadcast page changes ----
  let last: string | null = null
  const broadcast = (force: boolean) => {
    const id = editor.getCurrentPageId()
    if (force || id !== last) {
      last = id
      channel.send({ type: 'page', pageId: id })
    }
  }
  const timer = setInterval(() => broadcast(false), BROADCAST_MS)
  cleanups.push(() => clearInterval(timer))
  cleanups.push(channel.on('open', () => broadcast(true)))

  return { stop: () => cleanups.forEach((fn) => fn()), setFollow: () => {} }
}
