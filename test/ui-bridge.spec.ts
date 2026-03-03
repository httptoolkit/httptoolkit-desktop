import { test, expect } from '@playwright/test';
import { once } from 'events';
import { MessageChannel } from 'worker_threads';

import { UiBridge } from '../build/ui-bridge.js';

const DUMMY_OPTIONS = {
    getSkillsMarkdown: () => ''
};

const DUMMY_OPS = [
    { name: 'test.echo', description: 'Echo', category: 'test', inputSchema: {} }
];

/**
 * Create a MessageChannel pair adapted for Electron's MessagePortMain API.
 * Both Node's addEventListener and Electron's on() wrap values in { data },
 * so we just map on/off to addEventListener/removeEventListener.
 *
 * The incompatibility here is really an Electron bug - MessagePortMain does
 * not implement the compatible addEventListener DOM API, and it's on() API
 * isn't compatible with Node's either.
 *
 * Maybe https://github.com/electron/electron/issues/37157 will eventually
 * fix this.
 */
function createTestChannel() {
    const { port1, port2 } = new MessageChannel();

    const bridgePort = {
        on: (event: string, listener: any) => port1.addEventListener(event, listener),
        off: (event: string, listener: any) => port1.removeEventListener(event, listener),
        postMessage: (data: any) => port1.postMessage(data),
        start: () => port1.start(),
        close: () => port1.close()
    };

    return { bridgePort, rendererPort: port2 };
}

async function sendOpsAndWaitForReady(
    rendererPort: InstanceType<typeof MessageChannel>['port1'],
    bridge: InstanceType<typeof UiBridge>,
    ops = DUMMY_OPS
) {
    rendererPort.postMessage({ type: 'operations', operations: ops });
    await once(bridge, 'ready');
}

test.describe('UiBridge', () => {

    test('starts in not-ready state', () => {
        const bridge = new UiBridge(DUMMY_OPTIONS);
        expect(bridge.isReady).toBe(false);
        expect(bridge.currentOperations).toEqual([]);
        bridge.destroy();
    });

    test('transitions to ready on first operations message', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        rendererPort.postMessage({ type: 'operations', operations: DUMMY_OPS });
        await once(bridge, 'ready');

        expect(bridge.isReady).toBe(true);
        expect(bridge.currentOperations).toEqual(DUMMY_OPS);
        bridge.destroy();
        rendererPort.close();
    });

    test('updates operations without re-emitting ready', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        await sendOpsAndWaitForReady(rendererPort, bridge);

        let readyCount = 0;
        bridge.on('ready', () => { readyCount++; });

        const newOps = [...DUMMY_OPS, { name: 'test.ping', description: 'Ping', category: 'test', inputSchema: {} }];
        rendererPort.postMessage({ type: 'operations', operations: newOps });
        await once(bridge, 'operations-changed');

        expect(bridge.currentOperations).toEqual(newOps);
        expect(readyCount).toBe(0);
        bridge.destroy();
        rendererPort.close();
    });

    test('executeOperation sends request and resolves on response', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        await sendOpsAndWaitForReady(rendererPort, bridge);

        const resultPromise = bridge.executeOperation('test.echo', { msg: 'hello' });

        // Wait for the request to arrive at the renderer
        const [request] = await once(rendererPort, 'message');
        expect(request.type).toBe('request');
        expect(request.operation).toBe('test.echo');
        expect(request.params).toEqual({ msg: 'hello' });
        expect(request.id).toBeTruthy();

        rendererPort.postMessage({
            type: 'response',
            id: request.id,
            result: { success: true, data: 'echoed' }
        });

        const result = await resultPromise;
        expect(result).toEqual({ success: true, data: 'echoed' });
        bridge.destroy();
        rendererPort.close();
    });

    test('executeOperation rejects on error response', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        await sendOpsAndWaitForReady(rendererPort, bridge);

        const resultPromise = bridge.executeOperation('test.echo', {});

        const [request] = await once(rendererPort, 'message');
        rendererPort.postMessage({
            type: 'response',
            id: request.id,
            error: 'Something went wrong'
        });

        await expect(resultPromise).rejects.toThrow('Something went wrong');
        bridge.destroy();
        rendererPort.close();
    });

    test('executeOperation rejects when not ready and no operations', async () => {
        const bridge = new UiBridge(DUMMY_OPTIONS);

        await expect(bridge.executeOperation('test.echo', {}))
            .rejects.toThrow('Renderer API is not ready');
        bridge.destroy();
    });

    test('setPort rejects pending requests from old port', async () => {
        const ch1 = createTestChannel();
        const ch2 = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(ch1.bridgePort as any);

        await sendOpsAndWaitForReady(ch1.rendererPort, bridge);

        const resultPromise = bridge.executeOperation('test.echo', {});

        bridge.setPort(ch2.bridgePort as any);

        await expect(resultPromise).rejects.toThrow('Renderer disconnected');
        expect(bridge.isReady).toBe(false);
        bridge.destroy();
        ch1.rendererPort.close();
        ch2.rendererPort.close();
    });

    test('ignores responses for unknown request IDs', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        // Send an unknown response, then a valid operations message.
        // If the bridge survives to process operations, it handled the unknown response correctly.
        rendererPort.postMessage({ type: 'response', id: 'nonexistent-id', result: {} });
        rendererPort.postMessage({ type: 'operations', operations: DUMMY_OPS });
        await once(bridge, 'ready');

        bridge.destroy();
        rendererPort.close();
    });

    test('ignores unrecognized messages', async () => {
        const { bridgePort, rendererPort } = createTestChannel();
        const bridge = new UiBridge(DUMMY_OPTIONS);
        bridge.setPort(bridgePort as any);

        // Send unrecognized messages, then a valid one to confirm delivery.
        rendererPort.postMessage({ type: 'something-else' });
        rendererPort.postMessage({ type: 123 });
        rendererPort.postMessage({ type: 'operations', operations: DUMMY_OPS });
        await once(bridge, 'ready');

        // Bridge should be ready (from the valid message) with no ill effects from the others
        expect(bridge.isReady).toBe(true);
        bridge.destroy();
        rendererPort.close();
    });
});
