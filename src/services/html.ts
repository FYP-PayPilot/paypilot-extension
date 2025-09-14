import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * HTML Service for VS Code Webview
 * 
 * Generates complete HTML documents for the webview panel that contains the React chat interface.
 * Handles security (CSP, nonces), CSS embedding, and proper VS Code webview integration.
 * 
 * 1. This service creates an HTML document with a <div id="root"> element
 * 2. The bundled React app (from src/webview/) is loaded via a <script> tag
 * 3. React mounts to the #root element and renders the entire chat interface
 * 4. CSS is embedded directly in the HTML to ensure reliable styling in the webview
 * 5. Security nonces prevent XSS attacks while allowing the React app to execute
 * 
 * SCRIPT TAG & REACT RENDERING:
 * - uris.scriptUri points to the bundled React app (dist/webview.js)
 * - This bundle contains all React components, hooks, and the entry point (index.tsx)
 * - When the script loads, it automatically calls ReactDOM.createRoot() and renders <App />
 * - The webview.asWebviewUri() ensures the script URL is secure and properly formatted for VS Code
 * - The nonce attribute allows the script to execute despite Content Security Policy restrictions
 */
/**
 * Generates a complete HTML document for the VS Code webview panel
 * 
 * Creates a secure, self-contained HTML document that serves as the container for the React chat application.
 * 
 * @param webview - VS Code webview instance for security context
 * @param extUri - Extension root URI for locating CSS files
 * @param uris - Object containing webview URIs for script and style resources
 * @returns Complete HTML document string ready for webview.html assignment
 */
export function getWebviewHtml(
  webview: vscode.Webview,
  extUri: vscode.Uri,
  uris: { scriptUri: vscode.Uri; styleUri: vscode.Uri }
) {
  const nonce = getNonce();
  
  // Configure Content Security Policy for XSS prevention
  const csp = [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline' 'self'",
    `script-src 'nonce-${nonce}'`,
    "connect-src https: http:"
  ].join('; ');

  // Embed CSS directly to avoid webview loading issues
  let cssContent = '';
  try {
    const cssPath = path.join(extUri.fsPath, 'dist', 'media', 'global.css');
    cssContent = fs.readFileSync(cssPath, 'utf8');
  } catch (error) {
    console.error('Failed to read CSS file:', error);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PayPilot</title>
  <style>
    ${cssContent}
  </style>
</head>
<body>
  <div id="root"></div>
  <!-- 
    Script loads the bundled React app (dist/webview.js created by esbuild)
    - uris.scriptUri: Secure webview URI pointing to the React bundle
    - nonce: Security token allowing script execution despite CSP
    - Bundle contains: React components, hooks, context, and index.tsx entry point
    - On load: Automatically calls ReactDOM.createRoot(document.getElementById('root')).render(<App />)
  -->
  <script nonce="${nonce}" src="${uris.scriptUri}"></script>
</body>
</html>`;
}

/**
 * Generates a cryptographically secure random nonce for Content Security Policy
 * 
 * @returns A 32-character random alphanumeric string
 */
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return nonce;
}