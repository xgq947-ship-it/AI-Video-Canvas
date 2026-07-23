export interface ProductDimensions {
  length: number;
  width: number;
  height: number;
  unit: 'mm' | 'cm';
}
export const PRODUCT_SCENE_ASPECT_RATIOS: ReadonlyArray<string>;
export function inferProductSceneAspectRatio(value?: string, fallback?: string): string;

export function validateProductDimensions(dimensions?: Partial<ProductDimensions>): string;
export function buildSceneAnalysisInstruction(): string;
export function buildPersonaAnalysisInstruction(): string;
export function buildCompositionAnalysisInstruction(): string;
export function buildProductAnalysisInstruction(options?: { preserveProductMarkings?: boolean; productCategory?: string }): string;
export function buildProductScenePrompt(options: {
  sceneAnalysis: string;
  personaAnalysis: string;
  compositionAnalysis: string;
  productAnalysis: string;
  personaBrief?: string;
  dimensions: ProductDimensions;
  preserveProductMarkings?: boolean;
  productCategory?: string;
}): string;
