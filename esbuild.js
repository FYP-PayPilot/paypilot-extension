const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Copy media files to dist
 */
function copyMediaFiles() {
	const destMediaDir = path.join(__dirname, 'dist', 'media');
	
	if (!fs.existsSync(destMediaDir)) {
		fs.mkdirSync(destMediaDir, { recursive: true });
	}
	
	// Copy the main CSS file
	const srcCssFile = path.join(__dirname, 'src', 'media', 'global.css');
	const destCssFile = path.join(destMediaDir, 'global.css');
	
	if (fs.existsSync(srcCssFile)) {
		fs.copyFileSync(srcCssFile, destCssFile);
		console.log('Copied global.css to dist/media/');
	}
	
	// Copy src/media files
	const srcMediaDir = path.join(__dirname, 'src', 'media');
	
	if (fs.existsSync(srcMediaDir)) {
		const files = fs.readdirSync(srcMediaDir);
		for (const file of files) {
			const srcFile = path.join(srcMediaDir, file);
			const destFile = path.join(destMediaDir, file);
			fs.copyFileSync(srcFile, destFile);
			console.log(`Copied ${file} to dist/media/`);
		}
	}
	
	// Copy root media files (like icons)
	const rootMediaDir = path.join(__dirname, 'media');
	
	if (fs.existsSync(rootMediaDir)) {
		const files = fs.readdirSync(rootMediaDir);
		for (const file of files) {
			const srcFile = path.join(rootMediaDir, file);
			const destFile = path.join(destMediaDir, file);
			fs.copyFileSync(srcFile, destFile);
			console.log(`Copied ${file} to dist/media/`);
		}
	}
}

async function main() {
	// Build extension (Node.js)
	const extensionCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	// Build webview React app (Browser)
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/media/webview.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
		define: {
			'process.env.NODE_ENV': production ? '"production"' : '"development"'
		},
		jsx: 'automatic',
		jsxImportSource: 'react'
	});
	
	// Copy media files
	copyMediaFiles();
	
	if (watch) {
		await Promise.all([
			extensionCtx.watch(),
			webviewCtx.watch()
		]);
	} else {
		await Promise.all([
			extensionCtx.rebuild(),
			webviewCtx.rebuild()
		]);
		await Promise.all([
			extensionCtx.dispose(),
			webviewCtx.dispose()
		]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
