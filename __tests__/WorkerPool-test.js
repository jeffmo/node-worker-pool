require('mock-modules')
  .autoMockOff()
  .mock('child_process');

describe('WorkerPool', function() {
  var FAKE_WORKER_ARGS = ['--fakeArg1', '--fakeArg2=42'];
  var FAKE_WORKER_PATH = '/path/to/some/fake/worker';

  var child_process;
  var WorkerPool;

  beforeEach(function() {
    require('mock-modules').dumpCache();
    child_process = require('child_process');
    WorkerPool = require('../WorkerPool');
  });

  describe('eager/lazy booting of workers', function() {
    it('eagerly boots all workers on instantiation', function() {
      var pool = new WorkerPool(3, FAKE_WORKER_PATH, FAKE_WORKER_ARGS);
      expect(child_process.spawn.mock.calls.length).toBe(3);
    });

    it('lazily boots workers when lazyBoot flag is passed', function() {
      var pool = new WorkerPool(3, FAKE_WORKER_PATH, FAKE_WORKER_ARGS, true);
      expect(child_process.spawn.mock.calls.length).toBe(0);
      pool.sendMessage({value:1});
      expect(child_process.spawn.mock.calls.length).toBe(1);
      pool.sendMessage({value:2});
      expect(child_process.spawn.mock.calls.length).toBe(2);
      pool.sendMessage({value:3});
      expect(child_process.spawn.mock.calls.length).toBe(3);
    });

    it('does not lazily boot more than the max specified workers', function() {
      var pool = new WorkerPool(3, FAKE_WORKER_PATH, FAKE_WORKER_ARGS, true);
      pool.sendMessage({value:1});
      pool.sendMessage({value:2});
      pool.sendMessage({value:3});
      pool.sendMessage({value:4});
      expect(child_process.spawn.mock.calls.length).toBe(3);
    });
  });

  describe('sendMessage', function() {
    it('sends a message to only one worker', function() {
      var pool = new WorkerPool(2, FAKE_WORKER_PATH, FAKE_WORKER_ARGS);
      pool.sendMessage({value:1});
      var numSent = child_process.mockChildren.reduce(function(num, child) {
        return num + child.stdin.write.mock.calls.length
      }, 0);
      expect(numSent).toBe(1);
    });

    it('sends one message to a worker at a time', function() {
      var pool = new WorkerPool(2, FAKE_WORKER_PATH, FAKE_WORKER_ARGS);
      pool.sendMessage({value:1});
      pool.sendMessage({value:2});

      var sentMessages = {};
      expect(child_process.mockChildren.length).toBe(2);
      child_process.mockChildren.forEach(function(child) {
        // Since we have the same number of messages as workers, expect that
        // each worker should have recieved exactly one message
        expect(child.stdin.write.mock.calls.length).toBe(1);
        var msg = JSON.parse(child.stdin.write.mock.calls[0][0]).msg;

        // Make sure the message wasn't sent to another worker
        expect(sentMessages.hasOwnProperty(msg.value)).toBe(false);
        sentMessages[msg.value] = true;
      });
    });

    it('queues messages when all workers are busy', function() {
      var pool = new WorkerPool(2, FAKE_WORKER_PATH, FAKE_WORKER_ARGS);
      pool.sendMessage({value:1});
      pool.sendMessage({value:2});
      pool.sendMessage({value:3});

      // Only 2 messages should have been sent
      var childProcs = child_process.mockChildren;
      var numSentMessages = childProcs.reduce(function(numSent, child) {
        return child.stdin.write.mock.calls.length + numSent;
      }, 0);
      expect(numSentMessages).toBe(2);

      // Resolve a response from one of the children
      var onDataCallback = childProcs[0].stdout.on.mock.calls[0][1];
      onDataCallback(JSON.stringify({response:'hai'}));

      // Now 3 messages should have been sent
      var sentMessageValues = childProcs.reduce(function(msgs, child) {
        child.stdin.write.mock.calls.forEach(function(callArgs) {
          var msg = JSON.parse(callArgs[0]).msg;
          msgs[msg.value] = true;
        });
        return msgs;
      }, {});
      expect(sentMessageValues).toEqual({1:true, 2:true, 3:true});
    });
  });
});
