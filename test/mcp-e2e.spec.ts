import { test, expect, _electron as electron } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// Socket path logic matching src/index.ts and src/cli/cli.ts
function getSocketPath(): string {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\httptoolkit-desktop';
    }

    let socketDir: string;
    if (process.platform === 'linux' && process.env.XDG_RUNTIME_DIR) {
        socketDir = process.env.XDG_RUNTIME_DIR;
    } else {
        const tmpDir = os.tmpdir();
        if (tmpDir === '/tmp' || tmpDir === '/var/tmp') {
            socketDir = path.join(tmpDir, `httptoolkit-${process.getuid!()}`);
        } else {
            socketDir = tmpDir;
        }
    }

    return path.join(socketDir, 'httptoolkit.sock');
}

function apiRequest(socketPath: string, method: 'GET' | 'POST', urlPath: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            method,
            path: urlPath,
            socketPath,
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                } catch {
                    resolve(raw);
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function launchApp(extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
    const app = await electron.launch({
        cwd: path.join(import.meta.dirname, '..'),
        args: [
            '.',
            ...extraArgs,
            // On Linux ARM64 CI, sandboxing doesn't work, so we have to skip it:
            ...(process.env.CI && process.platform === 'linux' && process.arch === 'arm64' ?
                [
                '--no-sandbox',
                '--disable-setuid-sandbox'
                ] : []
            )
        ],
        timeout: 20000,
        env: {
            ...process.env,
            'HTTPTOOLKIT_SERVER_DISABLE_AUTOUPDATE': '1',
            ...extraEnv
        }
    });

    app.process().stdout?.on('data', (data) => {
        console.log('[stdout]', data.toString().trim());
    });
    app.process().stderr?.on('data', (data) => {
        console.error('[stderr]', data.toString().trim());
    });

    return app;
}

test('MCP server exposes UI operations as tools', async () => {
    // This test launches the full Electron app, waits for the production UI
    // to register MCP operations, then spawns the CLI in MCP mode and verifies
    // the full JSON-RPC protocol flow.
    test.setTimeout(120_000);

    const electronApp = await launchApp();
    let mcpProcess: ChildProcess | undefined;

    try {
        const window = await electronApp.firstWindow();

        // Wait for UI to fully load (server started + UI connected)
        await expect(window.locator('h1:has-text("Intercept HTTP")')).toBeVisible({ timeout: 30000 });

        const socketPath = getSocketPath();

        // Poll until operations are available via the socket API.
        // The UI needs to call desktopApi.setApiOperations() after loading,
        // which may take a moment after the page is visible.
        let operations: any[] = [];
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                operations = await apiRequest(socketPath, 'GET', '/api/operations');
                if (Array.isArray(operations) && operations.length > 0) break;
            } catch {
                // Socket not ready yet
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        expect(operations.length).toBeGreaterThan(0);

        // Verify operation shape
        for (const op of operations) {
            expect(typeof op.name).toBe('string');
            expect(typeof op.description).toBe('string');
            expect(op.name.length).toBeGreaterThan(0);
        }

        // Verify status endpoint reports ready
        const status = await apiRequest(socketPath, 'GET', '/api/status');
        expect(status.ready).toBe(true);

        // --- MCP protocol test via CLI ---

        mcpProcess = spawn('node', [
            path.join(import.meta.dirname, '..', 'build', 'cli', 'cli.cjs'),
            'mcp'
        ], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Wait for the MCP server to finish its initial operations fetch
        // and start listening on stdin before we send any messages.
        await new Promise<void>((resolve, reject) => {
            const onData = (data: Buffer) => {
                if (data.toString().includes('MCP server started on stdio')) {
                    mcpProcess!.stderr!.removeListener('data', onData);
                    resolve();
                }
            };
            mcpProcess!.stderr!.on('data', onData);
            mcpProcess!.on('exit', (code) =>
                reject(new Error(`MCP process exited early with code ${code}`))
            );
        });

        // Set up line-by-line JSON-RPC response reading
        const rl = readline.createInterface({ input: mcpProcess.stdout! });
        const pendingResolvers: ((value: any) => void)[] = [];
        const receivedMessages: any[] = [];

        rl.on('line', (line) => {
            try {
                const parsed = JSON.parse(line.trim());
                if (pendingResolvers.length > 0) {
                    pendingResolvers.shift()!(parsed);
                } else {
                    receivedMessages.push(parsed);
                }
            } catch {
                // Ignore non-JSON lines
            }
        });

        function nextMessage(): Promise<any> {
            if (receivedMessages.length > 0) {
                return Promise.resolve(receivedMessages.shift());
            }
            return new Promise(resolve => pendingResolvers.push(resolve));
        }

        function sendMessage(msg: any): void {
            mcpProcess!.stdin!.write(JSON.stringify(msg) + '\n');
        }

        // 1. Initialize
        sendMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'httptoolkit-e2e-test', version: '1.0.0' }
            }
        });

        const initResponse = await nextMessage();
        expect(initResponse.jsonrpc).toBe('2.0');
        expect(initResponse.id).toBe(1);
        expect(initResponse.result.protocolVersion).toBe('2024-11-05');
        expect(initResponse.result.capabilities.tools.listChanged).toBe(true);
        expect(initResponse.result.serverInfo.name).toBe('httptoolkit');

        // 2. Send initialized notification
        sendMessage({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
        });

        // 3. Request tools list
        sendMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
        });

        const toolsResponse = await nextMessage();
        expect(toolsResponse.id).toBe(2);
        const tools = toolsResponse.result.tools;
        expect(tools.length).toBeGreaterThan(0);

        // Verify tool names match operations (dots replaced with underscores)
        const expectedToolNames = new Set(
            operations.map((op: any) => op.name.replace(/\./g, '_'))
        );
        const actualToolNames = new Set(
            tools.map((t: any) => t.name)
        );

        for (const expectedName of expectedToolNames) {
            expect(actualToolNames.has(expectedName)).toBe(true);
        }

        // Verify each tool has the correct MCP shape
        for (const tool of tools) {
            expect(typeof tool.name).toBe('string');
            expect(typeof tool.description).toBe('string');
            expect(tool.inputSchema).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
        }

        // 4. Test unknown method returns error
        sendMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'nonexistent/method'
        });

        const errorResponse = await nextMessage();
        expect(errorResponse.id).toBe(3);
        expect(errorResponse.error).toBeTruthy();
        expect(errorResponse.error.code).toBe(-32601);

        // 5. Test malformed JSON returns parse error
        mcpProcess.stdin!.write('not valid json\n');

        const parseErrorResponse = await nextMessage();
        expect(parseErrorResponse.error).toBeTruthy();
        expect(parseErrorResponse.error.code).toBe(-32700);

    } finally {
        if (mcpProcess) {
            mcpProcess.stdin?.end();
            mcpProcess.kill();
        }
        await electronApp.close();

        // Wait for the detached server child process to fully release its ports,
        // so subsequent tests that launch Electron won't hit port conflicts.
        await new Promise(r => setTimeout(r, 2000));
    }
});
