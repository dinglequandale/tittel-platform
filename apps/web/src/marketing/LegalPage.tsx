import { Link } from 'react-router-dom'
import { Wordmark } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'

// Privacy Policy and Terms (OVERHAUL §5, child data). DRAFTS: the bracketed
// parts and the whole text need the owner's review (and ideally a lawyer's)
// before the first paying tutor. Kept as plain text in code until the final
// name and entity exist, so the brand swap in brand.ts reaches it too.

const UPDATED = '[date]'
const CONTACT = '[contact email]'
const ENTITY = '[legal name of the business]'

const privacy = [
  ['Who we are', `${BRAND_NAME} is a tool for private tutors, run by ${ENTITY}. Tutors use it to plan lessons, teach on a shared whiteboard, give homework and keep in touch with families. Questions about this policy: ${CONTACT}.`],
  ['Who is responsible for student information', `Tutors add their own students and decide what to record about them. For that information, the tutor decides why it's used and we process it on the tutor's behalf, only to run the service for them. Tutors confirm, before adding students, that they have a parent's or guardian's permission for any student under 13.`],
  ['What we collect', `From tutors: name, email address, sign-in details, and the settings they choose. From what tutors add or do in the app: students' names, any parent or student email addresses the tutor saves, notes, lessons and their times, plans, homework, and the answers, photos of work, whiteboard drawings and lesson notes that students and tutors produce. If a tutor connects a calendar, the event details we read to find their lessons (titles, times, guest addresses, meeting links). Students do not create accounts: they use a private link their tutor shares. We record basic technical information (such as IP address and browser) to keep the service secure and working.`],
  ['What we do with it', `We use it to provide the service: showing lessons and homework, grading answers, saving boards, and drafting messages the tutor chooses to send. We don't sell personal information, show ads, or use students' information to build advertising profiles. We don't use it to train AI models.`],
  ['AI features', `Some features use Claude, by Anthropic, when the tutor presses a button for them: reading a worksheet into questions, writing more practice problems, or writing up a parent update. Only the material needed for that request is sent. Tutors can turn these features off in Settings, which hides them everywhere.`],
  ['Who else handles it', `We use service providers to run ${BRAND_NAME}: Supabase (database and sign-in), Render (hosting), Anthropic (AI features, only when used), Google (only to read a calendar the tutor connects) and [error monitoring provider, if enabled]. They may only use the information to provide their service to us. [Where data is stored: region.]`],
  ['Children', `${BRAND_NAME} is used by tutors, some of whose students are under 13. We rely on the tutor to obtain a parent's or guardian's permission and collect only what's needed: a first name and last initial is enough, and a student's own email address is only for students 13 and over. A parent can ask us or the tutor to see or delete their child's information at ${CONTACT}.`],
  ['How long we keep it', `For as long as the tutor's account is open, or until the tutor deletes it. [When an account is closed, we delete its information within N days, except where we must keep it longer by law.]`],
  ['Your choices and rights', `Tutors can edit or delete their students and data in the app. Anyone can ask to access, correct or delete their information, or the information of a child in their care, by writing to ${CONTACT}. [Add any rights that apply where you operate, for example GDPR or state privacy laws.]`],
  ['Security', `Information is sent over encrypted connections, kept in access-controlled systems, and each tutor's data is kept separate from every other tutor's. Student links are long, random and private; anyone with a link can open it, so tutors should share links only with the student or their family.`],
  ['Changes', `If we change this policy in a way that matters, we'll tell tutors by email or in the app before it takes effect.`],
] as const

const terms = [
  ['The service', `${ENTITY} provides ${BRAND_NAME} to tutors. By creating an account you agree to these terms. If you use it for a business, you agree on its behalf.`],
  ['Your account', `Keep your sign-in details safe; you're responsible for what happens in your account. You must be 18 or older to create an account.`],
  ['Your students and content', `You own the content you and your students add. You give us permission to store and process it only to run the service for you. You're responsible for having the right to add it, including a parent's or guardian's permission for students under 13, and for keeping it to what's needed.`],
  ['Acceptable use', `Don't use ${BRAND_NAME} to break the law, harm others, upload content you don't have the right to share, or try to get into other people's accounts or data.`],
  ['Trial and payment', `New accounts start with a free trial. [Pricing, billing, renewal and refund terms.] Student links keep working even if a subscription lapses.`],
  ['AI-generated content', `Drafts written with Claude (questions, practice problems, messages) can contain mistakes. Check them before you give or send them; you're responsible for what you share with students and families.`],
  ['Availability and changes', `We work to keep ${BRAND_NAME} available and your data safe, but the service is provided as is, without guarantees of uninterrupted availability. We may change features; we'll give notice of changes that significantly affect you.`],
  ['Ending', `You can close your account at any time. We may suspend accounts that break these terms. [What happens to data after closing: see the Privacy Policy.]`],
  ['Liability', `[Limitation of liability, governing law and jurisdiction: to be completed with legal advice.]`],
  ['Contact', `${CONTACT}`],
] as const

export function LegalPage({ doc }: { doc: 'privacy' | 'terms' }) {
  const sections = doc === 'privacy' ? privacy : terms
  return (
    <main className="page legal">
      <Link to="/" className="auth-brand"><Wordmark name={BRAND_NAME} /></Link>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>{doc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}</h1>
      <p className="muted">Last updated {UPDATED}. Draft: being finalised before launch.</p>
      {sections.map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
      <p className="muted">
        {doc === 'privacy' ? <Link to="/terms">Terms of Service</Link> : <Link to="/privacy">Privacy Policy</Link>}
      </p>
    </main>
  )
}
