// Acadex's own help articles: the help center shows them and the help assistant answers from
// them. Short, task-shaped, in plain words.
export interface HelpArticle {
  slug: string;
  title: string;
  roles: ('admin' | 'teacher' | 'student' | 'parent')[];
  body: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'add-students',
    title: 'Add students (one by one or in bulk)',
    roles: ['admin'],
    body: `Open Students and click Add student. Enter the name, email and class; add guardians on the same form. The student and guardians get an email invitation to set their own password.

To add many at once, open Imports, download the template (CSV or Excel), fill one row per student and upload it. Run the dry run first: it shows every row that would fail and why. Then import.`,
  },
  {
    slug: 'take-attendance',
    title: 'Take attendance',
    roles: ['teacher'],
    body: `Open Attendance. Pick the class (and the period, for class-by-class registers). Everyone starts as present: tap only the students who are absent or late, then Save. On a phone with no signal the register is saved on the device and sent when you are back online.

To let students check in themselves, open the register and show the QR code; it changes every few seconds so it can't be shared.`,
  },
  {
    slug: 'post-assignment',
    title: 'Post an assignment',
    roles: ['teacher'],
    body: `Open the course, then New work. Give it a title, instructions, points and a due date. Choose how students hand in (text, files, a link, audio or video), whether late work is allowed, and the AI-help policy (allowed, guided hints only, or not allowed). Publish it: students are notified. Add a rubric to grade faster.`,
  },
  {
    slug: 'grade-work',
    title: 'Grade work and release grades',
    roles: ['teacher'],
    body: `Open the assignment and click Grade. Go through submissions one by one: score with the rubric or points, write feedback, attach a marked-up file or record audio. Grades stay drafts until you click Release; then students and guardians see them. The grading assistant can suggest rubric scores and feedback; you accept or change each one, and nothing is released without your click.`,
  },
  {
    slug: 'make-quiz',
    title: 'Make a quiz (and let the copilot draft questions)',
    roles: ['teacher'],
    body: `Create work of kind Quiz, then Questions. Add questions to a question bank (12 types) or pick random questions from a bank. Set a time limit, attempts and when students see answers.

To draft questions with AI, open Copilot, choose Quiz questions, pick the course pages to use and how many questions. Review the proposal, edit any question, then Apply: they are added to your question bank tagged with difficulty and outcome.`,
  },
  {
    slug: 'secure-exam',
    title: 'Run a secure online exam',
    roles: ['teacher', 'admin'],
    body: `Open the quiz's Questions page and expand Secure exam mode. Set an access code (give it out in the room), limit it to the campus network if you like, and turn on full screen, no going back and automatic hand-in after leaving the exam a number of times. Every time a student leaves the exam or pastes is logged for you to review.`,
  },
  {
    slug: 'collect-fees',
    title: 'Collect fees',
    roles: ['admin'],
    body: `Set up a fee structure once (Finance → Fee structures): fee heads, instalments and a late fine. Click Generate invoices: you see every invoice before it is created. Families pay online from their Fees page or the pay link in reminders, or at the counter: open the invoice and click Record payment to print a receipt. Defaulters lists everyone overdue; tick them and click Remind to send SMS, WhatsApp or email.`,
  },
  {
    slug: 'online-payments',
    title: 'Accept online payments',
    roles: ['admin'],
    body: `Open Finance → Settings → Payment methods. Connect your own Stripe, JazzCash or Easypaisa merchant account (start with the sandbox keys), and enter the bank account printed on vouchers. Copy the webhook address shown next to each provider into the provider's dashboard. Run Reconciliation regularly to match payments with what the provider settled.`,
  },
  {
    slug: 'exams-results',
    title: 'Hold exams and publish results',
    roles: ['admin', 'teacher'],
    body: `In the Exams office create a series and lay out the date sheet. Seat candidates by room, assign invigilators and issue admit cards (students with low attendance or overdue fees are held back unless you allow them). Teachers enter marks under Exam marks and submit; the head of department and the exam controller approve. Publish results: they go into the gradebook and students and families can download result cards.`,
  },
  {
    slug: 'outcomes',
    title: 'Learning outcomes (OBE)',
    roles: ['admin', 'teacher'],
    body: `Teachers add course outcomes (CLOs) under Learning outcomes and tick which work measures each one. The academic office adds program outcomes (PLOs) and maps CLOs to them. Attainment is calculated from the gradebook; download the accreditation report as Excel or PDF.`,
  },
  {
    slug: 'admissions',
    title: 'Take admissions online',
    roles: ['admin'],
    body: `In Admissions → Forms create a form: your questions, the documents to upload, the application fee and an optional online entrance test. Share the public link. Applicants follow their application from a private link. Review applications, schedule tests, then make a merit list to send offers and a waiting list. When an applicant accepts, click Enrol: the student and guardian accounts are created.`,
  },
  {
    slug: 'tutor',
    title: 'Use the AI tutor (students)',
    roles: ['student'],
    body: `Open a course and click Ask the tutor. It answers from your course material and shows where each idea comes from. It coaches you: it gives hints and asks questions rather than doing your homework, and for graded work your teacher may allow only hints or no AI help at all. Your conversations are kept so you can come back to them.`,
  },
  {
    slug: 'parent-portal',
    title: 'For parents: see your child’s progress and pay fees',
    roles: ['parent'],
    body: `Sign in from the invitation email. Your home page shows each child's attendance, work that is due and recent grades. Fees shows invoices: pay online or download the voucher to pay at the bank. Exams shows the date sheet, admit cards and results.`,
  },
  {
    slug: 'ai-settings',
    title: 'AI settings, budget and privacy',
    roles: ['admin'],
    body: `Open Settings → AI. Turn AI on or off for the whole institution or per feature; teachers can turn it off per course and set each assignment's AI policy. See which provider and model each feature uses, what it costs this month and the monthly budget. You can use your institution's own provider key. Before anything is sent to a model, names, emails, phone numbers and ID numbers are removed. Every AI output is labelled AI-generated, and nothing changes in Acadex until a person approves it.`,
  },
  {
    slug: 'early-warning',
    title: 'Early warning: students who need help',
    roles: ['admin', 'teacher'],
    body: `Every night Acadex scores each student's risk from attendance, grade trends, missed or late work and inactivity (and fees, if you turn that on). Open Student success to see who is at risk and why — every factor is shown. Record an intervention (a meeting, a call home, tutoring) and follow it up; you can alert the guardian.`,
  },
  {
    slug: 'ask-acadex',
    title: 'Ask Acadex questions about your data',
    roles: ['admin'],
    body: `Open Ask Acadex and type a question such as "How many students have overdue fees?" or "Average grade by course". Acadex writes a read-only query over your institution's data, shows the query and the answer, and lets you download the result. Teachers only see their own classes.`,
  },
  {
    slug: 'reset-password',
    title: 'Forgot your password',
    roles: ['admin', 'teacher', 'student', 'parent'],
    body: `On the sign-in page click Forgot password and enter your email. Open the link in the email within an hour and choose a new password. If two-step sign-in is on, have your authenticator app or a recovery code ready.`,
  },
];
