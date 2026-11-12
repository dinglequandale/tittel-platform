import { Link } from 'react-router-dom'
import { MathArt, Qed, Wordmark } from '@tittel/ui'
import { BRAND_NAME, BRAND_TAGLINE, FEEDBACK_EMAIL } from '@tittel/shared'
import lessonShot from './shots/lesson.png'
import boardShot from './shots/board.png'
import updateShot from './shots/update.png'

// The lean landing (LAUNCH.md L4.3): the hero, one honest paragraph, three
// screenshots of the real app (the test stack's sample student, never real
// data), sign up, and a contact line. No pricing table, no scroll show.
const SHOTS = [
  { src: lessonShot, alt: 'A lesson page with its plan, homework and notes', caption: 'Each lesson holds its plan, its homework and what happened.' },
  { src: boardShot, alt: 'The live whiteboard with a lesson plan and students’ answers', caption: 'Teach on a live board. Students answer the plan’s questions on it.' },
  { src: updateShot, alt: 'A parent update drafted from the lesson', caption: 'When the lesson ends, the parent update is already drafted.' },
]

export function Landing() {
  return (
    <div className="landing">
      <Link to="/" className="corner corner-tl" aria-label={`${BRAND_NAME} home`}><Wordmark name={BRAND_NAME} /></Link>
      <Link to="/login" className="corner corner-tr">sign in</Link>
      <main>
        <section className="landing-hero">
          <div className="landing-stage" aria-hidden="true">
            <MathArt name="pythagoras" className="landing-card landing-card-1" />
            <MathArt name="orange" className="landing-card landing-card-2" />
            <MathArt name="euler" className="landing-card landing-card-3" />
            <MathArt name="sheet" className="landing-card landing-card-4" />
          </div>
          <h1 className="landing-headline">teach the <span className="serif-em">why</span><Qed /></h1>
          <p className="landing-lede">{BRAND_TAGLINE}</p>
          <div className="landing-cta">
            <Link to="/signup" className="btn btn-primary">Start a trial</Link>
            <Link to="/try" className="btn btn-secondary">Try a free board</Link>
          </div>
        </section>

        <section className="landing-about">
          <p>
            {BRAND_NAME} is for independent math and SAT tutors. Plan a lesson from a PDF or your own notes,
            teach it on a live whiteboard where students answer on the board, set homework that marks itself,
            and send parents a short update when the lesson ends. Students and parents never make an account:
            they get a private link. It’s new, and it’s built by a tutor who teaches with it. Tell us what’s
            missing.
          </p>
        </section>

        <section className="landing-shots" aria-label="Screenshots">
          {SHOTS.map((s) => (
            <figure key={s.caption}>
              <img src={s.src} alt={s.alt} loading="lazy" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </section>

        <section className="landing-end">
          <Link to="/signup" className="btn btn-primary">Start a trial</Link>
          {FEEDBACK_EMAIL && (
            <p>Questions? Write to <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>.</p>
          )}
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </footer>
    </div>
  )
}
