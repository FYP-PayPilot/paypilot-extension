import * as vscode from "vscode";

/**
 * Interface for MCP server configuration
 */
export interface McpServerConfig {
  name: string;
  type: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Service class for managing Model Context Protocol (MCP) functionality
 */
export class McpService {
  private enableMcp: boolean = false;
  private activeServers: string[] = [];

  /**
   * Get MCP enabled state
   */
  isEnabled(): boolean {
    return this.enableMcp;
  }

  /**
   * Set MCP enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enableMcp = enabled;
    console.log(`[PayPilot] MCP ${this.enableMcp ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get active MCP servers
   */
  getActiveServers(): string[] {
    return [...this.activeServers];
  }

  /**
   * Set active MCP servers
   */
  setActiveServers(servers: string[]): void {
    this.activeServers = [...servers];
    console.log(`[PayPilot] Active MCP servers updated:`, this.activeServers);
  }

  /**
   * Ensures the context7 MCP server is configured in VS Code settings
   */
  async ensureContext7McpServer(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('mcp');
      const servers = config.get('servers', {}) as Record<string, any>;
      
      // Check if context7 server already exists
      if (!servers['context7']) {
        console.log('[PayPilot] Adding context7 MCP server to configuration');
        
        const context7Server = {
          type: 'http',
          url: 'https://mcp.context7.com/mcp'
        };
        
        servers['context7'] = context7Server;
        
        // Update the configuration globally
        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
        console.log('[PayPilot] context7 MCP server added successfully');
      } else {
        console.log('[PayPilot] context7 MCP server already configured');
      }
    } catch (error) {
      console.error('[PayPilot] Error configuring context7 MCP server:', error);
      throw new Error(`Failed to configure context7 MCP server: ${error}`);
    }
  }

  /**
   * Gets available MCP servers from VS Code configuration
   */
  getMcpServers(): McpServerConfig[] {
    try {
      const config = vscode.workspace.getConfiguration('mcp');
      const servers = config.get('servers', {}) as Record<string, any>;
      
      return Object.keys(servers).map(name => ({
        name,
        ...servers[name]
      }));
    } catch (error) {
      console.error('[PayPilot] Error reading MCP servers:', error);
      return [];
    }
  }

  /**
   * Add a new MCP server configuration
   */
  async addMcpServer(serverConfig: McpServerConfig): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('mcp');
      const servers = config.get('servers', {}) as Record<string, any>;
      
      // Add the new server configuration
      const { name, ...serverData } = serverConfig;
      servers[name] = serverData;
      
      // Update the configuration
      await config.update('servers', servers, vscode.ConfigurationTarget.Global);
      console.log(`[PayPilot] MCP server '${name}' added successfully`);
      
      // Add to active servers if not already present
      if (!this.activeServers.includes(name)) {
        this.activeServers.push(name);
      }
    } catch (error) {
      console.error(`[PayPilot] Error adding MCP server '${serverConfig.name}':`, error);
      throw new Error(`Failed to add MCP server: ${error}`);
    }
  }

  /**
   * Remove an MCP server configuration
   */
  async removeMcpServer(serverName: string): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('mcp');
      const servers = config.get('servers', {}) as Record<string, any>;
      
      if (servers[serverName]) {
        delete servers[serverName];
        
        // Update the configuration
        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
        console.log(`[PayPilot] MCP server '${serverName}' removed successfully`);
        
        // Remove from active servers
        this.activeServers = this.activeServers.filter(name => name !== serverName);
      } else {
        console.warn(`[PayPilot] MCP server '${serverName}' not found`);
      }
    } catch (error) {
      console.error(`[PayPilot] Error removing MCP server '${serverName}':`, error);
      throw new Error(`Failed to remove MCP server: ${error}`);
    }
  }

  /**
   * Update an existing MCP server configuration
   */
  async updateMcpServer(serverName: string, newConfig: Partial<McpServerConfig>): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('mcp');
      const servers = config.get('servers', {}) as Record<string, any>;
      
      if (servers[serverName]) {
        // Update the server configuration
        const { name, ...serverData } = newConfig;
        servers[serverName] = { ...servers[serverName], ...serverData };
        
        // Update the configuration
        await config.update('servers', servers, vscode.ConfigurationTarget.Global);
        console.log(`[PayPilot] MCP server '${serverName}' updated successfully`);
      } else {
        console.warn(`[PayPilot] MCP server '${serverName}' not found for update`);
      }
    } catch (error) {
      console.error(`[PayPilot] Error updating MCP server '${serverName}':`, error);
      throw new Error(`Failed to update MCP server: ${error}`);
    }
  }

  /**
   * Test MCP server connectivity
   */
  async testMcpServer(serverName: string): Promise<boolean> {
    try {
      const servers = this.getMcpServers();
      const server = servers.find(s => s.name === serverName);
      
      if (!server) {
        console.error(`[PayPilot] MCP server '${serverName}' not found`);
        return false;
      }

      if (server.type === 'http' && server.url) {
        // Test HTTP server connectivity
        const response = await fetch(server.url, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        return response.ok;
      }

      // For command-based servers, we could check if the command exists
      // For now, just return true as we can't easily test without running
      console.log(`[PayPilot] Cannot test connectivity for server type '${server.type}'`);
      return true;
    } catch (error) {
      console.error(`[PayPilot] Error testing MCP server '${serverName}':`, error);
      return false;
    }
  }

  /**
   * Get MCP server by name
   */
  getMcpServer(serverName: string): McpServerConfig | undefined {
    const servers = this.getMcpServers();
    return servers.find(server => server.name === serverName);
  }

  /**
   * Check if a specific MCP server exists
   */
  hasMcpServer(serverName: string): boolean {
    return this.getMcpServer(serverName) !== undefined;
  }

  /**
   * Get recommended MCP servers for setup
   */
  getRecommendedServers(): McpServerConfig[] {
    return [
      {
        name: 'context7',
        type: 'http',
        url: 'https://mcp.context7.com/mcp'
      },
      // Add more recommended servers here as they become available
    ];
  }

  /**
   * Auto-setup recommended MCP servers
   */
  async setupRecommendedServers(): Promise<void> {
    const recommendedServers = this.getRecommendedServers();
    
    for (const server of recommendedServers) {
      if (!this.hasMcpServer(server.name)) {
        try {
          await this.addMcpServer(server);
          console.log(`[PayPilot] Auto-configured recommended MCP server: ${server.name}`);
        } catch (error) {
          console.error(`[PayPilot] Failed to auto-configure MCP server '${server.name}':`, error);
        }
      }
    }
  }

  /**
   * Validate MCP server configuration
   */
  validateServerConfig(config: McpServerConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name || config.name.trim() === '') {
      errors.push('Server name is required');
    }

    if (!config.type || config.type.trim() === '') {
      errors.push('Server type is required');
    }

    if (config.type === 'http' && (!config.url || config.url.trim() === '')) {
      errors.push('URL is required for HTTP servers');
    }

    if (config.type === 'command' && (!config.command || config.command.trim() === '')) {
      errors.push('Command is required for command-based servers');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get MCP service status
   */
  getStatus(): {
    enabled: boolean;
    totalServers: number;
    activeServers: string[];
    configuredServers: string[];
  } {
    const servers = this.getMcpServers();
    
    return {
      enabled: this.enableMcp,
      totalServers: servers.length,
      activeServers: [...this.activeServers],
      configuredServers: servers.map(s => s.name)
    };
  }

  /**
   * Reset MCP service state
   */
  reset(): void {
    this.enableMcp = false;
    this.activeServers = [];
    console.log('[PayPilot] MCP service state reset');
  }
}