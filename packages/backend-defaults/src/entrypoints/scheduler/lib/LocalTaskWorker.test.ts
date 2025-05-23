/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { LocalTaskWorker } from './LocalTaskWorker';
import { mockServices } from '@backstage/backend-test-utils';
import waitFor from 'wait-for-expect';

jest.setTimeout(10_000);

describe('LocalTaskWorker', () => {
  const logger = mockServices.logger.mock();

  it('runs the happy path (with iso duration) and handles cancellation', async () => {
    const fn = jest.fn();
    const controller = new AbortController();

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: 'PT0.2S',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    // TODO(freben): Rewrite to fake timers - tried, but it wouldn't work
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 100));
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 200));
    expect(fn).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 200));
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
    await new Promise(r => setTimeout(r, 200));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs the happy path (with a cron expression) and handles cancellation', async () => {
    const fn = jest.fn();
    const controller = new AbortController();

    // Await until system time is just past a second boundary (since cron is
    // wall clock based)
    await new Promise(r => setTimeout(r, 1000 - (Date.now() % 1000) + 10));

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: '* * * * * *',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    // TODO(freben): Rewrite to fake timers - tried, but it wouldn't work
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 100));
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 200));
    expect(fn).toHaveBeenCalledTimes(1);
    await new Promise(r => setTimeout(r, 1000));
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
    await new Promise(r => setTimeout(r, 1000));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('can trigger to abort wait', async () => {
    const fn = jest.fn();
    const controller = new AbortController();

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: 'PT0.2S',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    // TODO(freben): Rewrite to fake timers - tried, but it wouldn't work
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 100));
    expect(fn).toHaveBeenCalledTimes(0);
    await new Promise(r => setTimeout(r, 200));
    expect(fn).toHaveBeenCalledTimes(1);
    worker.trigger();
    await new Promise(r => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
  });

  it('goes through the expected states', async () => {
    const fn = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>(r => setTimeout(r, 100)))
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, r) =>
            setTimeout(() => r(new Error('boo')), 100),
          ),
      )
      .mockImplementation(() => new Promise<void>(r => setTimeout(r, 100)));
    const controller = new AbortController();

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.5S',
        cadence: 'PT0.5S',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'idle',
        startsAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'initial-wait',
      });
    });

    // Start, complete successfully
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'running',
        startedAt: expect.any(String),
        timesOutAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'running',
      });
    });
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'idle',
        startsAt: expect.any(String),
        lastRunEndedAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'idle',
      });
    });

    // Start, complete with error
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'running',
        startedAt: expect.any(String),
        timesOutAt: expect.any(String),
        lastRunEndedAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'running',
      });
    });
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'idle',
        startsAt: expect.any(String),
        lastRunEndedAt: expect.any(String),
        lastRunError: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'idle',
      });
    });

    // Start, complete successfully
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'running',
        startedAt: expect.any(String),
        timesOutAt: expect.any(String),
        lastRunEndedAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'running',
      });
    });
    await waitFor(() => {
      expect(worker.taskState()).toEqual({
        status: 'idle',
        startsAt: expect.any(String),
        lastRunEndedAt: expect.any(String),
      });
      expect(worker.workerState()).toEqual({
        status: 'idle',
      });
    });
  });
});
