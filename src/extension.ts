import * as path from "path";
import { workspace, ExtensionContext, Disposable } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "fsm" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.fsm"),
    },
  };

  client = new LanguageClient("fsmLanguageServer", "AIM FSM Language Server", serverOptions, clientOptions);
  void client.start();
  context.subscriptions.push(
    new Disposable(() => {
      void client?.stop();
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
