import { describe, expect, it } from 'vitest';
import {
  GRADING_PRESETS,
  INSTITUTION_DEFAULTS,
  academicYearFor,
  gpa,
  gradeFor,
  gradingSchemeBody,
  resolveTerminology,
} from './academics';

describe('grading', () => {
  it('matches bands from the top, at exact boundaries', () => {
    const s = GRADING_PRESETS.school_letter;
    expect(gradeFor(s, 90).label).toBe('A+');
    expect(gradeFor(s, 89.99).label).toBe('A');
    expect(gradeFor(s, 40)).toMatchObject({ label: 'E', passed: true });
    expect(gradeFor(s, 39.5)).toMatchObject({ label: 'F', passed: false });
    expect(gradeFor(s, 120).percent).toBe(100);
    expect(gradeFor(s, -5).label).toBe('F');
  });

  it('computes a credit-weighted GPA on the 4.0 scale', () => {
    const s = GRADING_PRESETS.gpa_4;
    // A (4.0) in a 3-credit course, C (2.0) in a 1-credit course → (12 + 2) / 4 = 3.5
    expect(gpa(s, [{ percent: 90, credits: 3 }, { percent: 62, credits: 1 }])).toBe(3.5);
    expect(gpa(s, [])).toBeNull();
    expect(gpa(GRADING_PRESETS.school_letter, [{ percent: 90 }])).toBeNull(); // not a GPA scheme
  });

  it('validates custom schemes', () => {
    const ok = gradingSchemeBody.safeParse({ name: 'Mine', kind: 'letter', bands: [{ min: 50, label: 'P', passed: true }, { min: 0, label: 'F', passed: false }] });
    expect(ok.success).toBe(true);
    const noZero = gradingSchemeBody.safeParse({ name: 'X', kind: 'letter', bands: [{ min: 50, label: 'P', passed: true }] });
    expect(noZero.success).toBe(false);
    const gpaNoPoints = gradingSchemeBody.safeParse({ name: 'G', kind: 'gpa', gpa_scale: 4, bands: [{ min: 0, label: 'F', passed: false }] });
    expect(gpaNoPoints.success).toBe(false);
    const dup = gradingSchemeBody.safeParse({ name: 'D', kind: 'letter', bands: [{ min: 0, label: 'A', passed: true }, { min: 0, label: 'B', passed: true }] });
    expect(dup.success).toBe(false);
  });
});

describe('terminology', () => {
  it('speaks each institution type’s language', () => {
    expect(resolveTerminology('school').section).toEqual({ one: 'Class', other: 'Classes' });
    expect(resolveTerminology('university').teacher.one).toBe('Instructor');
    expect(resolveTerminology('training_center').student.one).toBe('Trainee');
    expect(resolveTerminology('chain').campus.other).toBe('Branches');
  });

  it('applies the institution’s overrides', () => {
    const t = resolveTerminology('school', { teacher: { one: 'Ustad', other: 'Asatiza' }, course: { one: 'Paper' } });
    expect(t.teacher).toEqual({ one: 'Ustad', other: 'Asatiza' });
    expect(t.course).toEqual({ one: 'Paper', other: 'Papers' });
    expect(t.student.one).toBe('Student');
  });
});

describe('academic year layout', () => {
  it('puts August–July schools in the right year on either side of the turn', () => {
    const d = INSTITUTION_DEFAULTS.school;
    expect(academicYearFor(d, '2026-10-13')).toMatchObject({ name: '2026–27', startsOn: '2026-08-01', endsOn: '2027-07-31' });
    expect(academicYearFor(d, '2027-03-01')).toMatchObject({ name: '2026–27' });
    expect(academicYearFor(d, '2027-08-01')).toMatchObject({ name: '2027–28' });
  });

  it('lays out semesters across the calendar year', () => {
    const y = academicYearFor(INSTITUTION_DEFAULTS.university, '2026-10-13');
    expect(y.terms).toEqual([
      { name: 'Fall 2026', sequence: 1, startsOn: '2026-09-01', endsOn: '2027-01-15' },
      { name: 'Spring 2027', sequence: 2, startsOn: '2027-02-01', endsOn: '2027-06-15' },
    ]);
  });

  it('handles calendar-year institutions and rolling intakes', () => {
    const y = academicYearFor(INSTITUTION_DEFAULTS.training_center, '2026-10-13');
    expect(y).toMatchObject({ name: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' });
    expect(y.terms[0]).toMatchObject({ endsOn: null });
  });
});
