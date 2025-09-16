import * as vscode from 'vscode';
import { ChatMessage, ChatContext, ChatSession } from '../types/chat';

export class ContextManager {
    private static readonly DEFAULT_CONTEXT_MESSAGES = 10;

    /**
     * Builds context for the AI from the current session
     */
    public static buildContext(
        session: ChatSession,
        currentFile?: vscode.TextDocument
    ): string {
        const context: string[] = [];
        
        // Add session topic if available
        if (session.topic) {
            context.push(`Current conversation topic: ${session.topic}`);
        }

        // Add current file context if available
        if (currentFile) {
            context.push(`Current file: ${currentFile.fileName}`);
            session.context.relevantFiles = [
                ...(session.context.relevantFiles || []),
                currentFile.fileName
            ];
        }

        // Get recent messages for context
        const recentMessages = session.messages.slice(
            Math.max(0, session.messages.length - session.context.recentMessages)
        );

        // Format conversation history
        const conversationContext = recentMessages.map(msg => {
            let messageContext = `${msg.role}: ${msg.content}`;
            
            // Add file context if available
            if (msg.contextFiles?.length) {
                messageContext += `\nRelated files: ${msg.contextFiles.join(', ')}`;
            }
            
            // Add code snippets if available
            if (msg.codeSnippets?.length) {
                msg.codeSnippets.forEach(snippet => {
                    messageContext += `\nCode snippet (${snippet.language})${snippet.path ? ` from ${snippet.path}` : ''}:\n${snippet.code}`;
                });
            }
            
            return messageContext;
        }).join('\n\n');

        context.push(conversationContext);

        return context.join('\n\n');
    }

    /**
     * Creates a new message with context
     */
    public static async createContextualMessage(
        content: string,
        role: 'user' | 'assistant',
        editor?: vscode.TextEditor
    ): Promise<ChatMessage> {
        const message: ChatMessage = {
            role,
            content,
            timestamp: Date.now(),
            contextFiles: [],
            codeSnippets: []
        };

        // Add current file context if available
        if (editor) {
            const document = editor.document;
            message.contextFiles?.push(document.fileName);

            // If there's a selection, add it as a code snippet
            const selection = editor.selection;
            if (!selection.isEmpty) {
                const selectedText = document.getText(selection);
                message.codeSnippets?.push({
                    code: selectedText,
                    language: document.languageId,
                    path: document.fileName
                });
            }
        }

        return message;
    }

    /**
     * Updates the context settings for a session
     */
    public static updateSessionContext(
        session: ChatSession,
        updates: Partial<ChatContext>
    ): ChatSession {
        return {
            ...session,
            context: {
                ...session.context,
                ...updates
            }
        };
    }

    /**
     * Initializes default context for a new session
     */
    public static createInitialContext(): ChatContext {
        return {
            recentMessages: this.DEFAULT_CONTEXT_MESSAGES,
            relevantFiles: [],
            projectContext: vscode.workspace.name
        };
    }
}
