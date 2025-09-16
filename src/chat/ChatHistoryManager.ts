import * as vscode from 'vscode';
import { ChatMessage, ChatSession, ChatHistory } from '../types/chat';
import { ContextManager } from './ContextManager';

export class ChatHistoryManager {
    private static readonly STORAGE_KEY = 'paypilot.chatHistory';
    private context: vscode.ExtensionContext;
    private history: ChatHistory;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.history = this.loadHistory();
    }

    private loadHistory(): ChatHistory {
        const history = this.context.globalState.get<ChatHistory>(ChatHistoryManager.STORAGE_KEY);
        return history || { sessions: [] };
    }

    private async saveHistory(): Promise<void> {
        await this.context.globalState.update(ChatHistoryManager.STORAGE_KEY, this.history);
    }

    public async createSession(): Promise<string> {
        const session: ChatSession = {
            id: Date.now().toString(),
            messages: [],
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            context: ContextManager.createInitialContext()
        };

        this.history.sessions.push(session);
        this.history.activeSessionId = session.id;
        await this.saveHistory();
        return session.id;
    }

    public async addMessage(
        sessionId: string, 
        message: Omit<ChatMessage, 'timestamp'>,
        editor?: vscode.TextEditor
    ): Promise<void> {
        const session = this.history.sessions.find(s => s.id === sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const contextualMessage = await ContextManager.createContextualMessage(
            message.content,
            message.role,
            editor
        );

        session.messages.push(contextualMessage);
        session.lastUpdated = Date.now();
        await this.saveHistory();
    }

    public getSessionContext(sessionId: string): string {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const editor = vscode.window.activeTextEditor;
        return ContextManager.buildContext(session, editor?.document);
    }

    public getSession(sessionId: string): ChatSession | undefined {
        return this.history.sessions.find(s => s.id === sessionId);
    }

    public getActiveSession(): ChatSession | undefined {
        return this.history.activeSessionId 
            ? this.getSession(this.history.activeSessionId)
            : undefined;
    }

    public async setActiveSession(sessionId: string): Promise<void> {
        if (!this.getSession(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        this.history.activeSessionId = sessionId;
        await this.saveHistory();
    }

    public getAllSessions(): ChatSession[] {
        return [...this.history.sessions];
    }

    public async deleteSession(sessionId: string): Promise<void> {
        this.history.sessions = this.history.sessions.filter(s => s.id !== sessionId);
        if (this.history.activeSessionId === sessionId) {
            this.history.activeSessionId = undefined;
        }
        await this.saveHistory();
    }

    public async clearAllHistory(): Promise<void> {
        this.history.sessions = [];
        this.history.activeSessionId = undefined;
        await this.saveHistory();
    }

    public async updateSessionTopic(sessionId: string, topic: string): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        session.topic = topic;
        await this.saveHistory();
    }

    // Optional: implement session limit
    public async enforceSessionLimit(maxSessions: number): Promise<void> {
        if (this.history.sessions.length > maxSessions) {
            // Keep only the most recent sessions
            this.history.sessions = this.history.sessions
                .sort((a, b) => b.lastUpdated - a.lastUpdated)
                .slice(0, maxSessions);
            await this.saveHistory();
        }
    }
}
