import { Routes, Route } from 'react-router-dom'
import { Landing } from './marketing/Landing.tsx'
import { Login } from './auth/Login.tsx'
import { Signup } from './auth/Signup.tsx'
import { RequireAuth } from './shell/RequireAuth.tsx'
import { AppShell } from './shell/AppShell.tsx'
import { Home } from './shell/Home.tsx'
import { ModulePlaceholder } from './shell/ModulePlaceholder.tsx'
import { StudentsPage } from './students/StudentsPage.tsx'
import { ContentPage } from './content/ContentPage.tsx'
import { ComingSoon } from './ComingSoon.tsx'

// Route map — PLAN.md §4.3. Student-facing surfaces (/try, /b, /s, /hw,
// /review) are chromeless and ported in Phases 2-3; they're stubbed here so
// the full map is navigable from Phase 0.
export function Router() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/try" element={<ComingSoon label="Quick board" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="content" element={<ContentPage />} />
          <Route path="live" element={<ModulePlaceholder title="Live" />} />
          <Route path="assignments" element={<ModulePlaceholder title="Assignments" />} />
          <Route path="analytics" element={<ModulePlaceholder title="Analytics" />} />
          <Route path="settings" element={<ModulePlaceholder title="Settings" />} />
        </Route>
      </Route>

      <Route path="/b/:boardId" element={<ComingSoon label="Board" />} />
      <Route path="/s/:studentToken" element={<ComingSoon label="Student portal" />} />
      <Route path="/hw/:attemptToken" element={<ComingSoon label="Assignment" />} />
      <Route path="/review/:attemptToken" element={<ComingSoon label="Review" />} />
      <Route path="*" element={<ComingSoon label="Not found" />} />
    </Routes>
  )
}
