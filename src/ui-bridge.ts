import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { EventEmitter } from 'events';
import type { MessagePortMain } from 'electron';

export interface HtkOperation {
    name: string;
    description: string;
    category: string;
    inputSchema: object;
    outputSchema: object;
}

interface PendingRequest {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class UiBridge extends EventEmitter {

    private ready = false;
    private operations: HtkOperation[] = [];
    private pending = new Map<string, PendingRequest>();
    private server: http.Server | undefined;
    private port: MessagePortMain | undefined;
    private messageHandler: ((event: { data: any }) => void) | undefined;

    constructor() {
        super();
    }

    get isReady(): boolean {
        return this.ready;
    }

    get currentOperations(): HtkOperation[] {
        return this.operations;
    }

    /**
     * Set (or replace) the MessagePort used to communicate with the renderer.
     * Closes the previous port and rejects its pending requests.
     */
    setPort(port: MessagePortMain): void {
        if (this.port && this.messageHandler) {
            this.port.off('message', this.messageHandler);
            this.port.close();
        }

        this.ready = false;
        // Keep operations — they survive reconnects so the HTTP API
        // can still serve operations/skills while the renderer reloads.

        this.rejectAllPending('Renderer disconnected');

        this.port = port;
        this.messageHandler = (event) => this.handleMessage(event.data);
        port.on('message', this.messageHandler);
        port.start();

        this.emit('not-ready');
    }

    get hasOperations(): boolean {
        return this.operations.length > 0;
    }

    /**
     * Execute an operation on the renderer and return the result.
     * If operations are known but the renderer isn't ready yet, waits for ready.
     * If no operations have been received at all, rejects immediately.
     */
    async executeOperation(operation: string, params: Record<string, unknown> = {}): Promise<any> {
        if (!this.ready) {
            if (!this.hasOperations) {
                throw new Error('Renderer API is not ready');
            }
            await new Promise<void>((resolve, reject) => {
                const onReady = () => { cleanup(); resolve(); };
                const onNotReady = () => { cleanup(); reject(new Error('Renderer disconnected')); };
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Timed out waiting for renderer to become ready'));
                }, REQUEST_TIMEOUT_MS);

                const cleanup = () => {
                    clearTimeout(timeout);
                    this.removeListener('ready', onReady);
                    this.removeListener('not-ready', onNotReady);
                };

                this.once('ready', onReady);
                this.once('not-ready', onNotReady);
            });
        }

        if (!this.port) {
            throw new Error('No port connected');
        }

        const id = crypto.randomUUID();

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(id, { resolve, reject, timer });

            this.port!.postMessage({
                type: 'request',
                id,
                operation,
                params
            });
        });
    }

    // --- HTTP API server ---

    startApiServer(socketPath: string): http.Server {
        const server = http.createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');

            const url = new URL(req.url!, `http://localhost`);
            const pathname = url.pathname;

            try {
                if (req.method === 'GET' && pathname === '/api/status') {
                    this.handleApiStatus(res);
                } else if (req.method === 'GET' && pathname === '/api/operations') {
                    this.handleApiOperations(res);
                } else if (req.method === 'POST' && pathname === '/api/execute') {
                    await this.handleApiExecute(req, res);
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'not_found' }));
                }
            } catch (err: any) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'internal_error', message: err.message }));
            }
        });

        server.listen(socketPath, () => {
            // Restrict socket to owner-only access (defense-in-depth alongside
            // the directory permissions, and essential if the dir is /tmp).
            if (process.platform !== 'win32') {
                fs.chmodSync(socketPath, 0o600);
            }
            console.log(`UI Bridge API server listening on ${socketPath}`);
        });
        this.server = server;
        return server;
    }

    private handleApiStatus(res: http.ServerResponse): void {
        res.writeHead(200);
        res.end(JSON.stringify({
            ready: this.isReady
        }));
    }

    private handleApiOperations(res: http.ServerResponse): void {
        if (!this.hasOperations) {
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'not_ready' }));
            return;
        }

        res.writeHead(200);
        res.end(JSON.stringify(this.currentOperations));
    }

    private async handleApiExecute(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        if (!this.hasOperations) {
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'not_ready' }));
            return;
        }

        const body = await readBody(req);
        let parsed: { name: string; args?: Record<string, unknown> };

        try {
            parsed = JSON.parse(body);
        } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'invalid_json' }));
            return;
        }

        if (!parsed.name || typeof parsed.name !== 'string') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'missing_operation_name' }));
            return;
        }

        try {
            const result = await this.executeOperation(parsed.name, parsed.args ?? {});
            res.writeHead(200);
            res.end(JSON.stringify(result));
        } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'execution_failed', message: err.message }));
        }
    }

    // --- Port message handling ---

    private handleMessage(data: any): void {
        if (!data || typeof data.type !== 'string') return;

        switch (data.type) {
            case 'operations':
                this.operations = data.operations ?? [];
                if (!this.ready) {
                    this.ready = true;
                    this.emit('ready');
                }
                this.emit('operations-changed', this.operations);
                break;

            case 'response':
                this.handleResponse(data);
                break;
        }
    }

    private handleResponse(data: { id: string; result?: any; error?: string }): void {
        const pending = this.pending.get(data.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pending.delete(data.id);

        if (data.error) {
            pending.reject(new Error(data.error));
        } else {
            pending.resolve(data.result);
        }
    }

    private rejectAllPending(message: string): void {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.pending.clear();
    }

    destroy(): void {
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }

        if (this.port && this.messageHandler) {
            this.port.off('message', this.messageHandler);
            this.port.close();
            this.port = undefined;
            this.messageHandler = undefined;
        }

        this.rejectAllPending('Bridge destroyed');
        this.removeAllListeners();
    }
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}
