// Shared data hooks for the structure screens.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Campus {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  is_main: boolean;
  sections: number;
  students: number;
}
export interface Department {
  id: number;
  name: string;
  code: string;
  campus_id: number | null;
  head_teacher_id: number | null;
  head_name: string | null;
}
export interface Level {
  id: number;
  program_id: number;
  name: string;
  sequence: number;
  sections: number;
}
export interface Program {
  id: number;
  name: string;
  code: string;
  department_id: number | null;
  description: string;
  grading_scheme_id: number | null;
  credits_required: string | null;
  levels: Level[];
}
export interface Term {
  id: number;
  academic_year_id: number;
  name: string;
  kind: string;
  sequence: number;
  starts_on: string;
  ends_on: string | null;
  status: 'planned' | 'active' | 'archived';
}
export interface AcademicYear {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  status: 'planned' | 'active' | 'archived';
  is_current: boolean;
  terms: Term[];
}
export interface Structure {
  campuses: Campus[];
  departments: Department[];
  programs: Program[];
  academic_years: AcademicYear[];
  grading_schemes: { id: number; name: string; kind: string; is_default: boolean }[];
}

export const useStructure = () => useQuery({ queryKey: ['structure'], queryFn: () => api.get<Structure>('/institution/structure'), staleTime: 60_000 });

/** Everything that shows structure (lists, dropdowns) refreshes after a change. */
export function useRefreshStructure() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['structure'] });
    void qc.invalidateQueries({ queryKey: ['/institution/sections'] });
  };
}

export interface StaffOption {
  id: number;
  first_name: string;
  last_name: string;
}
export const useStaffOptions = (enabled = true) =>
  useQuery({
    queryKey: ['staff-options'],
    queryFn: () => api.get<StaffOption[]>('/institution/teachers', { pageSize: 100, staff_type: 'teaching' }),
    enabled,
    staleTime: 60_000,
  });

export interface SectionOption {
  id: number;
  code: string;
  name: string;
  label: string | null;
  campus_id: number | null;
  campus_name: string | null;
  academic_year: string | null;
  status: string;
}
export const sectionName = (s: { name: string; label?: string | null }) => (s.label ? `${s.name} ${s.label}` : s.name);
export const useSectionOptions = (filters: Record<string, string | number | undefined> = {}, enabled = true) =>
  useQuery({
    queryKey: ['/institution/sections', 'options', filters],
    queryFn: () => api.get<SectionOption[]>('/institution/sections', { pageSize: 100, ...filters }),
    enabled,
    staleTime: 30_000,
  });
