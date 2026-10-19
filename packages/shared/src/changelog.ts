// What's new in Acadex — shown inside the app (Help → What's new), newest first.
export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '6.2',
    date: '2026-10-19',
    title: 'Notifications that cost nothing',
    items: [
      'Notifications, fee reminders and emergency alerts go in the app, by email and by push',
      'Text messages (SMS) are no longer sent; WhatsApp appears only where it is switched on',
    ],
  },
  {
    version: '6.1',
    date: '2026-10-18',
    title: 'Your country, your currency',
    items: [
      'Choose your country in Settings: currency, time zone, date format and week start follow',
      'Online payments for your country: JazzCash and Easypaisa in Pakistan, Stripe elsewhere',
      'Send feedback from the menu on phones',
    ],
  },
  {
    version: '6.0',
    date: '2026-10-17',
    title: 'Platform, modules and connections',
    items: [
      'Library, HR & payroll, Transport, Hostel, Inventory and Visitors modules (Settings → Modules)',
      'Reports with Excel / PDF and scheduled emails',
      'Billing inside Acadex: your plan, usage and invoices',
      'A REST API, webhooks, LTI 1.3 tools, OneRoster export, Google and Microsoft sign-in',
      'Privacy center: consents and requests for a copy of your data',
      'Room and resource bookings; Google Drive and OneDrive files in courses',
    ],
  },
  {
    version: '5.0',
    date: '2026-10-17',
    title: 'Reach every family',
    items: [
      'Messages with safeguarding for students under 18',
      'Parent–teacher meeting booking and a help desk',
      'Digests and emergency broadcasts',
      'Install Acadex on your phone, use it offline, and switch on low-bandwidth mode',
    ],
  },
  {
    version: '4.0',
    date: '2026-10-16',
    title: 'AI that helps people learn',
    items: ['A tutor that coaches instead of answering', 'A copilot for teachers (approve before apply)', 'Early warning for students who need help', 'Ask Acadex about your own data'],
  },
  {
    version: '3.0',
    date: '2026-10-16',
    title: 'Exams, fees and admissions',
    items: ['Secure online exams and paper exam workflows', 'Fees with online payment and reminders', 'Learning outcomes (OBE)', 'Online admission forms'],
  },
];

export const LATEST_VERSION = CHANGELOG[0]!.version;
