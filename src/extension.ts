// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { registerPaypilotTools } from './tools';

// define the system prompt for the chat participant
const BASE_PROMPT = "You are Paypilot, a VS Code chat participant that helps developers integrate PayPal into their applications. Walk the user through PayPal concepts step by step, offer short code samples or API references sourced from current PayPal documentation when helpful, and explain why each step matters. Ask clarifying questions before assuming context, encourage the user to try tasks themselves, and point out testing or sandbox requirements where relevant. When the user explicitly requests a code change or phrases a question as an instruction to modify code, respond with the edited code and concise guidance on how to apply it. Use the available tools (`paypilot.workspaceContext`, `paypilot.createFile`, `paypilot.updateFile`, `paypilot.deleteFile`) whenever you need project context or have to apply filesystem changes instead of asking the user to do so manually. If the question is unrelated to PayPal payments or developer tooling, politely decline to answer.";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const toolset = registerPaypilotTools(context);

	// create the request handler that is responsible for processing the user's chat requests in the VS Code chat view
	const handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) => {

		const conversation: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(BASE_PROMPT)
		];

		const previousMessages = context.history.filter(
			h => h instanceof vscode.ChatResponseTurn
		);

		previousMessages.forEach(historyEntry => {
			let fullMessage = '';
			historyEntry.response.forEach(part => {
				const mdPart = part as vscode.ChatResponseMarkdownPart;
				fullMessage += mdPart.value.value;
			});
			if (fullMessage.trim().length > 0) {
				conversation.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
			}
		});

		conversation.push(vscode.LanguageModelChatMessage.User(request.prompt));

		await runChatLoop(conversation, request, stream, token, toolset.chatTools);

		return;

	};
	async function runChatLoop(
		conversation: vscode.LanguageModelChatMessage[],
		req: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		tools: vscode.LanguageModelChatTool[]
	): Promise<void> {
		while (!token.isCancellationRequested) {
			const response = await req.model.sendRequest(conversation, {
				tools,
				toolMode: vscode.LanguageModelChatToolMode.Auto
			}, token);

			const toolCalls: vscode.LanguageModelToolCallPart[] = [];
			let assistantBuffer = '';

			for await (const part of response.stream) {
				if (token.isCancellationRequested) {
					return;
				}
				if (part instanceof vscode.LanguageModelTextPart) {
					assistantBuffer += part.value;
					if (part.value) {
						stream.markdown(part.value);
					}
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					toolCalls.push(part);
				}
			}

			if (assistantBuffer.trim().length > 0) {
				conversation.push(vscode.LanguageModelChatMessage.Assistant(assistantBuffer));
			}

			if (toolCalls.length === 0) {
				return;
			}

			for (const call of toolCalls) {
				let toolResult: vscode.LanguageModelToolResult;

				try {
					toolResult = await vscode.lm.invokeTool(call.name, {
						toolInvocationToken: req.toolInvocationToken,
						input: call.input
					}, token);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const errorPart = new vscode.LanguageModelTextPart(`Error: ${message}`);
					toolResult = new vscode.LanguageModelToolResult([errorPart]);
				}

				conversation.push(vscode.LanguageModelChatMessage.Assistant([call]));

				const resultPart = new vscode.LanguageModelToolResultPart(call.callId, toolResult.content);
				conversation.push(vscode.LanguageModelChatMessage.User([resultPart]));

				const displayText = formatToolResult(toolResult);
				if (displayText.trim().length > 0) {
					stream.markdown(displayText);
				}
			}
		}
	}

	function formatToolResult(result: vscode.LanguageModelToolResult): string {
		const rendered: string[] = [];

		for (const part of result.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				const value = part.value.trim();
				if (value.length > 0) {
					rendered.push(value);
				}
			} else if (part instanceof vscode.LanguageModelPromptTsxPart) {
				rendered.push('Tool returned structured content.');
			} else if (typeof part === 'string') {
				const value = part.trim();
				if (value.length > 0) {
					rendered.push(value);
				}
			} else if (part !== undefined && part !== null) {
			try {
				rendered.push(JSON.stringify(part));
			} catch {
				rendered.push(String(part));
			}
		}
		}

		const summary = rendered.join('\n\n').trim();
		return summary || 'Tool completed without additional details.';
	}

	// register the chat participant and the request handler
	const paypilot = vscode.chat.createChatParticipant("paypilot", handler);

	// TODO: add icon to participant

	

}

// This method is called when your extension is deactivated
export function deactivate() {}
