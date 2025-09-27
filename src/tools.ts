import * as vscode from 'vscode';
import {
  relativeUriPath,
  requireWorkspaceFolders,
  resolveWorkspaceUri,
} from './utils/workspace';

const PARTICIPANT_ID = 'paypilot';

interface WorkspaceContextInput {
  paths?: string[];
  glob?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  includeText?: boolean;
}

interface CreateFileInput {
  path: string;
  contents?: string;
  overwrite?: boolean;
}

interface UpdateFileInput {
  path: string;
  newText: string;
  range?: {
    start: PositionInput;
    end: PositionInput;
  };
}

interface DeleteFileInput {
  path: string;
  recursive?: boolean;
}

interface PositionInput {
  line: number;
  character: number;
}

export interface PaypilotToolset {
  chatTools: vscode.LanguageModelChatTool[];
}

const WORKSPACE_ERROR = 'Open a workspace folder before invoking this tool.';

export function registerPaypilotTools(context: vscode.ExtensionContext): PaypilotToolset {
  const tools: vscode.LanguageModelChatTool[] = [];

  tools.push(registerWorkspaceContextTool(context));
  tools.push(registerCreateFileTool(context));
  tools.push(registerUpdateFileTool(context));
  tools.push(registerDeleteFileTool(context));

  return { chatTools: tools };
}

function registerWorkspaceContextTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-workspaceContext`,
    description: 'Read snippets of files or list directory contents in the current workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paths: {
          type: 'array',
          description: 'Relative file or folder paths to read. Paths are resolved against the first matching workspace folder.',
          items: { type: 'string' },
        },
        glob: {
          type: 'string',
          description: 'Glob pattern (VS Code style) scoped to the workspace root used to gather files when paths are not supplied.',
        },
        maxFiles: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of files to return when using "glob". Defaults to 5.',
        },
        maxBytesPerFile: {
          type: 'integer',
          minimum: 1,
          maximum: 20000,
          description: 'Approximate upper bound of UTF-8 bytes to return per file. Defaults to 6000.',
        },
        includeText: {
          type: 'boolean',
          description: 'When false, only metadata (file names, sizes) is returned instead of file contents. Defaults to true.',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<WorkspaceContextInput>(tool.name, {
    async invoke(options, token) {
      try {
        enforceWorkspace();
        const result = await gatherWorkspaceContext(options.input, token);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerCreateFileTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createFile`,
    description: 'Create a new text file in the workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the new file. Use forward slashes. Must reside within the workspace.',
        },
        contents: {
          type: 'string',
          description: 'UTF-8 contents to write into the file. Defaults to the empty string.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Allow replacing an existing file. Defaults to false.',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<CreateFileInput>(tool.name, {
    async invoke(options, _token) {
      try {
        enforceWorkspace();
        const uri = resolveWorkspaceUri(options.input.path);
        if (!options.input.overwrite) {
          await assertNotExists(uri);
        }
        const payload = Buffer.from(options.input.contents ?? '', 'utf8');
        await vscode.workspace.fs.writeFile(uri, payload);
        return toToolResult(`Created ${relativeUriPath(uri)} (${payload.length} bytes).`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerUpdateFileTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-updateFile`,
    description: 'Apply text edits to a file in the workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'newText'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file to update.',
        },
        newText: {
          type: 'string',
          description: 'Replacement text that will be inserted at the provided range, or replace the entire file when the range is omitted.',
        },
        range: {
          type: 'object',
          description: 'Inclusive start/exclusive end range to replace. Omit to replace the entire file.',
          required: ['start', 'end'],
          properties: {
            start: positionSchema('Start position of the replacement range.'),
            end: positionSchema('End position of the replacement range.'),
          },
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<UpdateFileInput>(tool.name, {
    async invoke(options, token) {
      try {
        enforceWorkspace();
        const uri = await resolveExistingEntry(options.input.path, token);
        const document = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        const targetRange = options.input.range
          ? new vscode.Range(
              toPosition(options.input.range.start),
              toPosition(options.input.range.end)
            )
          : new vscode.Range(
              new vscode.Position(0, 0),
              document.lineAt(document.lineCount - 1).range.end
            );

        edit.replace(uri, targetRange, options.input.newText);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
          throw new Error(`Failed to update ${relativeUriPath(uri)}.`);
        }

        await document.save();
        return toToolResult(`Updated ${relativeUriPath(uri)}.`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerDeleteFileTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-deleteFile`,
    description: 'Delete a file or folder inside the workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file or folder to delete.',
        },
        recursive: {
          type: 'boolean',
          description: 'When true, delete directories recursively.',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<DeleteFileInput>(tool.name, {
    async invoke(options, _token) {
      try {
        enforceWorkspace();
        const uri = await resolveExistingEntry(options.input.path);
        await vscode.workspace.fs.delete(uri, { recursive: options.input.recursive ?? false, useTrash: false });
        return toToolResult(`Deleted ${relativeUriPath(uri)}.`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}


async function gatherWorkspaceContext(input: WorkspaceContextInput, token: vscode.CancellationToken): Promise<string> {
  const maxFiles = Math.min(Math.max(input.maxFiles ?? 5, 1), 20);
  const maxBytes = Math.min(Math.max(input.maxBytesPerFile ?? 6000, 1), 20000);
  const includeText = input.includeText ?? true;

  const uris: vscode.Uri[] = [];
  const seen = new Set<string>();
  const addUri = (uri: vscode.Uri) => {
    const key = uri.toString();
    if (!seen.has(key)) {
      uris.push(uri);
      seen.add(key);
    }
  };

  const patterns = new Set<string>();

  if (input.paths && input.paths.length > 0) {
    for (const rawCandidate of input.paths) {
      if (token.isCancellationRequested) {
        break;
      }
      const candidate = rawCandidate.trim();
      if (!candidate) {
        continue;
      }
      try {
        const uri = resolveWorkspaceUri(candidate);
        try {
          await vscode.workspace.fs.stat(uri);
          addUri(uri);
          if (uris.length >= maxFiles) {
            break;
          }
          continue;
        } catch (error) {
          if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
            throw error;
          }
        }
      } catch {
        // If the direct path cannot be resolved or is missing, fall back to glob search.
      }
      patterns.add(toGlobPattern(candidate));
    }
  }

  if (input.glob) {
    patterns.add(input.glob);
  }

  for (const pattern of patterns) {
    if (token.isCancellationRequested || uris.length >= maxFiles) {
      break;
    }
    const remaining = maxFiles - uris.length;
    if (remaining <= 0) {
      break;
    }
    const matches = await vscode.workspace.findFiles(pattern, undefined, remaining, token);
    for (const match of matches) {
      addUri(match);
      if (uris.length >= maxFiles) {
        break;
      }
    }
  }

  if (uris.length === 0) {
    const roots = vscode.workspace.workspaceFolders ?? [];
    const hint = roots.map(folder => `- ${folder.name} (${folder.uri.fsPath})`).join('\n');
    return `No matching files found. Workspace root(s):
${hint}`;
  }

  const out: string[] = [];
  for (const uri of uris.slice(0, maxFiles)) {
    if (token.isCancellationRequested) {
      break;
    }
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const preview = entries
        .map(([name, type]) => `${name}${type & vscode.FileType.Directory ? '/' : ''}`)
        .slice(0, 20)
        .join(', ');
      out.push(`### ${relativeUriPath(uri)}/
Contains: ${preview}`);
      continue;
    }

    if (!includeText) {
      out.push(`### ${relativeUriPath(uri)} (${stat.size} bytes)`);
      continue;
    }

    const contents = await vscode.workspace.fs.readFile(uri);
    let text = new TextDecoder('utf-8').decode(contents);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      text = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
      out.push(`### ${relativeUriPath(uri)} (truncated to ${maxBytes} bytes)

\`\`\`
${text}
\`\`\``);
    } else {
      out.push(`### ${relativeUriPath(uri)}

\`\`\`
${text}
\`\`\``);
    }
  }

  return out.join('\n\n');
}

async function assertNotExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
    throw new Error(`"${relativeUriPath(uri)}" already exists.`);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return;
    }
    if (error instanceof vscode.FileSystemError && error.code === 'EntryExists') {
      throw new Error(`"${relativeUriPath(uri)}" already exists.`);
    }
    if (error instanceof vscode.FileSystemError) {
      return;
    }
    throw error;
  }
}

function enforceWorkspace(): void {
  requireWorkspaceFolders(WORKSPACE_ERROR);
}


function toGlobPattern(candidate: string): string {
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (hasGlobSyntax(normalized)) {
    return normalized;
  }
  if (normalized.startsWith('../') || normalized.startsWith('/')) {
    return normalized;
  }
  return `**/${normalized}`;
}

async function resolveExistingEntry(candidate: string, token?: vscode.CancellationToken): Promise<vscode.Uri> {
  const uri = resolveWorkspaceUri(candidate);

  try {
    await vscode.workspace.fs.stat(uri);
    return uri;
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
      throw error;
    }
  }

  const pattern = toGlobPattern(candidate);
  const matches = await vscode.workspace.findFiles(pattern, undefined, 5, token);

  if (matches.length === 0) {
    throw new Error(`Could not find "${candidate}" within the workspace.`);
  }

  if (matches.length > 1) {
    const hint = matches
      .map(match => `- ${relativeUriPath(match)}`)
      .join('\n');
    throw new Error(`Multiple matches found for "${candidate}". Please provide a more specific path:\n${hint}`);
  }

  return matches[0];
}

function hasGlobSyntax(value: string): boolean {
  return /[\*\?\{\}\[\]]/.test(value);
}

function toPosition(input: PositionInput): vscode.Position {
  return new vscode.Position(input.line, input.character);
}

function positionSchema(description: string): object {
  return {
    type: 'object',
    additionalProperties: false,
    description,
    required: ['line', 'character'],
    properties: {
      line: { type: 'integer', minimum: 0 },
      character: { type: 'integer', minimum: 0 },
    },
  };
}

function toToolResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function toToolError(error: unknown): vscode.LanguageModelToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return toToolResult(`Error: ${message}`);
}
