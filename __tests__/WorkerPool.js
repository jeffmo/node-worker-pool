'use strict';

jest
  .autoMockOff()
  .mock('../Worker');

var Promise = require('q').Promise;

describe('WorkerPool', function() {
  var FAKE_ARGS = ['--fakeArg1', '--fakeArg2=42'];
  var FAKE_INIT_DATA = {someData: 12345};
  var FAKE_PATH = '/path/ot/some/fake/worker';

  var Worker;
  var WorkerPool;

  function _getFlattenedSendMessageCalls() {
    return _getGroupedSendMessageCalls()
      .reduce(function(list, groupCalls) {
        return list.concat(groupCalls);
      }, []);
  }

  function _getGroupedSendMessageCalls() {
    return Worker.mock.instances.map(function(workerInst) {
      return workerInst.sendMessage.mock.calls;
    });
  }

  beforeEach(function() {
    Worker = require('../Worker');
    WorkerPool = require('../WorkerPool');
  });

  describe('worker booting', function() {
    it('eagerly boots all workers on pool creation', function() {
      new WorkerPool(3, FAKE_PATH, FAKE_ARGS, {
        workerInitData: FAKE_INIT_DATA
      });

      expect(Worker.mock.instances.length).toBe(3);
    });

    it('passes correct args to booted workers', function() {
      new WorkerPool(1, FAKE_PATH, FAKE_ARGS, {
        printChildResponses: true,
        workerInitData: FAKE_INIT_DATA
      });

      expect(Worker.mock.calls.length).toBe(1);

      var passedArgs = Worker.mock.calls[0];
      expect(passedArgs.length).toBe(3);
      expect(passedArgs[0]).toBe(FAKE_PATH);
      expect(passedArgs[1]).toBe(FAKE_ARGS);
      expect(passedArgs[2].printChildResponses).toBe(true);
      expect(passedArgs[2].initData).toBe(FAKE_INIT_DATA);
    });
  });

  describe('sendMessage', function() {
    it('throws immediately if pool is pending destruction', function() {
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);
      expect(function() {
        pool.destroy();
        pool.sendMessage(42);
      }).toThrow(
        'Attempted to send a message after the worker pool has already been ' +
        'or is in the process of shutting down!'
      );
    });

    it('sends a message to only one worker', function() {
      var MESSAGE = {value: 1};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);

      pool.sendMessage(MESSAGE).done();
      jest.runAllTicks();

      expect(_getFlattenedSendMessageCalls()).toEqual([[MESSAGE]]);
    });

    it('only sends one message to a worker at a time', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);

      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      jest.runAllTicks();

      expect(_getGroupedSendMessageCalls()).toEqual([
        [[MESSAGE1]], // Worker1
        [[MESSAGE2]], // Worker2
      ]);
    });

    it('queues messages when all workers are busy', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var MESSAGE3 = {value: 3};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      var worker1 = Worker.mock.instances[0];

      // Send 3 messages to only 2 workers
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      pool.sendMessage(MESSAGE3);
      jest.runAllTicks();

      // Observe that only 2 messages were handed out to workers
      expect(_getFlattenedSendMessageCalls()).toEqual([
        [MESSAGE1], // Worker1
        [MESSAGE2], // Worker2
      ]);

      // Simulate completion of one of the workers
      worker1.__settlers.sendMessage.resolve();
      jest.runAllTicks();

      // Observe that the 3rd message has now been handed out
      expect(_getFlattenedSendMessageCalls()).toEqual([
        [MESSAGE1], // Worker1
        [MESSAGE3], // Worker1
        [MESSAGE2], // Worker2
      ]);
    });

    it('successfully moves on if first worker response errors', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      jest.runAllTicks();

      // See that the first message was sent out
      expect(_getFlattenedSendMessageCalls()).toEqual([
        [MESSAGE1],
      ]);

      // Simulate a rejection response on the first message
      Worker.mock.instances[0].__settlers.sendMessage.reject();
      jest.runAllTicks();

      // See that the second message has now been sent out
      expect(_getFlattenedSendMessageCalls()).toEqual([
        [MESSAGE1],
        [MESSAGE2],
      ]);
    });

    it('propogates worker response for non-queued message', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 42};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);
      var worker = Worker.mock.instances[0];

      var response = null;
      pool.sendMessage(MESSAGE).then(function(rsp) {
        response = rsp;
      });
      jest.runAllTicks();

      // Simulate a response being sent up from the Worker
      worker.__settlers.sendMessage.resolve(RESPONSE);
      jest.runAllTicks();

      expect(response).toBe(RESPONSE);
    });

    it('propogates worker response for queued message', function() {
      var MESSAGE1 = {input: 42};
      var RESPONSE1 = {output: 43};
      var MESSAGE2 = {input: 44};
      var RESPONSE2 = {output: 45};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);
      var worker = Worker.mock.instances[0];

      var response1 = null;
      pool.sendMessage(MESSAGE1).then(function(rsp) {
        response1 = rsp;
      });
      var response2 = null;
      pool.sendMessage(MESSAGE2).then(function(rsp) {
        response2 = rsp;
      });
      jest.runAllTicks();

      // Simulate a response being sent up from the Worker
      worker.__settlers.sendMessage.resolve(RESPONSE1);
      jest.runAllTicks();

      expect(response1).toBe(RESPONSE1);
      expect(response2).toBe(null);

      // Simulate a second response being sent up from the Worker
      worker.__settlers.sendMessage.resolve(RESPONSE2);
      jest.runAllTicks();

      expect(response1).toBe(RESPONSE1);
      expect(response2).toBe(RESPONSE2);
    });
  });

  describe('destroy', function() {
    it('destroys all workers', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      var worker1 = Worker.mock.instances[0];
      var worker2 = Worker.mock.instances[1];
      var worker3 = Worker.mock.instances[2];

      pool.destroy();
      jest.runAllTicks();

      expect(worker1.destroy.mock.calls.length).toBe(1);
      expect(worker2.destroy.mock.calls.length).toBe(1);
      expect(worker3.destroy.mock.calls.length).toBe(1);
    });

    it('waits for all workers to be destroyed before resolving', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      var worker1 = Worker.mock.instances[0];
      var worker2 = Worker.mock.instances[1];
      var worker3 = Worker.mock.instances[2];

      var destructionResolved = false;
      pool.destroy().done(function() {
        destructionResolved = true;
      });
      jest.runAllTicks();

      expect(destructionResolved).toBe(false);

      // Simulate 2 of the 3 workers acknowledging their destruction
      worker1.__settlers.destroy.resolve();
      worker2.__settlers.destroy.resolve();
      jest.runAllTicks();

      expect(destructionResolved).toBe(false);

      // Simulate the third worker acknowledging its destruction
      worker3.__settlers.destroy.resolve();
      jest.runAllTicks();

      expect(destructionResolved).toBe(true);
    });

    it('propogates a worker destruction error', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      var worker1 = Worker.mock.instances[0];
      var worker2 = Worker.mock.instances[1];
      var worker3 = Worker.mock.instances[2];

      var destructionRejection = null;
      pool.destroy().catch(function(err) {
        destructionRejection = err;
      }).done();
      jest.runAllTicks();

      expect(destructionRejection).toBe(null);

      // Simulate 1 of the 3 workers rejecting their destruction
      worker1.__settlers.destroy.resolve();
      worker2.__settlers.destroy.resolve();
      worker3.__settlers.destroy.reject('nope');
      jest.runAllTicks();

      expect(destructionRejection).toBe('nope');
    });

    it('waits for pending responses before resolving', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};

      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      var worker1 = Worker.mock.instances[0];
      var worker2 = Worker.mock.instances[1];

      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      var destructionResolved = false;
      pool.destroy().done(function() {
        destructionResolved = true;
      });
      jest.runAllTicks();

      // Neither of the 2 workers' destroy methods should've been called because
      // they are currently processing messages
      expect(destructionResolved).toBe(false);
      expect(worker1.destroy.mock.calls.length).toBe(0);
      expect(worker2.destroy.mock.calls.length).toBe(0);

      worker1.__settlers.sendMessage.resolve();
      jest.runAllTicks();

      // Still waiting on the second worker...
      expect(destructionResolved).toBe(false);

      worker2.__settlers.sendMessage.resolve();
      jest.runAllTicks();

      // Now all workers' destroy methods should've been called
      // (but not resolved yet)
      expect(destructionResolved).toBe(false);
      expect(worker1.destroy.mock.calls.length).toBe(1);
      expect(worker2.destroy.mock.calls.length).toBe(1);

      worker1.__settlers.destroy.resolve();
      worker2.__settlers.destroy.resolve();
      jest.runAllTicks();

      expect(destructionResolved).toBe(true);
    });
  });
});
