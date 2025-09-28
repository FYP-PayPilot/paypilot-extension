import * as path from 'path';
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

interface CreateDirectoryInput {
  path: string;
  recursive?: boolean;
}

interface ReadFileInput {
  path: string;
  maxBytes?: number;
}

interface DeleteDirectoryInput {
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
  tools.push(registerCreateDirectoryTool(context));
  tools.push(registerReadFileTool(context));
  tools.push(registerDeleteDirectoryTool(context));

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
    async invoke(options, token) {
      try {
        enforceWorkspace();
        const targetUri = await resolveFileCreationTarget(options.input.path, token);
        if (!options.input.overwrite) {
          await assertNotExists(targetUri);
        }
        const payload = Buffer.from(options.input.contents ?? '', 'utf8');
        await vscode.workspace.fs.writeFile(targetUri, payload);
        return toToolResult(`Created ${relativeUriPath(targetUri)} (${payload.length} bytes).`);
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
        const uri = await resolveExistingEntry(options.input.path, token, 'file');
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
        const uri = await resolveExistingEntry(options.input.path, undefined, 'any');
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

function registerCreateDirectoryTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-createDirectory`,
    description: 'Create a directory within the workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path for the directory to create.',
        },
        recursive: {
          type: 'boolean',
          description: 'Create parent folders as needed. Defaults to true.',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<CreateDirectoryInput>(tool.name, {
    async invoke(options, token) {
      try {
        enforceWorkspace();
        const target = await resolveDirectoryCreationTarget(options.input.path, token);
        const recursive = options.input.recursive ?? true;
        if (!recursive) {
          try {
            await vscode.workspace.fs.stat(target.baseUri);
          } catch {
            throw new Error(`Parent directory of ${relativeUriPath(target.uri)} does not exist.`);
          }
        }
        await vscode.workspace.fs.createDirectory(target.uri);
        if (!recursive) {
          const stat = await vscode.workspace.fs.stat(target.uri);
          if (!(stat.type & vscode.FileType.Directory)) {
            throw new Error(`Failed to create directory at ${relativeUriPath(target.uri)}.`);
          }
        }
        return toToolResult(`Created directory ${relativeUriPath(target.uri)}.`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerDeleteDirectoryTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-deleteDirectory`,
    description: 'Remove a directory from the workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path of the directory to remove.',
        },
        recursive: {
          type: 'boolean',
          description: 'Delete directory contents recursively (defaults to true).',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<DeleteDirectoryInput>(tool.name, {
    async invoke(options, _token) {
      try {
        enforceWorkspace();
        const uri = await resolveExistingEntry(options.input.path, undefined, 'directory');
        const stat = await vscode.workspace.fs.stat(uri);
        if (!(stat.type & vscode.FileType.Directory)) {
          throw new Error(`"${relativeUriPath(uri)}" is not a directory.`);
        }

        await vscode.workspace.fs.delete(uri, {
          recursive: options.input.recursive ?? true,
          useTrash: false,
        });

        return toToolResult(`Deleted directory ${relativeUriPath(uri)}.`);
      } catch (error) {
        return toToolError(error);
      }
    },
  });

  context.subscriptions.push(disposable);
  return tool;
}

function registerReadFileTool(context: vscode.ExtensionContext): vscode.LanguageModelChatTool {
  const tool: vscode.LanguageModelChatTool = {
    name: `${PARTICIPANT_ID}-readFile`,
    description: 'Read the contents of a workspace file.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path of the file to read.',
        },
        maxBytes: {
          type: 'integer',
          minimum: 1,
          maximum: 20000,
          description: 'Optional limit on the number of UTF-8 bytes to return. Defaults to 6000.',
        },
      },
    },
  };

  const disposable = vscode.lm.registerTool<ReadFileInput>(tool.name, {
    async invoke(options, token) {
      try {
        enforceWorkspace();
        const uri = await resolveExistingEntry(options.input.path, token, 'file');
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory) {
          throw new Error(`"${relativeUriPath(uri)}" is a directory.`);
        }

        const maxBytes = Math.min(Math.max(options.input.maxBytes ?? 6000, 1), 20000);
        const contents = await vscode.workspace.fs.readFile(uri);
        let text = Buffer.from(contents).toString('utf8');
        let suffix = '';
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          text = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
          suffix = `\n\n(truncated to ${maxBytes} bytes)`;
        }

        return toToolResult(`### ${relativeUriPath(uri)}\n\n\`\`\`\n${text}\n\`\`\`${suffix}`);
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


async function resolveExistingEntry(
  candidate: string,
  token?: vscode.CancellationToken,
  expectedKind: 'file' | 'directory' | 'any' = 'any'
): Promise<vscode.Uri> {
  const entries = await collectCandidateEntries(candidate, token);
  const filtered = filterCandidatesByKind(entries, expectedKind);
  if (filtered.length === 0) {
    const hint = entries.length
      ? entries.slice(0, 10).map((entry) => `- ${entry.relativePath}`).join('\n')
      : undefined;
    const kindLabel = expectedKind === 'any' ? 'entry' : expectedKind;
    throw new Error(
      `Could not find a ${kindLabel} matching "${candidate}" within the workspace.` +
        (hint ? `\nDid you mean:\n${hint}` : '')
    );
  }
  return filtered[0].uri;
}

function normalizeCandidate(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');
}

function toGlobPattern(candidate: string): string {
  const normalized = normalizeCandidate(candidate);
  if (!normalized) {
    return '**/*';
  }
  if (hasGlobSyntax(normalized) || normalized.startsWith('../') || normalized.startsWith('/')) {
    return normalized;
  }
  return `**/${normalized}`;
}

interface CandidateEntry {
  uri: vscode.Uri;
  stat: vscode.FileStat;
  relativePath: string;
  score: number;
}

async function collectCandidateEntries(candidate: string, token?: vscode.CancellationToken): Promise<CandidateEntry[]> {
  const normalized = normalizeCandidate(candidate);
  const patterns = buildSearchPatterns(normalized);
  const seen = new Map<string, CandidateEntry>();

  await addCandidateFromPath(normalized, seen);

  for (const pattern of patterns) {
    const matches = await vscode.workspace.findFiles(pattern, undefined, 25, token);
    for (const match of matches) {
      await addCandidate(match, seen);
    }
  }

  const entries = Array.from(seen.values());
  const targetLower = normalized.toLowerCase();
  for (const entry of entries) {
    entry.score = computeCandidateScore(targetLower, entry);
  }

  entries.sort((a, b) => b.score - a.score);
  return entries;
}

async function addCandidateFromPath(candidate: string, seen: Map<string, CandidateEntry>): Promise<void> {
  if (!candidate) {
    return;
  }
  try {
    const uri = resolveWorkspaceUri(candidate);
    await addCandidate(uri, seen);
  } catch {
    // Ignore when explicit path cannot be resolved
  }
}

async function addCandidate(uri: vscode.Uri, seen: Map<string, CandidateEntry>): Promise<void> {
  const key = uri.toString();
  if (seen.has(key)) {
    return;
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    seen.set(key, {
      uri,
      stat,
      relativePath: normalizeCandidate(relativeUriPath(uri)),
      score: 0,
    });
  } catch {
    // Skip entries that disappeared between search and stat
  }
}

function filterCandidatesByKind(entries: CandidateEntry[], kind: 'file' | 'directory' | 'any'): CandidateEntry[] {
  if (kind === 'any') {
    return entries;
  }
  return entries.filter((entry) => {
    const isDirectory = Boolean(entry.stat.type & vscode.FileType.Directory);
    return kind === 'directory' ? isDirectory : !isDirectory;
  });
}

function buildSearchPatterns(candidate: string): string[] {
  if (!candidate) {
    return ['**/*'];
  }

  const patterns = new Set<string>();
  const variants = new Set<string>();

  variants.add(candidate);
  variants.add(candidate.replace(/\s+/g, '-'));
  variants.add(candidate.replace(/\s+/g, '_'));
  variants.add(candidate.replace(/-/g, ' '));
  variants.add(candidate.replace(/_/g, ' '));

  const sanitized = sanitizeForComparison(candidate);
  if (sanitized && sanitized !== candidate) {
    variants.add(sanitized);
  }

  for (const variant of variants) {
    if (!variant) {
      continue;
    }
    patterns.add(toGlobPattern(variant));
  }

  const basename = path.posix.basename(candidate);
  if (basename) {
    patterns.add(`**/${basename}`);
    if (!basename.includes('*')) {
      patterns.add(`**/*${basename}*`);
    }
  }

  const segments = candidate.split('/');
  if (segments.length > 1) {
    const lastTwo = segments.slice(-2).join('/');
    patterns.add(`**/${lastTwo}`);
    const lastTwoSanitized = sanitizeForComparison(lastTwo);
    if (lastTwoSanitized && lastTwoSanitized !== lastTwo) {
      patterns.add(`**/${lastTwoSanitized}`);
    }
  }

  return Array.from(patterns);
}

function computeCandidateScore(targetLower: string, entry: CandidateEntry): number {
  const candidateLower = entry.relativePath.toLowerCase();
  const targetBase = path.posix.basename(targetLower);
  const candidateBase = path.posix.basename(candidateLower);
  const sanitizedTarget = sanitizeForComparison(targetLower);
  const sanitizedCandidate = sanitizeForComparison(candidateLower);
  const sanitizedTargetBase = sanitizeForComparison(targetBase);
  const sanitizedCandidateBase = sanitizeForComparison(candidateBase);

  let score = 0;
  if (candidateLower === targetLower) {
    score += 1000;
  }
  if (candidateLower.endsWith(targetLower)) {
    score += 600;
  }
  if (targetLower.endsWith(candidateLower)) {
    score += 500;
  }
  if (candidateBase === targetBase) {
    score += 400;
  }
  if (candidateBase.includes(targetBase) || targetBase.includes(candidateBase)) {
    score += 250;
  }
  if (sanitizedCandidate === sanitizedTarget) {
    score += 800;
  }
  if (sanitizedCandidateBase === sanitizedTargetBase) {
    score += 500;
  }

  const distance = levenshteinDistance(candidateLower, targetLower);
  const maxLen = Math.max(candidateLower.length, targetLower.length, 1);
  score += Math.max(0, (maxLen - distance)) * 5;

  const sanitizedDistance = levenshteinDistance(sanitizedCandidate, sanitizedTarget);
  const sanitizedMaxLen = Math.max(sanitizedCandidate.length, sanitizedTarget.length, 1);
  score += Math.max(0, (sanitizedMaxLen - sanitizedDistance)) * 3;

  return score;
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[rows - 1][cols - 1];
}

function sanitizeForComparison(value: string): string {
  return value.replace(/[-_\s]/g, '');
}

async function resolveFileCreationTarget(pathCandidate: string, token?: vscode.CancellationToken): Promise<vscode.Uri> {
  const normalized = normalizeCandidate(pathCandidate);
  if (!normalized) {
    throw new Error('Provide a relative path for the new file.');
  }
  const segments = normalized.split('/');
  const fileName = segments.pop();
  if (!fileName) {
    throw new Error('Provide a file name for the new file.');
  }
  const directoryCandidate = segments.join('/');
  const baseDirectory = await resolveDirectoryForCreation(directoryCandidate, token);
  return vscode.Uri.joinPath(baseDirectory, fileName);
}

async function resolveDirectoryCreationTarget(pathCandidate: string, token?: vscode.CancellationToken): Promise<{ uri: vscode.Uri; baseUri: vscode.Uri }> {
  const normalized = normalizeCandidate(pathCandidate);
  if (!normalized) {
    throw new Error('Provide a directory path to create.');
  }

  const segments = normalized.split('/');
  const directoryName = segments.pop();
  if (!directoryName) {
    throw new Error('Provide a directory name to create.');
  }

  const parentCandidate = segments.join('/');
  const baseDirectory = await resolveDirectoryForCreation(parentCandidate, token);
  const targetUri = vscode.Uri.joinPath(baseDirectory, directoryName);
  return { uri: targetUri, baseUri: baseDirectory };
}

async function resolveDirectoryForCreation(pathCandidate: string, token?: vscode.CancellationToken): Promise<vscode.Uri> {
  const normalized = normalizeCandidate(pathCandidate);
  if (!normalized) {
    const [root] = requireWorkspaceFolders(WORKSPACE_ERROR);
    return root.uri;
  }
  const entries = await collectCandidateEntries(normalized, token);
  const directories = filterCandidatesByKind(entries, 'directory');
  if (directories.length > 0) {
    return directories[0].uri;
  }
  return resolveWorkspaceUri(normalized);
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
