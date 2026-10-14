// The institution's own words for its structure: a school says "Class" and "Teacher", a
// university "Batch" and "Instructor", a training center "Cohort" and "Trainer".
import { useQuery } from '@tanstack/react-query';
import { resolveTerminology, type InstitutionType, type TermKey, type Terminology } from '@acadex/shared';
import { api } from './api';
import { useAuth } from './auth';

interface TerminologyResponse {
  type: InstitutionType;
  terminology: Terminology;
}

const FALLBACK = resolveTerminology('school');

export function useTerms() {
  const { institution } = useAuth();
  const q = useQuery({
    queryKey: ['terminology', institution?.id],
    queryFn: () => api.get<TerminologyResponse>('/institution/terminology'),
    enabled: !!institution,
    staleTime: 10 * 60 * 1000,
  });
  const words = q.data?.terminology ?? FALLBACK;
  /** term('section') → "Class"; term('section', true) → "Classes"; lower-case with { lower: true } */
  const term = (key: TermKey, plural = false, opts: { lower?: boolean } = {}) => {
    const w = plural ? words[key].other : words[key].one;
    return opts.lower ? w.toLowerCase() : w;
  };
  return { term, type: q.data?.type ?? 'school', words, loaded: !!q.data };
}
