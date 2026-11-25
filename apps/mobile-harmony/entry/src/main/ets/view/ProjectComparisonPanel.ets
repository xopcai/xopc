import { CatalogFactory, SurfaceController, SurfaceControllerFactory, SurfaceErrorCode,
  UIRendererComponent } from '@arkui-genius/genui';
import { XopcProjectComparison } from '../model/chat';
import { gatewaySession } from '../service/gatewaySession';

interface ComparisonAction { name: string; surfaceId: string; }
interface ComparisonActionEnvelope { version: string; action: ComparisonAction; }
interface DataUpdate { surfaceId: string; path: string; }
interface DataPatch { version: string; updateDataModel: DataUpdate; }
interface ComparisonResponse { messages: DataPatch[]; }

const comparisonPatches = new Map<string, Map<string, DataPatch>>();

@ComponentV2
export struct ProjectComparisonPanel {
  @Param comparison: XopcProjectComparison = { surfaceId: '', messages: [] };
  @Local private controller: SurfaceController | null = null;
  @Local private failed: boolean = false;
  private pending: boolean = false;

  aboutToAppear(): void {
    const controller = SurfaceControllerFactory.createSurfaceController({
      uiContext: this.getUIContext(),
      catalog: CatalogFactory.basic(),
    });
    controller.registerErrorCallback((code: SurfaceErrorCode, _message: string): void => {
      console.warn(`Project comparison SDK error ${code}`);
      this.failed = true;
    });
    controller.registerActionReceiver((raw: string): void => { this.inspect(raw); });
    this.controller = controller;
    for (const packet of this.comparison.messages) controller.handleMessage(JSON.stringify(packet));
    const patches = comparisonPatches.get(this.comparison.surfaceId);
    if (patches) {
      for (const packet of patches.values()) controller.handleMessage(JSON.stringify(packet));
    }
  }

  aboutToDisappear(): void {
    this.controller?.destroy();
    this.controller = null;
  }

  private async inspect(raw: string): Promise<void> {
    if (this.pending) return;
    const surfaceId = this.comparison.surfaceId;
    this.pending = true;
    this.failed = false;
    try {
      const envelope = JSON.parse(raw) as ComparisonActionEnvelope;
      if (envelope.version !== 'v0.9' || envelope.action.name !== 'inspectProject' || envelope.action.surfaceId !== surfaceId) return;
      const result = JSON.parse(await gatewaySession.request('/api/project-comparison/action', 'POST', raw)) as ComparisonResponse;
      if (result.messages.length !== 2 || result.messages.some((patch: DataPatch): boolean =>
        patch.version !== 'v0.9' || patch.updateDataModel.surfaceId !== surfaceId ||
        !/^\/(selection|project_[0-3]\/status)$/.test(patch.updateDataModel.path))) {
        throw new Error('Invalid project comparison response');
      }
      const patches = comparisonPatches.get(surfaceId) ?? new Map<string, DataPatch>();
      for (const patch of result.messages) {
        patches.set(patch.updateDataModel.path, patch);
        if (this.comparison.surfaceId === surfaceId) this.controller?.handleMessage(JSON.stringify(patch));
      }
      comparisonPatches.delete(surfaceId);
      comparisonPatches.set(surfaceId, patches);
      if (comparisonPatches.size > 100) {
        const first = comparisonPatches.keys().next();
        if (!first.done) comparisonPatches.delete(first.value);
      }
    } catch (_) {
      this.failed = true;
    } finally {
      this.pending = false;
    }
  }

  build() {
    Column({ space: 4 }) {
      if (this.controller) {
        UIRendererComponent({ surfaceController: this.controller })
      }
      if (this.failed) Text($r('app.string.chat_project_comparison_failed'))
    }.id('project-comparison-' + this.comparison.surfaceId).width('100%').alignItems(HorizontalAlign.Start)
  }
}
