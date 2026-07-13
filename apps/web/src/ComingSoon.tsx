// Chromeless placeholder for student-facing surfaces (/try, /b, /s, /hw,
// /review) that port from the source repos in Phases 2-3 (PLAN.md §10).
export function ComingSoon({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg text-ink-2">
      {label} — coming soon.
    </main>
  )
}
