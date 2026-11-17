/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {MAX_IDLE_TIMEOUT_MINUTES} from '../../src/config/mcp-options.js';
import {IdleTimer} from '../../src/daemon/IdleTimer.js';

const ONE_MINUTE_MS = 60_000;

function createIdleTimer(timeoutMinutes: number | undefined) {
  const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  const onIdle = sinon.stub();
  const timer = new IdleTimer({timeoutMinutes, onIdle});
  return {clock, onIdle, timer};
}

describe('IdleTimer', () => {
  it('converts timeoutMinutes to milliseconds', () => {
    const {clock, onIdle, timer} = createIdleTimer(30);

    timer.schedule();
    clock.tick(30 * ONE_MINUTE_MS - 1);
    sinon.assert.notCalled(onIdle);
    clock.tick(1);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('does not overflow setTimeout at MAX_IDLE_TIMEOUT_MINUTES', () => {
    const {clock, onIdle, timer} = createIdleTimer(MAX_IDLE_TIMEOUT_MINUTES);

    timer.schedule();
    clock.tick(MAX_IDLE_TIMEOUT_MINUTES * ONE_MINUTE_MS - 1);
    sinon.assert.notCalled(onIdle);
    clock.tick(1);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('does not call onIdle while an activity is in flight', async () => {
    const {clock, onIdle, timer} = createIdleTimer(1);
    let finishActivity = () => {};
    const activity = new Promise<void>(resolve => {
      finishActivity = resolve;
    });

    timer.schedule();
    const tracked = timer.track(() => activity);
    await clock.tickAsync(5 * ONE_MINUTE_MS);
    sinon.assert.notCalled(onIdle);
    finishActivity();
    await tracked;
    await clock.tickAsync(ONE_MINUTE_MS - 1);
    sinon.assert.notCalled(onIdle);
    await clock.tickAsync(1);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('waits for all overlapping activities to finish', async () => {
    const {clock, onIdle, timer} = createIdleTimer(1);
    let finishLongActivity = () => {};
    const longActivity = new Promise<void>(resolve => {
      finishLongActivity = resolve;
    });

    const tracked = timer.track(() => longActivity);
    await timer.track(async () => {});
    await clock.tickAsync(5 * ONE_MINUTE_MS);
    sinon.assert.notCalled(onIdle);
    finishLongActivity();
    await tracked;
    await clock.tickAsync(ONE_MINUTE_MS);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('resets the countdown after an activity finishes', async () => {
    const {clock, onIdle, timer} = createIdleTimer(1);

    timer.schedule();
    await clock.tickAsync(ONE_MINUTE_MS - 100);
    assert.strictEqual(await timer.track(async () => 'result'), 'result');
    await clock.tickAsync(ONE_MINUTE_MS - 1);
    sinon.assert.notCalled(onIdle);
    await clock.tickAsync(1);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('resets the countdown after an activity rejects', async () => {
    const {clock, onIdle, timer} = createIdleTimer(1);

    await assert.rejects(
      timer.track(async () => {
        throw new Error('tool failed');
      }),
      /tool failed/,
    );
    await clock.tickAsync(ONE_MINUTE_MS);

    sinon.assert.calledOnceWithExactly(onIdle);
  });

  it('is disabled when no timeout is configured', async () => {
    const {clock, onIdle, timer} = createIdleTimer(undefined);

    timer.schedule();
    await timer.track(async () => {});

    assert.strictEqual(clock.countTimers(), 0);
    sinon.assert.notCalled(onIdle);
  });

  it('does not call onIdle after dispose', async () => {
    const {clock, onIdle, timer} = createIdleTimer(1);

    timer.schedule();
    timer.dispose();
    await timer.track(async () => {});

    assert.strictEqual(clock.countTimers(), 0);
    sinon.assert.notCalled(onIdle);
  });
});
