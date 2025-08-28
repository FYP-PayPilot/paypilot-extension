import * as vscode from 'vscode';

/**
 * Secure API Key Manager using VS Code Secret Storage
 * 
 * This service provides secure storage for API keys using VS Code's built-in
 * secret storage which integrates with the OS keychain/credential manager.
 */
export class ApiKeyManager {
  private static readonly DEEPSEEK_API_KEY = 'paypilot.deepseek.apikey';
  private static readonly OPENAI_API_KEY = 'paypilot.openai.apikey';
  private static readonly CLAUDE_API_KEY = 'paypilot.claude.apikey';

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Store API key securely in VS Code secret storage
   */
  async storeApiKey(provider: 'deepseek' | 'openai' | 'claude', apiKey: string): Promise<void> {
    const key = this.getStorageKey(provider);
    await this.context.secrets.store(key, apiKey);
    console.log(`[PayPilot] API key stored securely for ${provider}`);
  }

  /**
   * Retrieve API key from secure storage
   */
  async getApiKey(provider: 'deepseek' | 'openai' | 'claude'): Promise<string | undefined> {
    const key = this.getStorageKey(provider);
    return await this.context.secrets.get(key);
  }

  /**
   * Delete API key from secure storage
   */
  async deleteApiKey(provider: 'deepseek' | 'openai' | 'claude'): Promise<void> {
    const key = this.getStorageKey(provider);
    await this.context.secrets.delete(key);
    console.log(`[PayPilot] API key deleted for ${provider}`);
  }

  /**
   * Check if API key exists for provider
   */
  async hasApiKey(provider: 'deepseek' | 'openai' | 'claude'): Promise<boolean> {
    const apiKey = await this.getApiKey(provider);
    return apiKey !== undefined && apiKey.length > 0;
  }

  /**
   * Prompt user to enter API key if not found
   */
  async ensureApiKey(provider: 'deepseek' | 'openai' | 'claude'): Promise<string | undefined> {
    let apiKey = await this.getApiKey(provider);
    
    if (!apiKey) {
      apiKey = await this.promptForApiKey(provider);
      if (apiKey) {
        await this.storeApiKey(provider, apiKey);
      }
    }
    
    return apiKey;
  }

  /**
   * Show input box to collect API key from user
   */
  private async promptForApiKey(provider: string): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.toUpperCase()} API key`,
      placeHolder: 'sk-...',
      password: true, // Hide input for security
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.length < 10) {
          return 'Please enter a valid API key';
        }
        return null;
      }
    });

    return result;
  }

  /**
   * Get storage key for provider
   */
  private getStorageKey(provider: 'deepseek' | 'openai' | 'claude'): string {
    switch (provider) {
      case 'deepseek':
        return ApiKeyManager.DEEPSEEK_API_KEY;
      case 'openai':
        return ApiKeyManager.OPENAI_API_KEY;
      case 'claude':
        return ApiKeyManager.CLAUDE_API_KEY;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Show API key management commands in command palette
   */
  static registerCommands(context: vscode.ExtensionContext, apiKeyManager: ApiKeyManager) {
    // Command to set API key
    const setApiKeyCommand = vscode.commands.registerCommand('paypilot.setApiKey', async () => {
      const provider = await vscode.window.showQuickPick(
        ['deepseek', 'openai', 'claude'],
        { placeHolder: 'Select AI provider' }
      ) as 'deepseek' | 'openai' | 'claude';

      if (provider) {
        const apiKey = await apiKeyManager.promptForApiKey(provider);
        if (apiKey) {
          await apiKeyManager.storeApiKey(provider, apiKey);
          vscode.window.showInformationMessage(`API key for ${provider} saved securely!`);
        }
      }
    });

    // Command to remove API key
    const removeApiKeyCommand = vscode.commands.registerCommand('paypilot.removeApiKey', async () => {
      const provider = await vscode.window.showQuickPick(
        ['deepseek', 'openai', 'claude'],
        { placeHolder: 'Select provider to remove API key' }
      ) as 'deepseek' | 'openai' | 'claude';

      if (provider) {
        await apiKeyManager.deleteApiKey(provider);
        vscode.window.showInformationMessage(`API key for ${provider} removed!`);
      }
    });

    // Command to check API key status
    const checkApiKeyCommand = vscode.commands.registerCommand('paypilot.checkApiKeys', async () => {
      const providers = ['deepseek', 'openai', 'claude'] as const;
      const status = await Promise.all(
        providers.map(async (provider) => {
          const hasKey = await apiKeyManager.hasApiKey(provider);
          return `${provider}: ${hasKey ? '✅ Set' : '❌ Not set'}`;
        })
      );

      vscode.window.showInformationMessage(`API Key Status:\n${status.join('\n')}`);
    });

    context.subscriptions.push(setApiKeyCommand, removeApiKeyCommand, checkApiKeyCommand);
  }
}
