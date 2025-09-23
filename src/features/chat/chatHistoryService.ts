import { ChatSessionSummary } from "../../types/chat";

/**
 * Lightweight placeholder for chat session/history management. Today it keeps an
 * in-memory list so the rest of the system has a consistent seam to call into.
 * When real persistence is added this class will own it.
 */
export class ChatHistoryService {
  private readonly sessions: ChatSessionSummary[] = [];

  /**
   * Create a new session stub and return it.
   * The title is optional and can be updated later.
   * @param title Optional title for the new session.
   */
  createSession(title?: string): ChatSessionSummary {
    const session: ChatSessionSummary = {
      id: `session-${Date.now()}`,
      title: title?.trim() || "Untitled session",
      createdAt: new Date().toISOString(),
    };
    this.sessions.unshift(session);
    return session;
  }

  /**
   * Return the currently tracked sessions. Clone the array so callers cannot mutate it.
   * Just an in-memory list, but when persistence is added this will return the persisted sessions.
   * @returns Array of ChatSessionSummary objects.
   */
  listSessions(): ChatSessionSummary[] {
    return [...this.sessions];
  }
}
