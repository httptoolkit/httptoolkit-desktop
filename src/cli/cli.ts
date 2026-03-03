/**
 * HTTP Toolkit CLI - standalone binary using only Node builtins.
 * Built as a Node SEA (Single Executable Application).
 *
 * Discovers operations dynamically from a running HTTP Toolkit instance
 * and maps them to CLI subcommands.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { parseArgs } from 'util';

interface HtkOperation {
    name: string;
    description: string;
    category: string;
    inputSchema: any;
}

// NOTE: This logic is duplicated in src/index.ts — keep in sync.
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
            fs.mkdirSync(socketDir, { mode: 0o700, recursive: true });
        } else {
            socketDir = tmpDir;
        }
    }

    return path.join(socketDir, 'httptoolkit.sock');
}

// --- HTTP client for Unix socket / named pipe ---

function apiRequest(
    method: 'GET' | 'POST',
    urlPath: string,
    body?: any
): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            method,
            path: urlPath,
            socketPath: getSocketPath(),
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode && res.statusCode >= 400) {
                    try {
                        const err = JSON.parse(raw);
                        reject(new Error(err.message || err.error || `HTTP ${res.statusCode}`));
                    } catch {
                        reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
                    }
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                } catch {
                    resolve(raw);
                }
            });
        });

        req.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
                reject(new Error('HTTP Toolkit is not running. Start HTTP Toolkit first.'));
            } else {
                reject(err);
            }
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// --- Argument parsing ---

/**
 * Convert an operation's inputSchema into a util.parseArgs options config.
 * Handles nested object properties as dot-notation flags (e.g. filter.method).
 */
function schemaToParseArgsOptions(
    inputSchema: any
): Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> {
    const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> = {};
    const properties = inputSchema?.properties || {};

    for (const [key, prop] of Object.entries<any>(properties)) {
        if (prop.type === 'boolean') {
            options[key] = { type: 'boolean' };
        } else if (prop.type === 'array') {
            options[key] = { type: 'string', multiple: true };
        } else if (prop.type === 'object' && prop.properties) {
            for (const [nestedKey, nestedProp] of Object.entries<any>(prop.properties)) {
                options[`${key}.${nestedKey}`] = {
                    type: (nestedProp as any).type === 'boolean' ? 'boolean' : 'string'
                };
            }
        } else {
            options[key] = { type: 'string' };
        }
    }

    return options;
}

/**
 * Coerce a parsed string/boolean value to the type specified by the schema.
 */
function coerceValue(value: string | boolean, schema: any): any {
    if (typeof value === 'boolean') return value;

    const type = schema?.type;
    if (type === 'number' || type === 'integer') {
        const num = Number(value);
        if (isNaN(num)) return value;
        return num;
    }
    if (type === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return true;
    }
    return value;
}

/**
 * Coerce a flag value (string, string[], or boolean) according to the schema,
 * including array item coercion.
 */
function coerceArg(value: string | boolean | (string | boolean)[], schema: any): any {
    if (Array.isArray(value)) {
        const itemSchema = schema?.items;
        return value.map(v => coerceValue(v, itemSchema));
    }
    return coerceValue(value, schema);
}

/**
 * Validate an enum constraint. Returns an error message or null if valid.
 */
function validateEnum(key: string, value: any, schema: any): string | null {
    if (!schema?.enum) return null;
    const allowed: any[] = schema.enum;
    if (!allowed.includes(value)) {
        return `Invalid value '${value}' for --${key}. Allowed: ${allowed.join(', ')}`;
    }
    return null;
}

/**
 * Get the positional parameter names from a schema, in order.
 * Positional params are those listed in `required`, in the order they appear.
 */
function getPositionalParams(inputSchema: any): string[] {
    return inputSchema?.required ?? [];
}

function flagsToParams(
    flags: Record<string, string | boolean | (string | boolean)[] | undefined>,
    extraPositional: string[],
    inputSchema: any
): Record<string, any> {
    const params: Record<string, any> = {};
    const properties = inputSchema?.properties || {};

    // Apply defaults from schema for any params not explicitly provided
    for (const [key, prop] of Object.entries<any>(properties)) {
        if (prop.default !== undefined) {
            params[key] = prop.default;
        }
    }

    // Assign extra positional args to positional schema properties in order
    const positionalNames = getPositionalParams(inputSchema);
    for (let i = 0; i < positionalNames.length && i < extraPositional.length; i++) {
        const name = positionalNames[i];
        const value = coerceArg(extraPositional[i], properties[name]);

        const enumErr = validateEnum(name, value, properties[name]);
        if (enumErr) {
            process.stderr.write(`Error: ${enumErr}\n`);
            process.exit(1);
        }

        params[name] = value;
    }

    for (const [key, value] of Object.entries(flags)) {
        if (key === 'help' || value === undefined) continue;

        const parts = key.split('.');
        if (parts.length === 1) {
            const coerced = coerceArg(value, properties[key]);

            const enumErr = validateEnum(key, coerced, properties[key]);
            if (enumErr) {
                process.stderr.write(`Error: ${enumErr}\n`);
                process.exit(1);
            }

            params[key] = coerced;
        } else {
            // Dot notation: --filter.method GET → { filter: { method: "GET" } }
            let target: any = params;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!(parts[i] in target) || typeof target[parts[i]] !== 'object') {
                    target[parts[i]] = {};
                }
                target = target[parts[i]];
            }
            const leafKey = parts[parts.length - 1];
            const nestedProp = properties[parts[0]]?.properties?.[parts.slice(1).join('.')];
            target[leafKey] = coerceArg(value, nestedProp);
        }
    }

    return params;
}

// --- Help generation ---

function generateGeneralHelp(operations: HtkOperation[]): string {
    const lines = [
        'HTTP Toolkit CLI',
        '',
        'Usage: httptoolkit-cli <command> [options]',
        '',
        '  status                     Check if HTTP Toolkit is running',
        '  help                       Show this help message',
        ''
    ];

    const byCategory = new Map<string, HtkOperation[]>();
    for (const op of operations) {
        const cat = op.category || 'other';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(op);
    }

    for (const [, ops] of byCategory) {
        for (const op of ops) {
            const [cat, action] = op.name.includes('.')
                ? op.name.split('.', 2)
                : [op.name, ''];
            const cmd = action ? `${cat} ${action}` : cat;
            const padded = cmd.padEnd(27);
            // Truncate description to fit in terminal
            const desc = op.description.length > 50
                ? op.description.slice(0, 47) + '...'
                : op.description;
            lines.push(`  ${padded}${desc}`);
        }
    }

    lines.push('');
    lines.push("Run 'httptoolkit-cli <command> --help' for details.");
    return lines.join('\n');
}

function generateOperationHelp(op: HtkOperation): string {
    const [cat, action] = op.name.includes('.')
        ? op.name.split('.', 2)
        : [op.name, ''];
    const cmd = action ? `${cat} ${action}` : cat;

    const schema = op.inputSchema;
    const positionalNames = getPositionalParams(schema);
    const positionalUsage = positionalNames.map(n => `<${n}>`).join(' ');
    const usageSuffix = positionalUsage
        ? `${positionalUsage} [options]`
        : '[options]';

    const lines = [
        op.description,
        '',
        `Usage: httptoolkit-cli ${cmd} ${usageSuffix}`
    ];

    if (schema?.properties && Object.keys(schema.properties).length > 0) {
        const positionalSet = new Set(positionalNames);
        const hasFlags = Object.keys(schema.properties).some(k => !positionalSet.has(k));

        if (positionalNames.length > 0) {
            lines.push('');
            lines.push('Arguments:');
            for (const name of positionalNames) {
                const prop = schema.properties[name];
                const desc = prop?.description || '';
                const enumStr = prop?.enum ? ` [${prop.enum.join('|')}]` : '';
                const defaultStr = prop?.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
                lines.push(`  ${(`<${name}>`).padEnd(35)}${desc}${enumStr}${defaultStr}`);
            }
        }

        if (hasFlags) {
            lines.push('');
            lines.push('Options:');
            formatHelpParams(schema, lines);
        }
    }

    return lines.join('\n');
}

function formatHelpParams(schema: any, lines: string[], prefix = ''): void {
    if (!schema?.properties) return;
    const positionalSet = new Set<string>(schema.required ?? []);

    for (const [key, prop] of Object.entries<any>(schema.properties)) {
        // Skip positional (required) params — they're shown in the Arguments section
        if (!prefix && positionalSet.has(key)) continue;

        const fullKey = prefix ? `${prefix}.${key}` : key;

        let flag: string;
        if (prop.type === 'boolean') {
            flag = `--[no-]${fullKey}`;
        } else if (prop.enum) {
            flag = `--${fullKey} <${prop.enum.join('|')}>`;
        } else if (prop.type === 'array') {
            const itemType = prop.items?.type || 'value';
            flag = `--${fullKey} <${itemType}>...`;
        } else {
            const typeStr = prop.type ? ` <${prop.type}>` : '';
            flag = `--${fullKey}${typeStr}`;
        }

        const padded = flag.padEnd(35);
        const desc = prop.description || '';
        const defaultStr = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
        lines.push(`  ${padded}${desc}${defaultStr}`);

        if (prop.type === 'object' && prop.properties) {
            formatHelpParams(prop, lines, fullKey);
        }
    }
}

// --- MCP server (JSON-RPC 2.0 over stdio) ---

const POLL_INTERVAL_MS = 5_000;

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: number | string;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string | null;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

function sendJsonRpc(msg: JsonRpcResponse | JsonRpcNotification): void {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function jsonRpcResult(id: number | string | null, result: any): void {
    sendJsonRpc({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: number | string | null, code: number, message: string): void {
    sendJsonRpc({ jsonrpc: '2.0', id, error: { code, message } });
}

function operationsToMcpTools(operations: HtkOperation[]): any[] {
    return operations.map(op => ({
        name: op.name.replace(/\./g, '_'),
        description: op.description,
        inputSchema: {
            type: 'object',
            properties: op.inputSchema?.properties ?? {},
        }
    }));
}

async function runMcpServer(): Promise<void> {
    const log = (msg: string) => process.stderr.write(`[MCP] ${msg}\n`);

    let cachedOperations: HtkOperation[] = [];

    async function refreshOperations(): Promise<void> {
        try {
            cachedOperations = await apiRequest('GET', '/api/operations');
        } catch {
            cachedOperations = [];
        }
    }

    // Load initial operations
    await refreshOperations();

    function getToolsList(): any[] {
        if (cachedOperations.length > 0) return operationsToMcpTools(cachedOperations);
        // No running instance — offer a placeholder tool
        return [{
            name: 'start_httptoolkit',
            description: 'HTTP Toolkit is not running. Please start HTTP Toolkit and try again.',
            inputSchema: { type: 'object', properties: {} }
        }];
    }

    async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: any[]; isError?: boolean }> {
        if (name === 'start_httptoolkit') {
            return {
                content: [{ type: 'text', text: 'HTTP Toolkit is not running. Please start HTTP Toolkit and try again.' }],
                isError: true
            };
        }

        // Map MCP tool name back to operation name
        const matchedOp = cachedOperations.find(op => op.name.replace(/\./g, '_') === name);
        const operationName = matchedOp?.name ?? name.replace(/_/g, '.');

        try {
            const result = await apiRequest('POST', '/api/execute', {
                name: operationName,
                args
            });

            if (result && !result.success && result.error?.code === 'PRO_REQUIRED') {
                return {
                    content: [{ type: 'text', text: result.error.message }],
                    isError: true
                };
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
        } catch (err: any) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true
            };
        }
    }

    function handleMessage(msg: JsonRpcRequest): void {
        switch (msg.method) {
            case 'initialize':
                jsonRpcResult(msg.id!, {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: { listChanged: true }
                    },
                    serverInfo: {
                        name: 'httptoolkit',
                        version: 'unknown'
                    }
                });
                break;

            case 'notifications/initialized':
                // Client ready — no response needed
                break;

            case 'tools/list':
                jsonRpcResult(msg.id!, { tools: getToolsList() });
                break;

            case 'tools/call': {
                const { name, arguments: callArgs } = msg.params ?? {};
                log(`Tool called: ${name} with args: ${JSON.stringify(callArgs)}`);
                handleToolCall(name, callArgs ?? {}).then(result => {
                    jsonRpcResult(msg.id!, result);
                }).catch(err => {
                    jsonRpcError(msg.id!, -32603, err.message);
                });
                break;
            }

            default:
                if (msg.id !== undefined) {
                    jsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`);
                }
                break;
        }
    }

    // Poll for operation changes
    let lastOpsKey = JSON.stringify(cachedOperations.map(o => o.name).sort());

    const pollTimer = setInterval(async () => {
        await refreshOperations();
        const newOpsKey = JSON.stringify(cachedOperations.map(o => o.name).sort());
        if (newOpsKey !== lastOpsKey) {
            lastOpsKey = newOpsKey;
            sendJsonRpc({
                jsonrpc: '2.0',
                method: 'notifications/tools/list_changed'
            });
            log('Sent tools/list_changed');
        }
    }, POLL_INTERVAL_MS);

    // Read stdin line-by-line
    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
            const msg = JSON.parse(trimmed) as JsonRpcRequest;
            handleMessage(msg);
        } catch {
            // Malformed JSON — send parse error if possible
            jsonRpcError(null, -32700, 'Parse error');
        }
    });

    rl.on('close', () => {
        clearInterval(pollTimer);
        process.exit(0);
    });

    log('MCP server started on stdio');
}

// --- Main ---

async function main() {
    const args = process.argv.slice(2);
    // First pass: just extract positionals to find the command
    const { positionals } = parseArgs({ args, strict: false, allowPositionals: true });

    // Built-in commands (don't need a running instance for help)
    if (positionals.length === 0 || positionals[0] === 'help') {
        try {
            const operations: HtkOperation[] = await apiRequest('GET', '/api/operations');
            process.stdout.write(generateGeneralHelp(operations) + '\n');
        } catch {
            process.stdout.write(generateGeneralHelp([]) + '\n');
        }
        process.exit(0);
    }

    if (positionals[0] === 'status') {
        try {
            const status = await apiRequest('GET', '/api/status');
            process.stdout.write(JSON.stringify({ running: true, ...status }) + '\n');
        } catch {
            process.stdout.write(JSON.stringify({ running: false }) + '\n');
        }
        process.exit(0);
    }

    if (positionals[0] === 'mcp') {
        await runMcpServer();
        return;
    }

    // Operation commands: try word1.word2, then word1 alone
    let operations: HtkOperation[];
    try {
        operations = await apiRequest('GET', '/api/operations');
    } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
        return; // Unreachable, but satisfies TypeScript
    }

    // Try matching: word1.word2 first, then word1 alone
    let matchedOp: HtkOperation | undefined;
    let commandWords = 0;

    if (positionals.length >= 2) {
        const twoWordName = `${positionals[0]}.${positionals[1]}`;
        matchedOp = operations.find(op => op.name === twoWordName);
        if (matchedOp) commandWords = 2;
    }

    if (!matchedOp) {
        matchedOp = operations.find(op => op.name === positionals[0]);
        if (matchedOp) commandWords = 1;
    }

    if (!matchedOp) {
        const cmd = positionals.slice(0, 2).join(' ');
        process.stderr.write(`Error: Unknown command '${cmd}'. Run 'httptoolkit-cli help'.\n`);
        process.exit(1);
        return;
    }

    // Re-parse with schema knowledge for accurate boolean/array handling
    const options = schemaToParseArgsOptions(matchedOp.inputSchema);
    options.help = { type: 'boolean' };
    const reparsed = parseArgs({ args, options, strict: false, allowPositionals: true, allowNegative: true });

    if (reparsed.values.help) {
        process.stdout.write(generateOperationHelp(matchedOp) + '\n');
        process.exit(0);
    }

    // Remaining positional args after the command words (e.g. "events get 123" → ["123"])
    const extraPositional = reparsed.positionals.slice(commandWords);

    // Build params from flags + positional args
    const params = flagsToParams(reparsed.values, extraPositional, matchedOp.inputSchema);

    try {
        const result = await apiRequest('POST', '/api/execute', {
            name: matchedOp.name,
            args: params
        });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        process.exit(0);
    } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
    }
}

main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
});
