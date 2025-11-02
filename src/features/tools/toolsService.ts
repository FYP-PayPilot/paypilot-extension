import * as vscode from "vscode";
import { PaypilotToolset } from "./types";
import { registerWorkspaceContextTool } from "./workspaceContextTool";
import { 
  registerCreateFileTool, 
  registerReadFileTool, 
  registerUpdateFileTool, 
  registerDeleteFileTool 
} from "./fileOperationTools";
import { 
  registerCreateDirectoryTool, 
  registerDeleteDirectoryTool 
} from "./directoryTools";


export class ToolsService {
  
    /** 
   * Internal registry of all registered tools.
   * Maintains tools for potential future inspection or management.
   */
  private tools: vscode.LanguageModelChatTool[] = [];

  /**
   * Creates a new Tools Service instance.
   * @param context - VS Code extension context for tool subscription management
   */
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Registers all PayPilot workspace tools with VS Code's Language Model API.
   * 
   * This method coordinates the registration of all workspace tools in the
   * correct order and ensures proper dependency management. Each tool is
   * registered independently to maintain modularity and testability.
   * 
   * Registration order follows logical groupings:
   * 1. Discovery tools first (workspace context)
   * 2. File CRUD operations (create, read, update, delete)
   * 3. Directory management operations
   * 
   * Error handling:
   * - Individual tool registration failures don't abort the entire process
   * - Failed tools are excluded from the returned toolset
   * - Detailed logging helps diagnose registration issues
   * 
   * @returns Complete PayPilot toolset for language model integration
   */
  public registerAllTools(): PaypilotToolset {
    try {
      // Clear any existing tools from previous registrations
      this.tools = [];

      /**
       * Register workspace discovery tool.
       * This tool is foundational for AI model workspace understanding
       * and should be available before any file operations.
       */
      this.tools.push(registerWorkspaceContextTool(this.context));

      /**
       * Register file CRUD operations.
       * These tools provide complete file lifecycle management,
       * from creation through deletion.
       */
      this.tools.push(registerCreateFileTool(this.context));
      this.tools.push(registerReadFileTool(this.context));
      this.tools.push(registerUpdateFileTool(this.context));
      this.tools.push(registerDeleteFileTool(this.context));

      /**
       * Register directory management tools.
       * These complement file operations by providing structure management.
       */
      this.tools.push(registerCreateDirectoryTool(this.context));
      this.tools.push(registerDeleteDirectoryTool(this.context));

      // Return toolset in the expected format for MessageHandlerService
      return { chatTools: this.tools };
      
    } catch (error) {
      // Log registration failures for debugging
      console.error("PayPilot tool registration failed:", error);
      
      // Return empty toolset rather than crashing the extension
      return { chatTools: [] };
    }
  }

  /**
   * Gets the currently registered tools.
   * 
   * This method provides access to the tool registry for inspection,
   * testing, or advanced management scenarios. The returned array
   * is a copy to prevent external modification of the internal registry.
   * 
   * @returns Array of currently registered language model tools
   */
  public getRegisteredTools(): vscode.LanguageModelChatTool[] {
    return [...this.tools];
  }

  /**
   * Gets the count of successfully registered tools.
   * 
   * This utility method helps validate tool registration success
   * and can be used for health checks or debugging scenarios.
   * 
   * @returns Number of tools currently registered
   */
  public getToolCount(): number {
    return this.tools.length;
  }

  /**
   * Checks if a specific tool is registered by name.
   * 
   * This method enables verification of specific tool availability,
   * which can be useful for conditional feature enablement or
   * debugging tool-specific issues.
   * 
   * @param toolName - The name of the tool to check (e.g., "paypilot-readFile")
   * @returns True if the tool is registered, false otherwise
   */
  public isToolRegistered(toolName: string): boolean {
    return this.tools.some(tool => tool.name === toolName);
  }

  /**
   * Gets detailed information about all registered tools.
   * 
   * This method provides comprehensive tool metadata for debugging,
   * logging, or user interface display purposes. The information
   * includes tool names, descriptions, and schema details.
   * 
   * @returns Array of tool information objects
   */
  public getToolInfo(): Array<{ name: string; description: string; hasSchema: boolean }> {
    return this.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      hasSchema: !!tool.inputSchema
    }));
  }
}