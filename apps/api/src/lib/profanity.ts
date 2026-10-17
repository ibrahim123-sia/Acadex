// A small profanity filter for messages and tickets (English, Roman Urdu, Urdu and Arabic):
// matched words are masked and the message is flagged for safeguarding review. Words that are
// also ordinary words (e.g. "dog" in Urdu and Arabic) are left out on purpose.

const LATIN = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'dickhead', 'cunt', 'slut', 'whore', 'wanker', 'twat',
  'nigger', 'nigga', 'faggot', 'retard',
  // Roman Urdu / Hindi
  'chutiya', 'chutia', 'chootiya', 'harami', 'haramzada', 'haramzadi', 'haraamzada', 'kamina', 'kameena', 'kamini', 'gandu', 'gaandu',
  'bhenchod', 'behenchod', 'bhanchod', 'madarchod', 'maderchod', 'bhosdi', 'bhosdike', 'lun', 'lund', 'randi', 'kanjar', 'kanjari', 'dalla',
];
const SCRIPT = [
  // Urdu
  'حرامی', 'حرامزادہ', 'حرام زادہ', 'کمینہ', 'کمینی', 'چوتیا', 'گانڈو', 'بہن چود', 'مادر چود', 'رنڈی', 'کنجر', 'دلا',
  // Arabic
  'شرموطة', 'شرموطه', 'عاهرة', 'منيوك', 'خول', 'كس امك', 'ابن الكلب', 'ابن الحرام', 'زبي',
];

const latin = new RegExp(`\\b(${LATIN.join('|')})\\b`, 'gi');
// Urdu and Arabic words: delimited by start/end, whitespace or punctuation
const script = new RegExp(`(^|[\\s،؟.!,?])(${SCRIPT.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})(?=$|[\\s،؟.!,?])`, 'g');

const mask = (w: string) => w[0] + '*'.repeat(Math.max(2, [...w].length - 1));

export function filterProfanity(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  const out = text
    .replace(latin, (w) => {
      flagged = true;
      return mask(w);
    })
    .replace(script, (_m, pre: string, w: string) => {
      flagged = true;
      return pre + mask(w);
    });
  return { text: out, flagged };
}
