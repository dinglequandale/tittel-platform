import { Routes, Route, Navigate } from 'react-router-dom'
import { Landing } from './marketing/Landing.tsx'
import { Login } from './auth/Login.tsx'
import { Signup } from './auth/Signup.tsx'
import { RequireAuth } from './shell/RequireAuth.tsx'
import { AppShell } from './shell/AppShell.tsx'
import { Home } from './shell/Home.tsx'
import { StudentsPage } from './students/StudentsPage.tsx'
import { StudentPage } from './students/StudentPage.tsx'
import { ContentPage } from './content/ContentPage.tsx'
import { PortalPage } from './portal/PortalPage.tsx'
import { RunnerPage } from './runner/RunnerPage.tsx'
import { ReviewPage } from './review/ReviewPage.tsx'
import { BoardPage } from './board/BoardPage.tsx'
import { TryLanding } from './board/TryLanding.tsx'
import { InsightsPage } from './insights/InsightsPage.tsx'
import { LessonPage } from './lessons/LessonPage.tsx'
import { SettingsPage } from './settings/SettingsPage.tsx'
import { NotFound } from './NotFound.tsx'
import { GraphPlayground } from './graph/GraphPlayground.tsx'

// Route map — PLAN.md §4.3. Student-facing surfaces (/try, /b, /s, /hw,
// /review) are chromeless and ported in Phases 2-3; they're stubbed here so
// the full map is navigable from Phase 0.
export function Router() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/try" element={<TryLanding />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<RequireAuth />}>
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

      <Route path="/b/:boardId" element={<BoardPage />} />
      <Route path="/s/:studentToken" element={<PortalPage />} />
      <Route path="/hw/:attemptToken" element={<RunnerPage />} />
      <Route path="/review/:attemptToken" element={<ReviewPage />} />
      {import.meta.env.DEV && <Route path="/dev/graph" element={<GraphPlayground />} />}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
