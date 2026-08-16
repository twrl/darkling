import { describe, expect, it } from 'vitest';

import { createInProcessTransportPair } from '../src/in-process-transport.js';
import type { Envelope } from '../src/envelope.js';

describe('createInProcessTransportPair', () => {
  it('delivers messages sent on one end to the other', async () => {
    const { a, b } = createInProcessTransportPair();
    const received: Envelope[] = [];
    b.onMessage((env) => received.push(env));

    const envelope: Envelope = {
      head: { messageId: 'm1', service: 's', function: 'f', type: 'call', transferables: [] },
      body: { hello: 'world' },
    };
    a.send(envelope);

    await Promise.resolve();
    expect(received).toHaveLength(1);
    expect(received[0]?.head.messageId).toBe('m1');
  });

  it('delivers in both directions', async () => {
    const { a, b } = createInProcessTransportPair();
    const aReceived: Envelope[] = [];
    const bReceived: Envelope[] = [];
    a.onMessage((env) => aReceived.push(env));
    b.onMessage((env) => bReceived.push(env));

    a.send({
      head: { messageId: '1', service: 's', function: 'f', type: 'call', transferables: [] },
      body: null,
    });
    b.send({
      head: { messageId: '2', service: 's', function: 'f', type: 'return', transferables: [] },
      body: null,
    });

    await Promise.resolve();
    expect(bReceived).toHaveLength(1);
    expect(aReceived).toHaveLength(1);
  });

  it('supports unsubscribe', async () => {
    const { a, b } = createInProcessTransportPair();
    const received: Envelope[] = [];
    const unsubscribe = b.onMessage((env) => received.push(env));

    unsubscribe();

    a.send({
      head: { messageId: '1', service: 's', function: 'f', type: 'call', transferables: [] },
      body: null,
    });

    await Promise.resolve();
    expect(received).toHaveLength(0);
  });

  it('stops delivering after close', async () => {
    const { a, b } = createInProcessTransportPair();
    const received: Envelope[] = [];
    b.onMessage((env) => received.push(env));

    a.close();
    a.send({
      head: { messageId: '1', service: 's', function: 'f', type: 'call', transferables: [] },
      body: null,
    });

    await Promise.resolve();
    expect(received).toHaveLength(0);
  });
});
