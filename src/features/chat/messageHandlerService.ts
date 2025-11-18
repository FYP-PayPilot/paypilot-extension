import * as path from "path";
import * as vscode from "vscode";
import { DiffService } from "../diff/diffService";
import {
  getBackendModels,
  getChatAgent,
  streamChatUI,
} from "../../infrastructure/vscode_http_client";
import {
  getVSCodeModels,
  getLanguageModel,
} from "../language-model/languageModelService";
import { StatusBarService } from "../diff/statusBarService";
// import { McpService } from "../mcp/mcpService";
import { ContextService } from "../context/contextService";
import { PromptService } from "./promptService";
import { ContextMessageService } from "../context/contextMessageService";
// import { McpMessageService } from "../mcp/mcpMessageService";
import { ModelMessageService } from "../language-model/modelMessageService";
import { ChatMessage, FileChange, ToolContext, SessionFileChange } from "./messages";
import { FileOperation } from "../diff/types";
import {
  resolveWorkspacePath,
  getRelativePath,
  resolveWorkspaceUri,
  relativeUriPath,
} from "../../utils/workspace";

const WORKSPACE_CONTEXT_TOOL_NAME = "paypilot-workspaceContext";
const CREATE_FILE_TOOL_NAME = "paypilot-createFile";
const UPDATE_FILE_TOOL_NAME = "paypilot-updateFile";
const DELETE_FILE_TOOL_NAME = "paypilot-deleteFile";
const CREATE_DIRECTORY_TOOL_NAME = "paypilot-createDirectory";
const READ_FILE_TOOL_NAME = "paypilot-readFile";
const DELETE_DIRECTORY_TOOL_NAME = "paypilot-deleteDirectory";

/**
 * Agent mode selection
 */
type AgentMode = "native" | "backend";

/**
 * Orchestrates chat requests, AI responses, diff tracking, context management, MCP configuration and chat management.
 * Acts as the bridge between the webview and backend services.
 */
export class MessageHandlerService {
  private currentAbortController: AbortController | null = null;
  private readonly diffService: DiffService;
  private readonly statusBarService: StatusBarService;
  // private readonly mcpService: McpService;
  private readonly contextService: ContextService;
  private readonly promptService: PromptService;
  private readonly contextMessageService: ContextMessageService;
  // private readonly mcpMessageService: McpMessageService;
  private readonly modelMessageService: ModelMessageService;
  private agentChangeLog: string[] = [];
  private currentSessionFileChanges: SessionFileChange[] = [];

  constructor(
    workspaceState: vscode.Memento,
    private readonly chatTools: vscode.LanguageModelChatTool[]
  ) {
    this.statusBarService = new StatusBarService();
    this.diffService = new DiffService(this.statusBarService, workspaceState);
    // this.mcpService = new McpService();
    this.contextService = new ContextService();
    this.promptService = new PromptService();
    this.contextMessageService = new ContextMessageService(this.contextService);
    // this.mcpMessageService = new McpMessageService(this.mcpService);
    this.modelMessageService = new ModelMessageService();
  }

  /**
   * Open the diff view for the first tracked file.
   * Used by the `paypilot.openDiff` command.
   * @returns Promise that resolves when the operation completes.
   */
  async openDiffView(): Promise<void> {
    const tracked = this.diffService.getActiveDiffFiles();
    if (tracked.length === 0) {
      vscode.window.showInformationMessage("No modified files to review");
      return;
    }

    await this.diffService.openDiffForFile(tracked[0]);
    this.diffService.refreshStatusBarButtons();
  }

  /**
   * Dispatch messages from the chat webview to their handlers.
   * @param msg The message payload from the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when processing completes.
   */
  async handleMessage(msg: unknown, panel: vscode.Webview): Promise<void> {
    const message = msg as ChatMessage | undefined;
    const messageType = message?.type;

    switch (messageType) {
      case "chat:query":
        await this.handleChatQuery(message, panel);
        break;
      case "chat:stop":
        await this.handleChatStop(panel);
        break;
      case "model:list-request":
        await this.modelMessageService.sendAvailableModels(panel);
        break;
      case "model:change":
        await this.modelMessageService.handleModelChange(message);
        break;
      case "file:open":
        await this.handleFileOpen(message);
        break;
      case "context:request":
        await this.contextMessageService.respondToContextRequest(panel);
        break;
      case "context:add":
        await this.contextMessageService.addFiles(message?.filePaths, panel);
        break;
      case "context:remove":
        this.contextMessageService.removeFile(message?.filePath, panel);
        break;
      case "context:clear":
        this.contextMessageService.clearAll(panel);
        break;
      // case "mcp:toggle":
      //   this.mcpMessageService.toggle(Boolean(message?.enabled));
      //   break;
      // case "mcp:get":
      //   await this.mcpMessageService.sendServers(panel);
      //   break;
      default:
        console.warn(`[PayPilot] Unknown message type: ${messageType}`);
        break;
    }
  }

  /**
   * Process a `chat:query` request from the webview.
   * Routes to appropriate handler based on mode and agent selection.
   * @param msg The message payload from the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when processing completes.
   */
  private async handleChatQuery(
    msg: ChatMessage | undefined,
    panel: vscode.Webview
  ): Promise<void> {
    try {
      const mode = typeof msg?.mode === "string" ? msg.mode : "ask";
      const selectedModelSource: "vscode" | "backend" =
        msg?.source === "vscode" ? "vscode" : "backend";

      // Get configuration to determine which agent mode to use
      const cfg = vscode.workspace.getConfiguration("paypilot");
      const useBackendAgent = cfg.get<boolean>("useBackendAgent", false);

      // Get model selection
      let selectedModel: vscode.LanguageModelChat | null = null;
      let modelId: string | undefined = msg?.model;

      if (mode === "agent") {
        if (useBackendAgent) {
          // Backend agent mode - use backend model
          if (!modelId) {
            const backendModels = await getBackendModels(); // TODO: update this endpoint
            if (backendModels.length === 0) {
              panel.postMessage({
                type: "chat:error",
                error:
                  "No backend models available. Please ensure the FastAPI server is running.",
              });
              return;
            }
            modelId = backendModels[0].id;
          }
        } else {
          // Native agent mode - use VS Code model
          const resolved = await this.ensureVSCodeModel(
            modelId,
            panel,
            "agent mode"
          );
          if (!resolved) {
            return;
          }
          selectedModel = resolved.model;
          modelId = resolved.id;
        }
      } else if (selectedModelSource === "vscode") {
        const resolved = await this.ensureVSCodeModel(
          modelId,
          panel,
          "ask mode"
        );
        if (!resolved) {
          return;
        }
        selectedModel = resolved.model;
        modelId = resolved.id;
      } else if (!modelId) {
        const backendModels = await getBackendModels();
        if (backendModels.length === 0) {
          panel.postMessage({
            type: "chat:error",
            error:
              "No backend models available. Please ensure the FastAPI server is running.",
          });
          return;
        }
        modelId = backendModels[0].id;
      }

      const maxContextChars = Math.max(
        0,
        Number(cfg.get("maxContextChars")) || 0
      );

      // Extract editor context for AI prompt
      const editorContext =
        this.contextService.getActiveEditorContext(maxContextChars);

      // Build context files content
      let contextFilesContent = "";
      const contextFilePaths = Array.isArray(msg?.contextFiles)
        ? msg.contextFiles.map((f: { filePath: string }) => f.filePath)
        : undefined;

      if (contextFilePaths && contextFilePaths.length > 0) {
        await this.contextMessageService.addFiles(contextFilePaths);
        contextFilesContent = this.contextService.buildContextContent();
      }

      const composed = this.promptService.composePrompt(
        msg ?? {},
        mode,
        editorContext,
        contextFilesContent
      );

      // Store the current request for potential cancellation
      const abortController = new AbortController();
      this.currentAbortController = abortController;

      const userPrompt = msg ? msg.prompt ?? "" : "";
      // Route to appropriate handler
      if (mode === "agent") {
        if (useBackendAgent) {
          await this.handleBackendAgentMode(
            modelId!,
            composed,
            panel,
            abortController
          );
        } else {
          await this.handleNativeAgentMode(
            selectedModel!,
            composed,
            panel,
            abortController
          );
        }
      } else {
        await this.handleAskMode({
          modelId: modelId!,
          userPrompt,
          composedPrompt: composed,
          panel,
          abortController,
          source: selectedModelSource,
          vscodeModel: selectedModel ?? undefined,
        });
      }
    } catch (error) {
      this.currentAbortController = null;
      console.error("Error in chat:query handler:", error);
      panel.postMessage({
        type: "chat:error",
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  }

  private async ensureVSCodeModel(
    requestedId: string | undefined,
    panel: vscode.Webview,
    contextLabel: string
  ): Promise<{ model: vscode.LanguageModelChat; id: string } | null> {
    if (requestedId) {
      const requestedModel = await getLanguageModel(requestedId);
      if (requestedModel) {
        return { model: requestedModel, id: requestedModel.id };
      }
    }

    const vscodeModels = await getVSCodeModels();
    if (vscodeModels.length === 0) {
      panel.postMessage({
        type: "chat:error",
        error:
          "No VS Code language models available. Please install a language model extension.",
      });
      return null;
    }

    const fallbackId = vscodeModels[0].id;
    const fallbackModel = await getLanguageModel(fallbackId);
    if (!fallbackModel) {
      panel.postMessage({
        type: "chat:error",
        error: `Failed to select a VS Code language model for ${contextLabel}.`,
      });
      return null;
    }

    return { model: fallbackModel, id: fallbackId };
  }

  private async handleAskMode(options: {
    modelId: string;
    userPrompt: string;
    composedPrompt: string;
    panel: vscode.Webview;
    abortController: AbortController;
    source: "backend" | "vscode";
    vscodeModel?: vscode.LanguageModelChat;
  }): Promise<void> {
    if (options.source === "vscode") {
      if (!options.vscodeModel) {
        options.panel.postMessage({
          type: "chat:error",
          error:
            "Selected VS Code model is unavailable. Please choose another model.",
        });
        return;
      }
      await this.handleAskModeVSCode(
        options.vscodeModel,
        options.composedPrompt,
        options.panel,
        options.abortController
      );
      return;
    }

    await this.handleAskModeBackend(
      options.modelId,
      options.composedPrompt,
      options.panel,
      options.abortController
    );
  }

  /**
   * Execute backend agent mode via FastAPI.
   * The backend handles the agent loop and calls ToolExecutionServer for tool execution.
   * The integrated ToolExecutionServer automatically handles all UI notifications and diff tracking.
   *
   * @param modelId The model ID to use for the backend request.
   * @param composed The fully composed prompt to send to the backend.
   * @param panel The webview panel to communicate back to.
   * @param abortController Controller to allow cancellation of the request.
   * @returns Promise that resolves when processing completes.
   */
  private async handleBackendAgentMode(
    modelId: string,
    composed: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Backend Agent Mode via FastAPI");

    // Send initial working status
    panel.postMessage({
      type: "chat:working",
      message: "Agent is analyzing your request and planning actions...",
    });

    try {
      // Extract context for backend
      const cfg = vscode.workspace.getConfiguration("paypilot");
      const maxContextChars = Math.max(
        0,
        Number(cfg.get("maxContextChars")) || 0
      );
      const editorContext =
        this.contextService.getActiveEditorContext(maxContextChars);
      const fileContext = this.contextService.buildContextContent();

      // Call backend agent endpoint
      // Backend will:
      // 1. Run agent loop with LLM
      // 2. Call ToolExecutionServer via HTTP for tool execution
      // 3. ToolExecutionServer automatically sends UI notifications
      // 4. Backend receives tool results and continues loop
      // 5. Backend returns final response
      const response = await getChatAgent(
        modelId,
        composed,
        fileContext,
        editorContext,
        abortController.signal
      );

      // Backend agent is complete
      // All UI notifications were sent by ToolExecutionServer during execution
      // Just display the final response
      panel.postMessage({
        type: "chat:done",
        text: response,
      });

      // Send multi-file edit summary if there were changes
      // (tracked automatically by integrated ToolExecutionServer)
      this.sendMultiFileEditSummary(panel);
    } catch (agentError) {
      if (
        abortController.signal.aborted ||
        (agentError instanceof Error &&
          agentError.message === "Request was cancelled")
      ) {
        console.log("[PayPilot] Backend agent mode cancelled by user");
        panel.postMessage({ type: "chat:stopped" });
      } else {
        console.error("Error in backend agent mode:", agentError);
        panel.postMessage({
          type: "chat:error",
          error:
            agentError instanceof Error
              ? agentError.message
              : String(agentError),
        });
      }
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Execute native agent mode using VS Code's language model with tool calling.
   * This is the original agent implementation.
   *
   * @param selectedModel The language model to use for the request.
   * @param composed The fully composed prompt to send to the model.
   * @param panel The webview panel to communicate back to.
   * @param abortController Controller to allow cancellation of the request.
   * @returns Promise that resolves when processing completes.
   */
  private async handleNativeAgentMode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Native Agent Mode");
    panel.postMessage({
      type: "chat:working",
      message: "Analyzing code and preparing changes...",
    });

    const conversation: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(composed),
    ];
    const initialWorkspaceContext = await this.fetchWorkspaceContextSnapshot(panel);
    if (initialWorkspaceContext) {
      conversation.push(
        vscode.LanguageModelChatMessage.User(
          `Workspace context snapshot:\n${initialWorkspaceContext}`
        )
      );
    }
    this.agentChangeLog = [];
    const agentPlan: string[] = [];
    let planSent = false;

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const { signal } = abortController;
    const listener = () => {
      cancellationTokenSource.cancel();
    };
    signal.addEventListener("abort", listener, { once: true });

    let aggregatedResponse = "";

    try {
      while (true) {
        const response = await selectedModel.sendRequest(
          conversation,
          {
            justification: "PayPilot agent request",
            tools: this.chatTools,
            toolMode: vscode.LanguageModelChatToolMode.Auto,
          },
          cancellationTokenSource.token
        );

        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        const textParts: vscode.LanguageModelTextPart[] = [];

        for await (const part of response.stream) {
          if (cancellationTokenSource.token.isCancellationRequested) {
            break;
          }

          if (part instanceof vscode.LanguageModelTextPart) {
            aggregatedResponse += part.value;
            textParts.push(part);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (cancellationTokenSource.token.isCancellationRequested) {
          throw new Error("Request cancelled");
        }

        if (toolCalls.length === 0) {
          if (!planSent) {
            const planSteps =
              agentPlan.length > 0
                ? agentPlan
                : this.parsePlanLines(aggregatedResponse);
            if (planSteps.length > 0) {
              if (agentPlan.length === 0) {
                agentPlan.push(...planSteps);
              }
              panel.postMessage({
                type: "chat:agent-plan",
                title: "Proposed plan",
                steps: planSteps,
              });
              planSent = true;
            }
          }
          if (!planSent && agentPlan.length > 0) {
            panel.postMessage({
              type: "chat:agent-plan",
              title: "Proposed plan",
              steps: agentPlan,
            });
            planSent = true;
          }
          const summary = this.formatAgentChangeSummary();
          const baseText = aggregatedResponse.trim();
          const finalText = summary
            ? baseText
              ? `${baseText}\n\n---\n${summary}`
              : summary
            : aggregatedResponse;
          panel.postMessage({ type: "chat:done", text: finalText });
          if (summary) {
            panel.postMessage({ type: "chat:agent-summary", text: summary });
          }

          // Send multi-file edit summary if there were file changes
          this.sendMultiFileEditSummary(panel);
          break;
        }

        if (textParts.length > 0) {
          conversation.push(
            vscode.LanguageModelChatMessage.Assistant(textParts)
          );
          if (!planSent) {
            const planSteps = this.extractPlanSteps(textParts);
            if (planSteps.length > 0) {
              agentPlan.push(...planSteps);
              panel.postMessage({
                type: "chat:agent-plan",
                title: "Proposed plan",
                steps: planSteps,
              });
              planSent = true;
            }
          }
        }

        for (let index = 0; index < toolCalls.length; index += 1) {
          const call = toolCalls[index];
          try {
            const resultPart = await this.invokeToolCall(call, panel);
            conversation.push(
              vscode.LanguageModelChatMessage.Assistant([call])
            );
            conversation.push(
              vscode.LanguageModelChatMessage.User([resultPart])
            );
            if (!planSent) {
              const planSteps = this.extractPlanFromToolResult(resultPart);
              if (planSteps.length > 0) {
                agentPlan.push(...planSteps);
                panel.postMessage({
                  type: "chat:agent-plan",
                  title: "Proposed plan",
                  steps: planSteps,
                });
                planSent = true;
              }
            }
            const hasMoreCalls = index < toolCalls.length - 1;
            this.injectWorkspaceRefreshIfNeeded(
              conversation,
              call,
              hasMoreCalls
            );
          } catch (toolError) {
            console.error("[PayPilot] Tool invocation failed", toolError);
            panel.postMessage({
              type: "chat:error",
              error:
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError),
            });
            return;
          }
        }
      }
    } catch (agentError) {
      console.error("Error in native agent mode:", agentError);
      panel.postMessage({
        type: "chat:error",
        error:
          agentError instanceof Error ? agentError.message : String(agentError),
      });
    } finally {
      this.agentChangeLog = [];
      this.currentAbortController = null;
      cancellationTokenSource.dispose();
      signal.removeEventListener("abort", listener);
    }
  }

  /**
   * Execute ask mode via the FastAPI backend: stream the model's text back to the chat UI.
   * @param modelId The model ID to use for the backend request.
   * @param userPrompt The user's input to send to the model.
   * @param panel The webview panel to communicate back to.
   * @param abortController Controller to allow cancellation of the request.
   * @returns Promise that resolves when processing completes.
   */
  private async handleAskModeBackend(
    modelId: string,
    prompt: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Ask Mode via FastAPI backend");

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const { signal } = abortController;
    const listener = () => {
      cancellationTokenSource.cancel();
    };
    signal.addEventListener("abort", listener);

    try {
      const cfg = vscode.workspace.getConfiguration("paypilot");
      const maxContextChars = Math.max(
        0,
        Number(cfg.get("maxContextChars")) || 0
      );
      const editorContext =
        this.contextService.getActiveEditorContext(maxContextChars);
      const fileContext = this.contextService.buildContextContent();
      const workspaceContextText = await this.fetchWorkspaceContextSnapshot(panel);
      const mergedFileContext = workspaceContextText
        ? `${fileContext}\n\n--- Workspace Snapshot ---\n${workspaceContextText}`
        : fileContext;

      await streamChatUI(
        modelId,
        prompt,
        mergedFileContext,
        editorContext,
        (token: string) => {
          panel.postMessage({ type: "chat:stream", token });
        },
        (fullText: string) => {
          panel.postMessage({ type: "chat:done", text: fullText });
        },
        signal
      );
    } catch (chatError) {
      if (
        signal.aborted ||
        (chatError instanceof Error &&
          chatError.message === "Request cancelled")
      ) {
        console.log("[PayPilot] Ask mode cancelled by user");
        panel.postMessage({ type: "chat:stopped" });
      } else {
        console.error("Error in ask mode:", chatError);
        panel.postMessage({
          type: "chat:error",
          error:
            chatError instanceof Error ? chatError.message : String(chatError),
        });
      }
    } finally {
      this.currentAbortController = null;
      cancellationTokenSource.dispose();
      signal.removeEventListener("abort", listener);
    }
  }

  /**
   * Execute ask mode directly against a VS Code language model. Streams tokens
   * to the chat UI similar to the backend implementation but without invoking workspace tools.
   */
  private async handleAskModeVSCode(
    selectedModel: vscode.LanguageModelChat,
    composed: string,
    panel: vscode.Webview,
    abortController: AbortController
  ): Promise<void> {
    console.log("[PayPilot] Starting Ask Mode via VS Code language model");

    const conversation: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(composed),
    ];
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const { signal } = abortController;
    const listener = () => {
      cancellationTokenSource.cancel();
    };
    signal.addEventListener("abort", listener);

    let aggregatedResponse = "";

    try {
      while (true) {
        const response = await selectedModel.sendRequest(
          conversation,
          {
            justification: "PayPilot ask mode request",
            tools: this.getAskModeTools(),
            toolMode: vscode.LanguageModelChatToolMode.Auto,
          },
          cancellationTokenSource.token
        );

        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        const textParts: vscode.LanguageModelTextPart[] = [];

        for await (const part of response.stream) {
          if (cancellationTokenSource.token.isCancellationRequested) {
            throw new Error("Request cancelled");
          }

          if (part instanceof vscode.LanguageModelTextPart) {
            aggregatedResponse += part.value;
            textParts.push(part);
            panel.postMessage({ type: "chat:stream", token: part.value });
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push(part);
          }
        }

        if (textParts.length > 0) {
          conversation.push(vscode.LanguageModelChatMessage.Assistant(textParts));
        }

        if (toolCalls.length === 0) {
          panel.postMessage({ type: "chat:done", text: aggregatedResponse });
          break;
        }

        for (const call of toolCalls) {
          try {
            const resultPart = await this.invokeToolCall(call, panel);
            conversation.push(vscode.LanguageModelChatMessage.Assistant([call]));
            conversation.push(vscode.LanguageModelChatMessage.User([resultPart]));
          } catch (toolError) {
            console.error("[PayPilot] Ask mode tool invocation failed", toolError);
            panel.postMessage({
              type: "chat:error",
              error:
                toolError instanceof Error ? toolError.message : String(toolError),
            });
            return;
          }
        }
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && error.message === "Request cancelled")
      ) {
        console.log("[PayPilot] Ask mode (VS Code) cancelled by user");
        panel.postMessage({ type: "chat:stopped" });
      } else {
        console.error("Error in VS Code ask mode:", error);
        panel.postMessage({
          type: "chat:error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.currentAbortController = null;
      cancellationTokenSource.dispose();
      signal.removeEventListener("abort", listener);
    }
  }

  private async fetchWorkspaceContextSnapshot(panel: vscode.Webview): Promise<string> {
    try {
      panel.postMessage({
        type: "chat:tool-activity",
        title: "Gathering workspace context…",
        operation: "context",
      });
      const result = await vscode.lm.invokeTool(WORKSPACE_CONTEXT_TOOL_NAME, {
        toolInvocationToken: undefined,
        input: {
          glob: "**/*",
          maxFiles: 20,
          includeText: false,
        },
      });

      return result.content
        .map((part) =>
          part instanceof vscode.LanguageModelTextPart ? part.value : ""
        )
        .join("")
        .trim();
    } catch (error) {
      console.warn(
        "[PayPilot] Failed to gather workspace context snapshot for backend ask mode:",
        error
      );
      return "";
    }
  }

  private recordAgentChange(entry: string | undefined): void {
    if (!entry) {
      return;
    }
    if (!this.agentChangeLog.includes(entry)) {
      this.agentChangeLog.push(entry);
    }
  }

  private formatAgentChangeSummary(): string {
    if (this.agentChangeLog.length === 0) {
      return "";
    }
    const lines = this.agentChangeLog.map((entry) => `• ${entry}`);
    return [`Summary of applied changes:`, ...lines].join("\n");
  }

  private extractPlanSteps(
    textParts: vscode.LanguageModelTextPart[]
  ): string[] {
    const raw = textParts
      .map((part) => part.value)
      .join("")
      .trim();
    return this.parsePlanLines(raw);
  }

  private extractPlanFromToolResult(
    resultPart: vscode.LanguageModelToolResultPart
  ): string[] {
    const raw = resultPart.content
      .map((part) =>
        part instanceof vscode.LanguageModelTextPart ? part.value : ""
      )
      .join("")
      .trim();
    return this.parsePlanLines(raw);
  }

  private injectWorkspaceRefreshIfNeeded(
    conversation: vscode.LanguageModelChatMessage[],
    call: vscode.LanguageModelToolCallPart,
    hasMoreCalls: boolean
  ): void {
    if (!hasMoreCalls) {
      return;
    }

    const mutatingTools = new Set([
      CREATE_FILE_TOOL_NAME,
      UPDATE_FILE_TOOL_NAME,
      DELETE_FILE_TOOL_NAME,
      CREATE_DIRECTORY_TOOL_NAME,
      DELETE_DIRECTORY_TOOL_NAME,
    ]);

    if (!mutatingTools.has(call.name)) {
      return;
    }

    conversation.push(
      vscode.LanguageModelChatMessage.User(
        "Workspace files have changed. Refresh the workspace context before continuing."
      )
    );
  }

  private parsePlanLines(raw: string): string[] {
    if (!raw) {
      return [];
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const steps = lines
      .filter((line) => /^(?:\d+[\).]|step\s*\d+:|[-*])\s+/i.test(line))
      .map((line) =>
        line.replace(/^(?:\d+[\).]|step\s*\d+:|[-*])\s+/i, "").trim()
      );

    if (steps.length > 0) {
      return steps;
    }

    if (lines.length > 1 && raw.toLowerCase().includes("plan")) {
      return lines;
    }

    return [];
  }

  private getAskModeTools(): vscode.LanguageModelChatTool[] {
    return this.chatTools.filter(
      (tool) =>
        tool.name === WORKSPACE_CONTEXT_TOOL_NAME ||
        tool.name === READ_FILE_TOOL_NAME
    );
  }

  private async invokeToolCall(
    call: vscode.LanguageModelToolCallPart,
    panel: vscode.Webview
  ): Promise<vscode.LanguageModelToolResultPart> {
    if (!call?.name) {
      throw new Error("Invalid tool call: missing name");
    }

    let context: ToolContext | undefined;
    try {
      context = await this.prepareToolContext(call);
    } catch (error) {
      console.warn("[PayPilot] Failed to prepare tool context:", error);
      panel.postMessage({
        type: "chat:tool-activity",
        title: "Tool call skipped",
        detail:
          error instanceof Error
            ? error.message
            : "Unable to resolve workspace path for tool call.",
      });
      throw error;
    }

    const result = await vscode.lm.invokeTool(call.name, {
      toolInvocationToken: undefined,
      input: call.input,
    });

    this.notifyToolActivity(call, panel, context);

    if (context) {
      await this.applyToolSideEffects(context, call, result, panel);
    }

    return new vscode.LanguageModelToolResultPart(call.callId, result.content);
  }

  private async prepareToolContext(call: vscode.LanguageModelToolCallPart): Promise<ToolContext | undefined> {
    const getTargetPath = () => {
      const inputPath = (call.input as { path?: string })?.path;
      if (!inputPath || typeof inputPath !== "string") {
        return undefined;
      }
      return resolveWorkspacePath(inputPath);
    };

    switch (call.name) {
      case CREATE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri(
          (call.input as { path: string }).path
        );
        const { content, exists } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: exists ? "update" : "create",
          originalContent: content,
        };
      }
      case UPDATE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri(
          (call.input as { path: string }).path
        );
        const { content } = await this.readFileSnapshot(target);
        return {
          uri: target,
          operation: "update",
          originalContent: content,
        };
      }
      case DELETE_FILE_TOOL_NAME: {
        const target = resolveWorkspaceUri(
          (call.input as { path: string }).path
        );
        const { content, exists } = await this.readFileSnapshot(target);
        if (!exists) {
          return undefined;
        }
        return {
          uri: target,
          operation: "delete",
          originalContent: content,
        };
      }
      case CREATE_DIRECTORY_TOOL_NAME: {
        const target = resolveWorkspaceUri(
          (call.input as { path: string }).path
        );
        const snapshot = await this.captureDirectorySnapshot(target);
        const exists = snapshot !== undefined;
        return {
          uri: target,
          operation: exists ? "update" : "create",
          originalContent: exists ? snapshot ?? "" : "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }
      case DELETE_DIRECTORY_TOOL_NAME: {
        const target = resolveWorkspaceUri(
          (call.input as { path: string }).path
        );
        const snapshot = await this.captureDirectorySnapshot(target);
        if (!snapshot) {
          return undefined;
        }
        return {
          uri: target,
          operation: "delete",
          originalContent: "",
          isDirectory: true,
          directorySnapshot: snapshot,
        };
      }
      default:
        return undefined;
    }
  }

  private notifyToolActivity(
    call: vscode.LanguageModelToolCallPart,
    panel: vscode.Webview,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ): void {
    const activity = this.describeToolActivity(call, context);
    if (!activity) {
      return;
    }

    panel.postMessage({
      type: "chat:tool-activity",
      ...activity,
    });

    // Track file changes for summary
    if (activity.filePath && activity.operation) {
      const fileName = path.basename(activity.filePath);
      const fileChange: FileChange = {
        fileName,
        filePath: activity.filePath,
        operation: activity.operation as any,
      };

      // Add line change information if available from context
      if (context) {
        // For file operations, we'll calculate lines later if needed
        // For now, just track the operation
        this.currentSessionFileChanges.push(fileChange);
      } else {
        this.currentSessionFileChanges.push(fileChange);
      }
    }

    if (
      activity.operation === "directory" ||
      activity.operation === "directory-delete"
    ) {
      const description = `${
        activity.operation === "directory" ? "Created" : "Deleted"
      } ${activity.detail ?? activity.title}`;
      this.recordAgentChange(description);
    }
  }

  private describeToolActivity(
    call: vscode.LanguageModelToolCallPart,
    context?: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
    }
  ):
    | { title: string; detail?: string; filePath?: string; operation?: string }
    | undefined {
    try {
      if (call.name === WORKSPACE_CONTEXT_TOOL_NAME) {
        return { title: "Gathering workspace context…", operation: "context" };
      }

      const input = call.input as { path?: string } | undefined;
      const candidatePath = input?.path;
      const targetUri =
        context?.uri ??
        (candidatePath ? resolveWorkspaceUri(candidatePath) : undefined);

      if (!targetUri) {
        if (call.name === READ_FILE_TOOL_NAME) {
          return { title: "Reading workspace data", operation: "read" };
        }
        return undefined;
      }

      const relativePath = getRelativePath(targetUri);
      const fileName = path.basename(targetUri.fsPath);

      switch (call.name) {
        case CREATE_FILE_TOOL_NAME: {
          const verb = context?.operation === "create" ? "created" : "updated";
          return {
            title: `${fileName} ${verb}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: context?.operation ?? "create",
          };
        }
        case UPDATE_FILE_TOOL_NAME: {
          return {
            title: `${fileName} updated`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "update",
          };
        }
        case DELETE_FILE_TOOL_NAME: {
          return {
            title: `${fileName} deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "delete",
          };
        }
        case CREATE_DIRECTORY_TOOL_NAME: {
          return {
            title: `${fileName || relativePath} directory created`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory",
          };
        }
        case DELETE_DIRECTORY_TOOL_NAME: {
          return {
            title: `${fileName || relativePath} directory deleted`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "directory-delete",
          };
        }
        case READ_FILE_TOOL_NAME: {
          return {
            title: `${fileName} read`,
            detail: relativePath,
            filePath: targetUri.fsPath,
            operation: "read",
          };
        }
        default:
          return {
            title: `Invoked ${call.name}`,
            detail: relativePath,
            filePath: targetUri.fsPath,
          };
      }
    } catch (error) {
      console.warn("[PayPilot] Failed to describe tool activity", error);
      return undefined;
    }
  }

  private sendMultiFileEditSummary(panel: vscode.Webview): void {
    if (this.currentSessionFileChanges.length === 0) {
      return;
    }

    // Calculate totals
    const totalLinesAdded = this.currentSessionFileChanges.reduce(
      (sum, change) => sum + (change.linesAdded || 0),
      0
    );
    const totalLinesDeleted = this.currentSessionFileChanges.reduce(
      (sum, change) => sum + (change.linesDeleted || 0),
      0
    );

    // Send the summary message
    panel.postMessage({
      type: "chat:multi-file-edit-summary",
      changes: this.currentSessionFileChanges,
      totalLinesAdded,
      totalLinesDeleted,
    });

    // Clear the changes for the next session
    this.currentSessionFileChanges = [];
  }

  private async applyToolSideEffects(
    context: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
      isDirectory?: boolean;
      directorySnapshot?: string;
    },
    call: vscode.LanguageModelToolCallPart,
    result: vscode.LanguageModelToolResult,
    panel: vscode.Webview
  ): Promise<void> {
    if (context.isDirectory) {
      await this.diffService.trackModifiedFiles([
        {
          filePath: context.uri.fsPath,
          originalContent: context.originalContent,
          operation: context.operation,
          isDirectory: true,
          directorySnapshot: context.directorySnapshot,
        },
      ]);

      if (context.operation === "delete") {
        this.contextMessageService.handleExternalRemoval(
          context.uri.fsPath,
          panel
        );
      }

      this.recordAgentChange(
        `${this.describeOperation(
          context.operation,
          context.uri.fsPath
        )} (${relativeUriPath(context.uri)})`
      );

      panel.postMessage({
        type: "chat:code-applied",
        fileName: path.basename(context.uri.fsPath),
        filePath: context.uri.fsPath,
        linesAdded: 0,
        linesDeleted: 0,
        explanation: this.describeOperation(
          context.operation,
          context.uri.fsPath
        ),
        operation: context.operation,
      });
      return;
    }

    let nextContent = "";

    if (context.operation !== "delete") {
      try {
        nextContent = await this.readFileAfterTool(context.uri);
      } catch (error) {
        console.warn(
          `[PayPilot] Failed to read modified file ${context.uri.fsPath}:`,
          error
        );
      }
    }

    if (context.operation === "delete") {
      this.contextMessageService.handleExternalRemoval(
        context.uri.fsPath,
        panel
      );
    }

    const diffStats = this.diffService.calculateDiffStats(
      context.originalContent.split("\n"),
      context.operation === "delete" ? [] : nextContent.split("\n")
    );

    await this.diffService.trackModifiedFiles([
      {
        filePath: context.uri.fsPath,
        originalContent: context.originalContent,
        operation: context.operation,
      },
    ]);

    panel.postMessage({
      type: "chat:code-applied",
      fileName: path.basename(context.uri.fsPath),
      filePath: context.uri.fsPath,
      linesAdded: diffStats.added,
      linesDeleted: diffStats.deleted,
      explanation: this.describeOperation(
        context.operation,
        context.uri.fsPath
      ),
      operation: context.operation,
    });

    const relative = getRelativePath(context.uri);
    this.recordAgentChange(
      `${this.describeOperation(
        context.operation,
        context.uri.fsPath
      )} (${relative})`
    );

    // log tool result for transparency
    const resultText = result.content
      .map((part) =>
        part instanceof vscode.LanguageModelTextPart ? part.value : ""
      )
      .join("")
      .trim();
    if (resultText) {
      console.log(`[PayPilot] Tool ${call.name} result: ${resultText}`);
    }
  }

  private describeOperation(
    operation: FileOperation,
    filePath: string
  ): string {
    const fileName = path.basename(filePath);
    switch (operation) {
      case "create":
        return `Created ${fileName}`;
      case "delete":
        return `Deleted ${fileName}`;
      default:
        return `Updated ${fileName}`;
    }
  }

  private async readFileSnapshot(
    uri: vscode.Uri
  ): Promise<{ content: string; exists: boolean }> {
    try {
      const buffer = await vscode.workspace.fs.readFile(uri);
      return { content: Buffer.from(buffer).toString("utf8"), exists: true };
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      ) {
        return { content: "", exists: false };
      }
      throw error;
    }
  }

  private async readFileAfterTool(uri: vscode.Uri): Promise<string> {
    const buffer = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(buffer).toString("utf8");
  }

  private async captureDirectorySnapshot(
    uri: vscode.Uri
  ): Promise<string | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (!(stat.type & vscode.FileType.Directory)) {
        return undefined;
      }
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      ) {
        return undefined;
      }
      throw error;
    }

    const entries: Array<{
      path: string;
      type: "file" | "directory";
      content?: string;
    }> = [];
    await this.collectDirectoryEntries(uri, uri, entries);
    return JSON.stringify(entries);
  }

  private async collectDirectoryEntries(
    baseUri: vscode.Uri,
    currentUri: vscode.Uri,
    entries: Array<{
      path: string;
      type: "file" | "directory";
      content?: string;
    }>
  ): Promise<void> {
    const relative = path
      .relative(baseUri.fsPath, currentUri.fsPath)
      .replace(/\\/g, "/");
    if (relative && relative !== "") {
      entries.push({ path: relative, type: "directory" });
    }

    const children = await vscode.workspace.fs.readDirectory(currentUri);
    for (const [name, type] of children) {
      const childUri = vscode.Uri.joinPath(currentUri, name);
      if (type & vscode.FileType.Directory) {
        await this.collectDirectoryEntries(baseUri, childUri, entries);
      } else if (type & vscode.FileType.File) {
        const content = await vscode.workspace.fs.readFile(childUri);
        const relativeChild = path
          .relative(baseUri.fsPath, childUri.fsPath)
          .replace(/\\/g, "/");
        entries.push({
          path: relativeChild,
          type: "file",
          content: Buffer.from(content).toString("base64"),
        });
      }
    }
  }

  /**
   * Stop the active streaming request, if any, and notify the webview.
   * @param panel The webview panel to communicate back to.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleChatStop(panel: vscode.Webview): Promise<void> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      panel.postMessage({ type: "chat:stopped" });
    }
  }

  /**
   * Open a file requested by the chat webview in the editor.
   * @param message The message payload from the webview, containing the file path.
   * @returns Promise that resolves when the operation completes.
   */
  private async handleFileOpen(message?: ChatMessage): Promise<void> {
    try {
      const filePath = message?.filePath;
      if (!filePath) {
        return;
      }
      const uri = vscode.Uri.file(filePath);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      console.error("Error opening file:", error);
      vscode.window.showErrorMessage(
        `Failed to open file: ${message?.filePath ?? "unknown"}`
      );
    }
  }

  /**
   * Track chat panel visibility so status bar controls mirror the UI.
   * Called from the extension entrypoint when the webview visibility changes.
   * @param visible True when the chat webview is visible.
   * @returns void
   */
  setChatPanelVisibility(visible: boolean): void {
    this.statusBarService.setChatPanelVisibility(visible);

    // show diff buttons only when the panel is visible and there are tracked changes
    if (visible && this.diffService.hasChanges()) {
      const totalFiles = this.diffService.getActiveDiffFiles().length;
      this.statusBarService.showEnhancedDiffButtons(
        true,
        this.diffService.activeFileHasChanges(),
        totalFiles,
        this.diffService.isActiveDiffOpen()
      );
    } else if (!visible) {
      this.statusBarService.cleanupStatusBarItems();
    }
  }

  /**
   * Expose the diff service to the extension entrypoint for command registration.
   */
  getDiffService(): DiffService {
    return this.diffService;
  }

  /**
   * Expose the MCP service to the extension entrypoint for configuration helpers.
   */
  // getMcpService(): McpService {
  //   return this.mcpService;
  // }

  /**
   * Dispose underlying services and cancel in-flight requests.
   */
  dispose(): void {
    this.statusBarService.dispose();
    this.diffService.dispose();
    this.contextMessageService.clearAll();
    // this.mcpService.reset();
    
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    console.log("[PayPilot] MessageHandlerService disposed");
  }

  /**
   * Public method for ToolExecutionServer to notify tool activity.
   * Reuses the existing notifyToolActivity infrastructure to ensure
   * consistent UI updates and state tracking.
   *
   * @param toolName - The name of the tool being invoked
   * @param toolArgs - The arguments passed to the tool
   * @param context - The tool context (file state, operation, etc.)
   * @param panel - The webview panel to send notifications to
   */
  public notifyToolActivityExternal(
    toolName: string,
    toolArgs: any,
    context:
      | {
          uri: vscode.Uri;
          operation: FileOperation;
          originalContent: string;
        }
      | undefined,
    panel: vscode.Webview
  ): void {
    // Create a mock LanguageModelToolCallPart to match the expected interface
    const mockCall = {
      name: toolName,
      input: toolArgs,
      callId: `external-${Date.now()}-${Math.random()}`,
    } as vscode.LanguageModelToolCallPart;

    // Call the existing private method - this handles both UI and state tracking
    this.notifyToolActivity(mockCall, panel, context);
  }

  /**
   * Public method for ToolExecutionServer to apply tool side effects.
   * Reuses the existing applyToolSideEffects infrastructure.
   *
   * @param context - The tool context with file state and operation
   * @param toolName - The name of the tool that was executed
   * @param executionResult - The result from tool execution
   * @param panel - The webview panel to send notifications to
   */
  public async applyToolSideEffectsExternal(
    context: {
      uri: vscode.Uri;
      operation: FileOperation;
      originalContent: string;
      isDirectory?: boolean;
      directorySnapshot?: string;
    },
    toolName: string,
    executionResult: any,
    panel: vscode.Webview
  ): Promise<void> {
    // Create mock objects to match the expected interface
    const mockCall = {
      name: toolName,
      input: { path: context.uri.fsPath },
      callId: `external-${Date.now()}-${Math.random()}`,
    } as vscode.LanguageModelToolCallPart;

    const mockResult = {
      content: [
        new vscode.LanguageModelTextPart(
          executionResult.success
            ? executionResult.message || "Success"
            : executionResult.error || "Unknown error"
        ),
      ],
    } as vscode.LanguageModelToolResult;

    // Call the existing private method - this handles diff tracking and notifications
    await this.applyToolSideEffects(context, mockCall, mockResult, panel);
  }

  /**
   * Expose DiffService for ToolExecutionServer.
   * ToolExecutionServer needs access to calculate diffs and track changes.
   */
  public getDiffServiceForTools(): DiffService {
    return this.diffService;
  }

  /**
   * Expose prepareToolContext for ToolExecutionServer.
   * This allows ToolExecutionServer to use the same context preparation logic.
   */
  public async prepareToolContextExternal(
    toolName: string,
    toolArgs: any
  ): Promise<
    | {
        uri: vscode.Uri;
        operation: FileOperation;
        originalContent: string;
        isDirectory?: boolean;
        directorySnapshot?: string;
      }
    | undefined
  > {
    // Create a mock call to reuse the existing prepareToolContext logic
    const mockCall = {
      name: toolName,
      input: toolArgs,
      callId: `external-${Date.now()}`,
    } as vscode.LanguageModelToolCallPart;

    return await this.prepareToolContext(mockCall);
  }
}
