// Starter course templates, open educational resource libraries, and the Google Classroom
// import behind a provider interface (the real one needs the institution's Google OAuth app;
// the fake one lets the flow be tried and tested without it).

export interface StarterTemplate {
  key: string;
  title: string;
  description: string;
  modules: { title: string; items: { kind: 'page' | 'link'; title: string; body_html?: string; url?: string }[] }[];
}

const week = (n: number) => ({
  title: `Week ${n}`,
  items: [
    { kind: 'page' as const, title: `Week ${n} overview`, body_html: '<p>What we cover this week, what to read, and what to hand in.</p>' },
    { kind: 'page' as const, title: `Week ${n} notes`, body_html: '<p>Notes for this week.</p>' },
  ],
});

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'weekly-12',
    title: 'Weekly course (12 weeks)',
    description: 'A start page and one module per week, each with an overview and notes. Good for college and university courses.',
    modules: [
      { title: 'Start here', items: [{ kind: 'page', title: 'Welcome and course outline', body_html: '<h2>Welcome</h2><p>How this course works, how you are graded, and how to reach your teacher.</p>' }] },
      ...Array.from({ length: 12 }, (_, i) => week(i + 1)),
    ],
  },
  {
    key: 'units-school',
    title: 'School subject in units',
    description: 'Six units, each with a lesson page, practice and a review. Good for school classes.',
    modules: Array.from({ length: 6 }, (_, i) => ({
      title: `Unit ${i + 1}`,
      items: [
        { kind: 'page' as const, title: `Unit ${i + 1}: lesson`, body_html: '<p>Learning goals and the lesson.</p>' },
        { kind: 'page' as const, title: `Unit ${i + 1}: practice`, body_html: '<p>Practice questions.</p>' },
        { kind: 'page' as const, title: `Unit ${i + 1}: review`, body_html: '<p>Key points to remember.</p>' },
      ],
    })),
  },
  {
    key: 'bootcamp',
    title: 'Skills bootcamp',
    description: 'Orientation, four skill sprints with a project each, and a capstone. Good for training centres.',
    modules: [
      { title: 'Orientation', items: [{ kind: 'page', title: 'How the bootcamp works', body_html: '<p>Schedule, tools and how projects are assessed.</p>' }] },
      ...['Foundations', 'Core skills', 'Applied practice', 'Professional skills'].map((t, i) => ({
        title: `Sprint ${i + 1}: ${t}`,
        items: [
          { kind: 'page' as const, title: `${t}: guide`, body_html: '<p>Guide and resources for this sprint.</p>' },
          { kind: 'page' as const, title: `${t}: project brief`, body_html: '<p>What to build and how it is reviewed.</p>' },
        ],
      })),
      { title: 'Capstone', items: [{ kind: 'page', title: 'Capstone project', body_html: '<p>The final project brief.</p>' }] },
    ],
  },
];

/** Free, openly licensed libraries teachers can link into a course. */
export const OER_LIBRARIES = [
  { name: 'OpenStax', url: 'https://openstax.org/subjects', subjects: ['math', 'science', 'business', 'social sciences'], levels: ['college', 'high school'], license: 'CC BY' },
  { name: 'Khan Academy', url: 'https://www.khanacademy.org/', subjects: ['math', 'science', 'computing', 'economics'], levels: ['school', 'college'], license: 'Free (non-commercial use)' },
  { name: 'CK-12', url: 'https://www.ck12.org/', subjects: ['math', 'science'], levels: ['school'], license: 'CC BY-NC' },
  { name: 'MIT OpenCourseWare', url: 'https://ocw.mit.edu/', subjects: ['engineering', 'science', 'math', 'humanities'], levels: ['university'], license: 'CC BY-NC-SA' },
  { name: 'PhET Interactive Simulations', url: 'https://phet.colorado.edu/', subjects: ['physics', 'chemistry', 'math', 'biology'], levels: ['school', 'college'], license: 'CC BY' },
  { name: 'Wikibooks', url: 'https://en.wikibooks.org/', subjects: ['all'], levels: ['all'], license: 'CC BY-SA' },
  { name: 'OER Commons', url: 'https://oercommons.org/', subjects: ['all'], levels: ['all'], license: 'Varies (open)' },
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/', subjects: ['literature', 'languages'], levels: ['all'], license: 'Public domain' },
];

export interface ClassroomWork {
  title: string;
  description: string;
  kind: 'assignment' | 'material' | 'question';
  due_at: string | null;
  points: number | null;
  links: { title: string; url: string }[];
  topic: string | null;
}

export interface ClassroomProvider {
  readonly name: string;
  courseWork(courseRef: string): Promise<{ courseName: string; items: ClassroomWork[] }>;
}

/** The fake provider: a small sample course (tests, demos). */
export const fakeClassroom: ClassroomProvider = {
  name: 'fake',
  async courseWork(courseRef) {
    return {
      courseName: `Classroom course ${courseRef}`,
      items: [
        { title: 'Welcome', description: 'Read the class rules.', kind: 'material', due_at: null, points: null, links: [{ title: 'Class rules', url: 'https://example.org/rules' }], topic: 'Getting started' },
        { title: 'Essay: my summer', description: 'Write 300 words.', kind: 'assignment', due_at: null, points: 20, links: [], topic: 'Writing' },
        { title: 'Reading: chapter 1', description: '', kind: 'material', due_at: null, points: null, links: [{ title: 'Chapter 1', url: 'https://example.org/ch1' }], topic: 'Writing' },
      ],
    };
  },
};

/** Without Google credentials configured the import explains what is needed. */
export function classroomProvider(): ClassroomProvider | null {
  const driver = process.env.CLASSROOM_DRIVER ?? (process.env.NODE_ENV === 'test' ? 'fake' : 'none');
  return driver === 'fake' ? fakeClassroom : null;
}
