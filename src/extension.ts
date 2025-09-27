// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// define the system prompt for the chat participant
const BASE_PROMPT = "You are Paypilot, a VS Code chat participant that helps developers integrate PayPal into their applications. Walk the user through PayPal concepts step by step, offer short code samples or API references sourced from current PayPal documentation when helpful, and explain why each step matters. Ask clarifying questions before assuming context, encourage the user to try tasks themselves, and point out testing or sandbox requirements where relevant. When the user explicitly requests a code change or phrases a question as an instruction to modify code, respond with the edited code and concise guidance on how to apply it. If the question is unrelated to PayPal payments or developer tooling, politely decline to answer.";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// create the request handler that is responsible for processing the user's chat requests in the VS Code chat view
	const handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) => {

		// initialise the prompt
		let prompt = BASE_PROMPT;

		// initialise messages array with the system prompt
		const messages = [vscode.LanguageModelChatMessage.User(prompt)];

		// add in previous messages from the chat context
		const previousMessages = context.history.filter(
			h => h instanceof vscode.ChatResponseTurn
		);

		// add the previous messages to the messages array
		previousMessages.forEach(m => {
			let fullMessage = '';
			m.response.forEach(r => {
				const mdPart = r as vscode.ChatResponseMarkdownPart;
				fullMessage += mdPart.value.value;
			});
			messages.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
		});

		// add in the user's message
		messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

		// send the request to the chat model
		const chatResponse = await request.model.sendRequest(messages, {}, token);

		// stream the response
		for await (const fragment of chatResponse.text) {
			stream.markdown(fragment);
		}

		return;

	};
	// register the chat participant and the request handler
	const paypilot = vscode.chat.createChatParticipant("paypilot", handler);

	// TODO: add icon to participant

	

}

// This method is called when your extension is deactivated
export function deactivate() {}
