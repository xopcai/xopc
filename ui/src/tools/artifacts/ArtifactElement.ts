import { LitElement, type TemplateResult } from 'lit';

/**
 * Abstract base class for artifact elements
 * Artifacts are AI-generated files that can be previewed and downloaded
 */
export abstract class ArtifactElement extends LitElement {
  public filename = '';

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  public abstract get content(): string;
  public abstract set content(value: string);

  abstract getHeaderButtons(): TemplateResult | HTMLElement;
}
