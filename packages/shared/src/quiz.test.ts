import { describe, it, expect } from 'vitest';
import { autoScore, evalFormula, formulaValues, parseQuestionData, studentView } from './quiz';
import { attendancePercent } from './academics';
import { inQuietHours } from './notifications';

describe('question scoring', () => {
  it('scores every objective type', () => {
    expect(autoScore('mcq', { correct: 'a' }, 'a')).toBe(1);
    expect(autoScore('mcq', { correct: 'a' }, 'b')).toBe(0);
    expect(autoScore('true_false', { correct: false }, false)).toBe(1);
    const multi = { options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], correct: ['a', 'b'], partial_credit: true };
    expect(autoScore('multi', multi, ['a', 'b'])).toBe(1);
    expect(autoScore('multi', multi, ['a'])).toBe(0.5);
    expect(autoScore('multi', multi, ['a', 'c'])).toBe(0);
    expect(autoScore('multi', { ...multi, partial_credit: false }, ['a'])).toBe(0);
    expect(autoScore('short', { accepted: ['Islamabad'], case_sensitive: false }, '  islamabad ')).toBe(1);
    expect(autoScore('numeric', { answer: 3.14, tolerance: 0.01 }, '3.141')).toBe(1);
    expect(autoScore('numeric', { answer: 3.14, tolerance: 0.01 }, 3.2)).toBe(0);
    expect(autoScore('matching', { pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }] }, { 0: '1', 1: '3' })).toBe(0.5);
    expect(autoScore('ordering', { items: ['x', 'y', 'z'] }, ['x', 'y', 'z'])).toBe(1);
    expect(autoScore('fill_blank', { blanks: [{ accepted: ['cat'] }, { accepted: ['mat'] }] }, ['Cat', 'hat'])).toBe(0.5);
    expect(autoScore('essay', {}, 'text')).toBeNull();
    expect(autoScore('mcq', { correct: 'a' }, undefined)).toBe(0);
  });

  it('formula questions use the student’s own values', () => {
    const data = { expression: 'a * b + 2', variables: [{ name: 'a', min: 1, max: 9, decimals: 0 }, { name: 'b', min: 1, max: 9, decimals: 0 }], tolerance: 0.01 };
    const vars = formulaValues(data, () => 0.5);
    expect(vars).toEqual({ a: 5, b: 5 });
    expect(autoScore('formula', data, 27, vars)).toBe(1);
    expect(autoScore('formula', data, 26, vars)).toBe(0);
    expect(evalFormula('sqrt(16) + 2^3', {})).toBe(12);
    expect(() => evalFormula('process.exit()', {})).toThrow();
  });

  it('validates question data', () => {
    expect(parseQuestionData('mcq', { options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], correct: 'c' }).ok).toBe(false);
    expect(parseQuestionData('formula', { expression: 'a +', variables: [{ name: 'a', min: 1, max: 2 }] }).ok).toBe(false);
    expect(parseQuestionData('numeric', { answer: 4 }).ok).toBe(true);
  });

  it('the student view hides answers', () => {
    const v = studentView('mcq', { options: [{ id: 'a', text: 'x' }], correct: 'a' }, (x) => x);
    expect(v).toEqual({ options: [{ id: 'a', text: 'x' }] });
    expect(JSON.stringify(studentView('matching', { pairs: [{ left: 'a', right: '1' }] }, (x) => x))).not.toContain('pairs');
  });
});

describe('attendance and quiet hours', () => {
  it('excused and leave are not counted; late is attended', () => {
    expect(attendancePercent({ present: 6, late: 1, absent: 3, excused: 5, leave: 2 })).toBe(70);
    expect(attendancePercent({})).toBeNull();
  });
  it('quiet hours may cross midnight', () => {
    expect(inQuietHours(23 * 60, { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours(5 * 60, { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours(7 * 60, { start: '22:00', end: '06:00' })).toBe(false);
    expect(inQuietHours(7 * 60, null)).toBe(false);
  });
});
