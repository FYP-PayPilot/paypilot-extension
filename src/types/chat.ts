export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    contextFiles?: string[];  // Files related to this message
    codeSnippets?: Array<{
        code: string;
        language: string;
        path?: string;
    }>;  // Code snippets referenced or generated
}

export interface ChatContext {
    recentMessages: number;  // Number of recent messages to include for context
    relevantFiles?: string[];  // Currently open or relevant files
    projectContext?: string;  // Current project/workspace context
}

export interface ChatSession {
    id: string;
    messages: ChatMessage[];
    createdAt: number;
    lastUpdated: number;
    context: ChatContext;
    topic?: string;  // Optional topic/summary of the conversation
}

export interface ChatHistory {
    sessions: ChatSession[];
    maxSessions?: number;  // Optional limit on number of sessions to keep
    activeSessionId?: string;  // Currently active session
}
