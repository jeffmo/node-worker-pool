require('mock-modules')
  .autoMockOff()
  .mock('../Worker');

describe('WorkerPool', function() {
  var FAKE_ARGS = ['--fakeArg1', '--fakeArg2=42'];
  var FAKE_INIT_DATA = {initData: 12345};
  var FAKE_PATH = '/path/to/some/fake/worker';

  var Q;
  var Worker;
  var WorkerPool;

  var _workerDestroyDeferreds;
  var _workerSendMessageDeferreds;

  function _arraySetsAreEqual(set1, set2) {
    if (set1.length !== set2.length) {
      return false;
    }

    var matchedIndexes = {};
    for (var i = 0; i < set1.length; i++) {
      var found = false;
      for (var j = 0; j < set2.length; j++) {
        if (matchedIndexes[j]) {
          continue;
        }

        if (jasmine.getEnv().equals_(set1[i], set2[j])) {
          found = true;
          matchedIndexes[j] = true;
          break;
        }
      }

      if (!found) {
        return false;
      }
    }
  }

  function _expectReject(promise, expectedError) {
    return promise.then(function() {
      throw new Error(
        'Expected promise to be rejected, but it was resolved!'
      );
    }, function(error) {
      if (expectedError) {
        expect(error).toEqual(expectedError);
      }
    });
  }

  function _getAllMessageSends() {
    return _getWorkerMessageSends().reduce(function(allSends, workerCall) {
      return workerCall.reduce(function(allSends, workerArgs) {
        return allSends.concat(workerArgs);
      }, allSends);
    }, []);
  }

  function _getWorkerMessageSends() {
    return (
      Worker.mock.instances
        .filter(function(inst) {
          return inst.sendMessage.mock.calls.length > 0;
        })
        .map(function(inst) {
          return inst.sendMessage.mock.calls;
        })
    );
  }

  beforeEach(function() {
    require('mock-modules').dumpCache();
    Q = require('q');
    Worker = require('../Worker');
    WorkerPool = require('../WorkerPool');

    this.addMatchers({
      toMatchArraySet: function(arraySet) {
        if (!Array.isArray(this.actual)) {
          throw new Error('Expected a non-array to match an array set!');
        }
        if (!Array.isArray(arraySet)) {
          throw new Error('Array sets have to be an array...');
        }

        if (this.actual.length !== arraySet.length) {
          return false;
        }

        var matchedIndexes = {};
        for (var i = 0; i < this.actual.length; i++) {
          var found = false;
          for (var j = 0; j < arraySet.length; j++) {
            if (matchedIndexes[j]) {
              continue;
            }

            if (jasmine.getEnv().equals_(this.actual[i], arraySet[j])) {
              found = true;
              matchedIndexes[j] = true;
              break;
            }
          }

          if (!found) {
            return false;
          }
        }

        return true;
      }
    });

    // TODO: Add support to jest for promise return values
    _workerDestroyDeferreds = [];
    _workerSendMessageDeferreds = [];
    Worker.prototype.destroy.mockImpl(function() {
      var deferred = Q.defer();
      _workerDestroyDeferreds.push(deferred);
      return deferred.promise;
    });
    Worker.prototype.sendMessage.mockImpl(function() {
      var deferred = Q.defer();
      _workerSendMessageDeferreds.push(deferred);
      return deferred.promise;
    });
  });

  describe('worker booting', function() {
    pit('eagerly boots all workers by default', function() {
      new WorkerPool(3, FAKE_PATH, FAKE_ARGS, {
        initData: FAKE_INIT_DATA
      });
      expect(Worker.mock.instances.length).toBe(3);
    });

    pit('lazily boots workers when lazyBoot flag is passed', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS, {
        initData: FAKE_INIT_DATA,
        lazyBoot: true
      });
      expect(Worker.mock.instances.length).toBe(0);

      pool.sendMessage({value: 1});
      expect(Worker.mock.instances.length).toBe(1);

      pool.sendMessage({value: 2});
      expect(Worker.mock.instances.length).toBe(2);

      pool.sendMessage({value: 3});
      expect(Worker.mock.instances.length).toBe(3);

      pool.sendMessage({value: 4});
      expect(Worker.mock.instances.length).toBe(3);
    });

    pit('passes correct worker args down to booted workers', function() {
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS, {
        initData: FAKE_INIT_DATA,
        printChildResponses: true
      });

      var passedArgs = Worker.mock.calls[0];
      expect(passedArgs.length).toBe(3);
      expect(passedArgs[0]).toBe(FAKE_PATH);
      expect(passedArgs[1]).toBe(FAKE_ARGS);
      expect(passedArgs[2].initData).toEqual(FAKE_INIT_DATA);
      expect(passedArgs[2].printChildResponses).toBe(true);
    });
  });

  describe('sendMessage', function() {
    pit('sends a message to only one worker', function() {
      var MESSAGE = {value: 1};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE);

      expect(_getWorkerMessageSends()).toEqual([
        [[MESSAGE]] // Worker 1
      ]);
    });

    pit('sends one message to a given worker at a time', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);

      expect(_getWorkerMessageSends()).toEqual([
        [[MESSAGE1]], // Worker 1
        [[MESSAGE2]]  // Worker 2
      ]);
    });

    pit('queues messages when all workers are busy', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var MESSAGE3 = {value: 3};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      pool.sendMessage(MESSAGE3);

      expect(_getAllMessageSends()).toMatchArraySet([
        MESSAGE1,
        MESSAGE2
      ]);

      _workerSendMessageDeferreds[0].resolve();
      mockRunTicksRepeatedly();

      expect(_getAllMessageSends()).toMatchArraySet([
        MESSAGE1,
        MESSAGE2,
        MESSAGE3
      ]);
    });

    pit('successfully moves on to next msg if first msg errored', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);

      expect(_getAllMessageSends()).toMatchArraySet([
        MESSAGE1
      ]);

      _workerSendMessageDeferreds[0].reject();
      mockRunTicksRepeatedly();

      expect(_getAllMessageSends()).toMatchArraySet([
        MESSAGE1,
        MESSAGE2
      ]);
    });

    pit('throws when sending a message after being destroyed', function() {
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);
      pool.destroy();
      expect(function() {
        pool.sendMessage({value: 1});
      }).toThrow(
        'Attempted to send a message after the worker pool has alread been ' +
        '(or is in the process of) shutting down!'
      );
    });

    pit('passes up response from worker for non-queued message', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 42};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);

      var response = pool.sendMessage(MESSAGE);
      _workerSendMessageDeferreds[0].resolve(RESPONSE);

      return response.then(function(response) {
        expect(response).toEqual(RESPONSE);
      });
    });

    pit('passes up response from worker for queued message', function() {
      var MESSAGE1 = {input: 42};
      var MESSAGE2 = {input: 43};
      var RESPONSE1 = {input: 42};
      var RESPONSE2 = {input: 43};
      var pool = new WorkerPool(1, FAKE_PATH, FAKE_ARGS);

      // The first message occupies the only available worker
      pool.sendMessage(MESSAGE1);
      var firstResponseDeferred = _workerSendMessageDeferreds[0];

      // The second message is queued because there are no available workers
      var queuedMsgResponse = pool.sendMessage(MESSAGE2);

      // Free the only available worker by sending a response from it.
      // This should cause the second (queued) message to be sent to the worker.
      firstResponseDeferred.resolve(RESPONSE1);
      mockRunTicksRepeatedly();

      // Respond to the second message passed to the single worker
      _workerSendMessageDeferreds.filter(function(deferred) {
        return deferred !== firstResponseDeferred;
      }).pop().resolve(RESPONSE2);

      return queuedMsgResponse.then(function(response) {
        expect(response).toEqual(RESPONSE2);
      });
    });
  });

  describe('sendMessageToAllWorkers', function() {
    pit('sends message to all workers when all workers are free', function() {
      var MESSAGE = {value: 1};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);

      var onAllResponses = pool.sendMessageToAllWorkers(MESSAGE);
      mockRunTicksRepeatedly();

      _workerSendMessageDeferreds.forEach(function(deferred) {
        deferred.resolve();
      });

      expect(_getWorkerMessageSends()).toEqual([
        [[MESSAGE]], // Worker 1
        [[MESSAGE]] // Worker 2
      ]);
    });

    pit('sends message to all workers when all workers are busy', function() {
      var BUSY_MESSAGE = {value: 1};
      var MESSAGE_TO_ALL = {value: 2};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);

      // Occupy all children
      pool.sendMessage(BUSY_MESSAGE);
      pool.sendMessage(BUSY_MESSAGE);
      mockRunTicksRepeatedly();

      // Confirm that BUSY_MESSAGE was sent to all children
      expect(_getWorkerMessageSends()).toEqual([
        [[BUSY_MESSAGE]], // Worker 1
        [[BUSY_MESSAGE]] // Worker 2
      ]);

      // Send a message to all workers while they're all busy
      var onAllResponses = pool.sendMessageToAllWorkers(MESSAGE_TO_ALL);
      mockRunTicksRepeatedly();

      // Simulate responses for the busy work
      _workerSendMessageDeferreds.forEach(function(deferred) {
        deferred.resolve();
      });
      mockRunTicksRepeatedly();

      // Simulate responses for the messages sent to all workers
      _workerSendMessageDeferreds.forEach(function(deferred) {
        deferred.resolve();
      });
      mockRunTicksRepeatedly();

      expect(_getWorkerMessageSends()).toEqual([
        [[BUSY_MESSAGE], [MESSAGE_TO_ALL]], // Worker 1
        [[BUSY_MESSAGE], [MESSAGE_TO_ALL]], // Worker 2
      ]);
    });

    pit('does not send the message to the same worker twice', function() {
      var BUSY_MESSAGE = {value: 1};
      var MESSAGE_TO_ALL = {value: 2};
      var pool = new WorkerPool(2, FAKE_PATH, FAKE_ARGS);

      // Occupy all children
      pool.sendMessage(BUSY_MESSAGE);
      pool.sendMessage(BUSY_MESSAGE);
      mockRunTicksRepeatedly();

      // Confirm that BUSY_MESSAGE was sent to all children
      expect(_getWorkerMessageSends()).toEqual([
        [[BUSY_MESSAGE]], // Worker 1
        [[BUSY_MESSAGE]] // Worker 2
      ]);

      // Send a message to all workers while they're all busy
      var onAllResponses = pool.sendMessageToAllWorkers(MESSAGE_TO_ALL);
      mockRunTicksRepeatedly();

      // Simulate response for the busy work on the first child
      // (but leave the second child busy)
      _workerSendMessageDeferreds[0].resolve();
      mockRunTicksRepeatedly();

      // Simulate response for the MESSAGE_TO_ALL sent to the first child
      // (note that the second child is still occupied with the busy msg)
      _workerSendMessageDeferreds[2].resolve();
      mockRunTicksRepeatedly();

      // Assert that only the first child has received the MESSAGE_TO_ALL
      // (and it was not mistakenly sent twice to the first child)
      expect(_getWorkerMessageSends()).toEqual([
        [[BUSY_MESSAGE], [MESSAGE_TO_ALL]], // Worker 1
        [[BUSY_MESSAGE]] // Worker 2
      ]);

      // Finally simulate a response for the busy work on the first child
      _workerSendMessageDeferreds[1].resolve();
      mockRunTicksRepeatedly();

      expect(_getWorkerMessageSends()).toEqual([
        [[BUSY_MESSAGE], [MESSAGE_TO_ALL]], // Worker 1
        [[BUSY_MESSAGE], [MESSAGE_TO_ALL]] // Worker 2
      ]);
    });
  });

  describe('destroy', function() {
    pit('destroys all workers', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);

      pool.destroy();
      mockRunTicksRepeatedly();

      expect(Worker.mock.instances.length).toBe(3);
      expect(Worker.mock.instances[0].destroy.mock.calls.length).toBe(1);
      expect(Worker.mock.instances[1].destroy.mock.calls.length).toBe(1);
      expect(Worker.mock.instances[2].destroy.mock.calls.length).toBe(1);
    });

    pit('waits for all workers to be destroyed before resolving', function() {
      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      var poolIsDestroyed = false;
      var destroyPool = pool.destroy().then(function() {
        poolIsDestroyed = true;
      });
      mockRunTicksRepeatedly();
      expect(poolIsDestroyed).toBe(false);

      _workerDestroyDeferreds.forEach(function(workerDestroyDeferred) {
        workerDestroyDeferred.resolve();
      });

      return destroyPool.then(function() {
        expect(poolIsDestroyed).toBe(true);
      });
    });

    pit('waits for pending messages to finish before resolving', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};

      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      mockRunTicksRepeatedly();

      var poolIsDestroyed = false;
      var destroyPool = pool.destroy().then(function() {
        poolIsDestroyed = true;
      });
      mockRunTicksRepeatedly();
      expect(poolIsDestroyed).toBe(false);

      // Resolve pending message responses
      _workerSendMessageDeferreds.forEach(function(deferred) {
        deferred.resolve({response: 'hai!'});
      });
      mockRunTicksRepeatedly();

      // But we're still waiting on workers to actually destroy themselves...
      expect(poolIsDestroyed).toBe(false);

      // Resolve worker destroy deferreds
      _workerDestroyDeferreds.forEach(function(workerDestroyDeferred) {
        workerDestroyDeferred.resolve();
      });
      mockRunTicksRepeatedly();

      expect(poolIsDestroyed).toBe(true);
    });

    pit('resolves when waiting on pending response that errors', function() {
      var MESSAGE1 = {value: 1};
      var MESSAGE2 = {value: 2};

      var pool = new WorkerPool(3, FAKE_PATH, FAKE_ARGS);
      pool.sendMessage(MESSAGE1);
      pool.sendMessage(MESSAGE2);
      mockRunTicksRepeatedly();

      var poolIsDestroyed = false;
      var destroyPool = pool.destroy().then(function() {
        poolIsDestroyed = true;
      });
      mockRunTicksRepeatedly();
      expect(poolIsDestroyed).toBe(false);

      // Reject one of the pending message responses
      _workerSendMessageDeferreds.pop().reject({error: 'Worker Message Error!'});

      // Resolve pending message responses
      _workerSendMessageDeferreds.forEach(function(deferred) {
        deferred.resolve({response: 'hai!'});
      });
      mockRunTicksRepeatedly();

      // But we're still waiting on workers to actually destroy themselves...
      expect(poolIsDestroyed).toBe(false);

      // Resolve worker destroy deferreds
      _workerDestroyDeferreds.forEach(function(workerDestroyDeferred) {
        workerDestroyDeferred.resolve();
      });
      mockRunTicksRepeatedly();

      expect(poolIsDestroyed).toBe(true);
    });
  });
});
