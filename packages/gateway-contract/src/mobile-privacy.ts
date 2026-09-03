import { z } from 'zod';

export const MobilePrivacyRecipientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capability: z.enum(['model', 'transcription', 'speech', 'image', 'search']),
  origin: z.string().optional(),
});

export const MobilePrivacyDisclosureSchema = z.object({
  version: z.literal(1),
  revision: z.string().min(1),
  recipients: z.array(MobilePrivacyRecipientSchema),
});

export type MobilePrivacyRecipient = z.infer<typeof MobilePrivacyRecipientSchema>;
export type MobilePrivacyDisclosure = z.infer<typeof MobilePrivacyDisclosureSchema>;
