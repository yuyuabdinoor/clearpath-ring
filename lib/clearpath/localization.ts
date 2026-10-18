import { z } from 'zod'

const normalizedCoordinate = z.number().finite().min(0).max(1)

export const localizationSchema = z.object({
  status: z.enum(['object', 'none', 'uncertain']),
  category: z.enum(['parcel', 'movable_object', 'unknown']),
  bounds: z.object({
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: normalizedCoordinate.positive(),
    height: normalizedCoordinate.positive(),
  }).nullable(),
  confidence: z.number().finite().min(0).max(1),
  occluded: z.boolean(),
  zoneClearVerified: z.boolean(),
  frameTimestamp: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.zoneClearVerified && (value.status === 'uncertain' || value.occluded)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['zoneClearVerified'], message: 'An uncertain or occluded zone cannot be verified clear.' })
  }
  if (value.status === 'none' && !value.zoneClearVerified) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['zoneClearVerified'], message: 'No-object classification requires a full-zone clear check.' })
  }
  if (value.status === 'object' && !value.bounds) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bounds'], message: 'An object requires bounds.' })
  }
  if (value.status !== 'object' && value.bounds) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bounds'], message: 'Only a detected object may have bounds.' })
  }
  if (value.bounds && value.bounds.x + value.bounds.width > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bounds', 'width'],
      message: 'Object bounds extend beyond the right edge of the frame.',
    })
  }

  if (value.bounds && value.bounds.y + value.bounds.height > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bounds', 'height'],
      message: 'Object bounds extend beyond the bottom edge of the frame.',
    })
  }
})

export type LocalizationResult = z.infer<typeof localizationSchema>

export type LocalizationValidation =
  | { valid: true; result: LocalizationResult }
  | { valid: false; errors: string[] }

export function validateLocalization(input: unknown): LocalizationValidation {
  const parsed = localizationSchema.safeParse(input)
  if (parsed.success) return { valid: true, result: parsed.data }

  return {
    valid: false,
    errors: parsed.error.issues.map((issue) => {
      const location = issue.path.length ? `${issue.path.join('.')}: ` : ''
      return `${location}${issue.message}`
    }),
  }
}
