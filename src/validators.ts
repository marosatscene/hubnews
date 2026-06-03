const { z } = require("zod");

const optionalUrl = z
  .string()
  .url()
  .optional()
  .nullable()
  .transform((value) => value || null);

const sourceCreateSchema = z.object({
  name: z.string().min(1),
  homepageUrl: z.string().url(),
  feedUrl: optionalUrl,
  language: z.string().min(2).max(10).optional().nullable(),
  country: z.string().min(2).max(10).optional().nullable(),
  enabled: z.boolean().optional(),
  checkIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  scrapeConfig: z.record(z.any()).optional()
});

const sourceUpdateSchema = sourceCreateSchema.partial();

const topicCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable()
});

const topicUpdateSchema = topicCreateSchema.partial();

const evaluationSchema = z.object({
  articleId: z.number().int().positive(),
  status: z.enum(["pending", "matched", "rejected"]),
  confidence: z.number().min(0).max(1).optional().nullable(),
  reason: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  raw: z.record(z.any()).optional()
});

function validate(schema: any, value: any) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error: any = new Error("Validation failed");
  error.status = 400;
  error.details = result.error.issues;
  throw error;
}

module.exports = {
  sourceCreateSchema,
  sourceUpdateSchema,
  topicCreateSchema,
  topicUpdateSchema,
  evaluationSchema,
  validate
};
