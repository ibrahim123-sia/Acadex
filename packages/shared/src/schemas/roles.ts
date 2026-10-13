import { z } from 'zod';
import { SCHOOL_ASSIGNABLE_PERMISSIONS, type Permission } from '../permissions';
import { id, requiredText, text } from './common';

const assignable = new Set<string>(SCHOOL_ASSIGNABLE_PERMISSIONS);

export const schoolPermission = z
  .string()
  .refine((p) => assignable.has(p), { message: 'Unknown permission, or one a school role cannot hold' })
  .transform((p) => p as Permission);

export const createRoleBody = z.object({
  name: requiredText(80),
  description: text(300).default(''),
  permissions: z
    .array(schoolPermission)
    .min(1, 'Choose at least one permission')
    .max(100)
    .transform((ps) => [...new Set(ps)]),
});

export const updateRoleBody = z.object({
  name: requiredText(80).optional(),
  description: text(300).optional(),
  permissions: createRoleBody.shape.permissions.optional(),
});

export const assignRoleBody = z.object({ role_id: id });
