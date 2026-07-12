import { JupyterFrontEnd, JupyterFrontEndPlugin } from "@jupyterlab/application";
import { ICommandPalette, ReactWidget, ToolbarButton } from "@jupyterlab/apputils";
import type { DocumentRegistry } from "@jupyterlab/docregistry";
import { ILauncher } from "@jupyterlab/launcher";
import {
  INotebookTracker,
  INotebookWidgetFactory,
  type INotebookModel,
  NotebookPanel,
  NotebookWidgetFactory
} from "@jupyterlab/notebook";
import { notebookIcon } from "@jupyterlab/ui-components";
import { BoxLayout } from "@lumino/widgets";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { TracepadApp } from "./TracepadApp";
import { JupyterNotebookHost } from "./jupyter/notebookHost";

const TRACEPAD_FACTORY = "Tracepad";
const OPEN_CURRENT_COMMAND = "tracepad:open-current";
const NEW_NOTEBOOK_COMMAND = "tracepad:new-notebook";

const tracepadViews = new WeakMap<NotebookPanel, () => void>();

class TracepadErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Tracepad render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="tp-fatal-error" role="alert">
          <h2>Tracepad could not render this notebook</h2>
          <pre>{this.state.error.message}</pre>
        </section>
      );
    }
    return this.props.children;
  }
}

class TracepadWidget extends ReactWidget {
  private readonly host: JupyterNotebookHost;

  constructor(
    readonly panel: NotebookPanel,
    private readonly openClassic: () => void | Promise<void>
  ) {
    super();
    this.host = new JupyterNotebookHost(panel);
    this.addClass("jp-TracepadWidget");
    this.node.tabIndex = 0;
  }

  render(): JSX.Element {
    return (
      <TracepadErrorBoundary>
        <TracepadApp host={this.host} onOpenClassic={this.openClassic} />
      </TracepadErrorBoundary>
    );
  }
}

class TracepadWidgetFactory extends NotebookWidgetFactory {
  protected createNewWidget(
    context: DocumentRegistry.IContext<INotebookModel>,
    source?: NotebookPanel
  ): NotebookPanel {
    const panel = super.createNewWidget(context, source);
    attachTracepad(panel);
    return panel;
  }
}

function attachTracepad(panel: NotebookPanel): void {
  const showExisting = tracepadViews.get(panel);
  if (showExisting) {
    showExisting();
    return;
  }

  let tracepad: TracepadWidget;
  const showTracepad = () => {
    panel.removeClass("jp-TracepadClassicDocument");
    panel.toolbar.hide();
    panel.content.hide();
    tracepad.show();
    tracepad.update();
  };
  const showClassic = () => {
    panel.addClass("jp-TracepadClassicDocument");
    tracepad.hide();
    panel.toolbar.show();
    panel.content.show();
    panel.content.activate();
  };

  tracepad = new TracepadWidget(panel, showClassic);
  const tracepadButton = new ToolbarButton({
    label: "Tracepad view",
    tooltip: "Return to the Tracepad notebook view",
    onClick: showTracepad
  });

  panel.addClass("jp-TracepadDocument");
  panel.toolbar.addItem("tracepad-view", tracepadButton);
  BoxLayout.setStretch(tracepad, 1);
  (panel.layout as BoxLayout).addWidget(tracepad);
  tracepadViews.set(panel, showTracepad);
  panel.disposed.connect(() => {
    tracepadViews.delete(panel);
    tracepadButton.dispose();
  });
  showTracepad();
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: "@tracepad/jupyterlab:plugin",
  autoStart: true,
  requires: [INotebookWidgetFactory],
  optional: [INotebookTracker, ICommandPalette, ILauncher],
  activate: (
    app: JupyterFrontEnd,
    notebookFactoryToken: NotebookWidgetFactory.IFactory,
    notebooks: INotebookTracker | null,
    palette: ICommandPalette | null,
    launcher: ILauncher | null
  ) => {
    const notebookFactory = notebookFactoryToken as NotebookWidgetFactory;
    const tracepadFactory = new TracepadWidgetFactory({
      name: TRACEPAD_FACTORY,
      label: "Tracepad",
      fileTypes: ["notebook"],
      defaultFor: ["notebook"],
      modelName: "notebook",
      preferKernel: true,
      canStartKernel: true,
      autoStartDefault: notebookFactory.autoStartDefault,
      shutdownOnClose: notebookFactory.shutdownOnClose,
      rendermime: notebookFactory.rendermime,
      contentFactory: notebookFactory.contentFactory,
      mimeTypeService: notebookFactory.mimeTypeService,
      editorConfig: notebookFactory.editorConfig,
      notebookConfig: notebookFactory.notebookConfig,
      toolbarFactory: () => []
    });
    app.docRegistry.addWidgetFactory(tracepadFactory);
    app.docRegistry.setDefaultWidgetFactory("notebook", TRACEPAD_FACTORY);

    const attachTrackedPanel = (panel: NotebookPanel) => {
      void panel.context.ready.then(() => attachTracepad(panel));
    };
    notebooks?.widgetAdded.connect((_sender, panel) => attachTrackedPanel(panel));
    void app.restored.then(() => notebooks?.forEach(attachTrackedPanel));

    app.commands.addCommand(OPEN_CURRENT_COMMAND, {
      label: "Open Notebook in Tracepad",
      icon: notebookIcon,
      isEnabled: () => Boolean(notebooks?.currentWidget),
      execute: async () => {
        const panel = notebooks?.currentWidget;
        if (!panel) return;
        attachTracepad(panel);
      }
    });

    app.commands.addCommand(NEW_NOTEBOOK_COMMAND, {
      label: "Tracepad Notebook",
      caption: "Create a standard .ipynb notebook in Tracepad",
      icon: notebookIcon,
      execute: async args => {
        const cwd = typeof args["cwd"] === "string" ? args["cwd"] : "";
        const model = await app.serviceManager.contents.newUntitled({
          path: cwd,
          type: "notebook"
        });
        return app.commands.execute("docmanager:open", {
          path: model.path,
          factory: TRACEPAD_FACTORY
        });
      }
    });

    palette?.addItem({ command: OPEN_CURRENT_COMMAND, category: "Tracepad" });
    palette?.addItem({ command: NEW_NOTEBOOK_COMMAND, category: "Tracepad" });
    launcher?.add({
      command: NEW_NOTEBOOK_COMMAND,
      category: "Notebook",
      categoryRank: 1,
      rank: 0
    });
  }
};

export default plugin;
