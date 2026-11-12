import { lazy, Suspense, type ComponentType } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { PageLoading } from '@tittel/ui'
import { Landing } from './marketing/Landing.tsx'
import { Login } from './auth/Login.tsx'
import { Signup } from './auth/Signup.tsx'
import { ForgotPassword, ResetPassword } from './auth/PasswordReset.tsx'
import { LegalPage } from './marketing/LegalPage.tsx'
import { RequireAuth } from './shell/RequireAuth.tsx'
import { RequireOnboarded } from './shell/RequireOnboarded.tsx'
import { PortalPage } from './portal/PortalPage.tsx'
import { RunnerPage } from './runner/RunnerPage.tsx'
import { ReviewPage } from './review/ReviewPage.tsx'
import { NotFound } from './NotFound.tsx'

// Students open /s, /hw and /review on phones, so those ship in the first
// download. The tutor app, the board (with its calculator) and pdf.js load
// only when a route needs them (LAUNCH.md L4.7).
function load<K extends string>(factory: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => factory().then((m) => ({ default: m[name] })))
}
const Onboarding = load(() => import('./onboarding/Onboarding.tsx'), 'Onboarding')
const AppShell = load(() => import('./shell/AppShell.tsx'), 'AppShell')
const Home = load(() => import('./shell/Home.tsx'), 'Home')
const StudentsPage = load(() => import('./students/StudentsPage.tsx'), 'StudentsPage')
const StudentPage = load(() => import('./students/StudentPage.tsx'), 'StudentPage')
const ContentPage = load(() => import('./content/ContentPage.tsx'), 'ContentPage')
const InsightsPage = load(() => import('./insights/InsightsPage.tsx'), 'InsightsPage')
const LessonPage = load(() => import('./lessons/LessonPage.tsx'), 'LessonPage')
const SettingsPage = load(() => import('./settings/SettingsPage.tsx'), 'SettingsPage')
const BoardPage = load(() => import('./board/BoardPage.tsx'), 'BoardPage')
const TryLanding = load(() => import('./board/TryLanding.tsx'), 'TryLanding')
const GraphPlayground = load(() => import('./graph/GraphPlayground.tsx'), 'GraphPlayground')

// Route map — PLAN.md §4.3. Student-facing surfaces (/try, /b, /s, /hw,
// /review) are chromeless and ported in Phases 2-3; they're stubbed here so
// the full map is navigable from Phase 0.
export function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/try" element={<TryLanding />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot" element={<ForgotPassword />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/privacy" element={<LegalPage doc="privacy" />} />
      <Route path="/terms" element={<LegalPage doc="terms" />} />

      <Route element={<RequireAuth />}>
        <Route path="/welcome" element={<Onboarding />} />
        <Route element={<RequireOnboarded />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="lessons/:lessonId" element={<LessonPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="students/:studentId" element={<StudentPage />} />
            <Route path="library" element={<ContentPage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            {/* Pre-FLOW-SPEC paths, kept so old bookmarks land somewhere sensible. */}
            <Route path="content" element={<Navigate to="/app/library" replace />} />
            <Route path="assignments" element={<Navigate to="/app/insights?tab=homework" replace />} />
            <Route path="analytics" element={<Navigate to="/app/insights" replace />} />
            <Route path="live" element={<Navigate to="/app" replace />} />
          </Route>
        </Route>
      </Route>

      <Route path="/b/:boardId" element={<BoardPage />} />
      <Route path="/s/:studentToken" element={<PortalPage />} />
      <Route path="/hw/:attemptToken" element={<RunnerPage />} />
      <Route path="/review/:attemptToken" element={<ReviewPage />} />
      {import.meta.env.DEV && <Route path="/dev/graph" element={<GraphPlayground />} />}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  )
}
