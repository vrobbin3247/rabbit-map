/** Card colours, in the order of the six tones in the stylesheet. */
export const TONE_NAMES = ['Yellow', 'Blue', 'Green', 'Pink', 'Orange', 'Purple'] as const;

export const LIMITS = {
  topicMax: 200,
  titleMax: 80,
  summaryMax: 200,
  aliasesMax: 6,
  childrenMax: 10,
  questionMax: 2000,
  quoteMax: 600,
  snippetMax: 400,
  trailMax: 200,
  wikilinkLabelMax: 120,
} as const;
