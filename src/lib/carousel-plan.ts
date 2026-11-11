import { z } from 'zod';
import { MAX_CONTENT_REFERENCES } from './content-reference-options';
import type { ContentReferenceRoles } from './content-reference-roles';

export const CAROUSEL_SLIDE_COUNT = 5;
export const carouselSlideLimits = { headline: 64, body: 125, visualDirection: 350 } as const;
const slideCopy = z.object({
  headline: z.string().trim().min(1).max(carouselSlideLimits.headline),
  body: z.string().trim().min(1).max(carouselSlideLimits.body),
  visualDirection: z.string().trim().min(1).max(carouselSlideLimits.visualDirection),
});
const proposalSlide = slideCopy.extend({
  refNumbers: z.array(z.number().int().min(1).max(MAX_CONTENT_REFERENCES)).max(MAX_CONTENT_REFERENCES),
}).strict();
const planSlide = slideCopy.extend({
  assetIds: z.array(z.string().uuid()).max(MAX_CONTENT_REFERENCES),
}).strict();
export const carouselPlanSchema = z.array(planSlide).length(CAROUSEL_SLIDE_COUNT);
export type CarouselPlan = z.infer<typeof carouselPlanSchema>;

export const carouselPlanOutputSchema = z.object({
  topic: z.string().trim().min(1).max(180),
  visualDirection: z.string().trim().min(1).max(500),
  slides: z.array(proposalSlide).length(CAROUSEL_SLIDE_COUNT),
}).strict();

export const carouselPlanProposalSchema = z.object({
  workspaceId: z.string(),
  businessId: z.string(),
  baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  topic: z.string().trim().min(1).max(180),
  visualDirection: z.string().trim().min(1).max(500),
  slides: carouselPlanSchema,
}).strict();

export type CarouselPlanProposal = z.infer<typeof carouselPlanProposalSchema>;

export function validateCarouselPlan(slides: CarouselPlan, assetIds: string[], roles: ContentReferenceRoles) {
  for (const [index, slide] of slides.entries()) {
    if (slide.headline.split(/\s+/).length > 8 || slide.body.split(/\s+/).length > 18) {
      throw new Error(`Ringkas judul atau isi slide ${index + 1}. Gunakan maksimal 8 kata untuk judul dan 18 kata untuk isi.`);
    }
    if (new Set(slide.assetIds).size !== slide.assetIds.length || slide.assetIds.some(id => !assetIds.includes(id) || roles[id] !== 'visual')) {
      throw new Error(`Periksa pilihan acuan visual pada slide ${index + 1}.`);
    }
  }
}

export function resolveCarouselPlanOutput(raw: unknown, assetIds: string[], roles: ContentReferenceRoles) {
  const result = carouselPlanOutputSchema.parse(raw);
  const slides = result.slides.map(({ refNumbers, ...slide }) => ({
    ...slide,
    assetIds: refNumbers.map(number => assetIds[number - 1]),
  }));
  validateCarouselPlan(slides, assetIds, roles);
  if (assetIds.some(id => roles[id] === 'visual' && !slides.some(slide => slide.assetIds.includes(id)))) {
    throw new Error('Rencana belum menempatkan seluruh acuan visual.');
  }
  return { ...result, slides };
}
