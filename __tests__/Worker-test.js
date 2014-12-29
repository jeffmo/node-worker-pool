'use strict';

jest
  .autoMockOff()
  .mock('child_process');

describe('Worker', function() {
  var FAKE_ARGS = ['--fakeArg1', '--fakeArg2=42'];
  var FAKE_PATH = '/path/to/some/fake/worker';

  var child_process;
  var Worker;

  function _simulateInitResponse(mockChildIdx) {
    _simulateRawResponse(
      JSON.stringify({initSuccess: true}),
      mockChildIdx
    );
  }

  function _simulateRawResponse(responseStr, mockChildIdx) {
    if (mockChildIdx === undefined) {
      mockChildIdx = 0;
    }

    var mockChildren = child_process.mockChildren;
    var onStdoutCallback =
      mockChildren[mockChildIdx].stdout.on.mock.calls[0][1];
    onStdoutCallback(responseStr);
  }

  function _simulateResponse(response, mockChildIdx) {
    _simulateRawResponse(
      JSON.stringify({response: response}),
      mockChildIdx
    );
  }

  beforeEach(function() {
    child_process = require('child_process');
    Worker = require('../Worker');
  });

  it('boots a child process with the supplied path/args', function() {
    new Worker(FAKE_PATH, FAKE_ARGS);
    expect(child_process.spawn.mock.calls).toEqual([
      [FAKE_PATH, FAKE_ARGS]
    ]);
  });

  it('throws on data without a pending message response', function() {
    new Worker(FAKE_PATH, FAKE_ARGS);

    _simulateInitResponse();
    jest.runAllTicks();

    expect(function() {
      _simulateResponse({uninvitedData: 42});
    }).toThrow(
      'Received unexpected data from child process: ' +
      '{"response":{"uninvitedData":42}}'
    );
  });

  it('throws when child process exits before initializing', function() {
    new Worker(FAKE_PATH, FAKE_ARGS);
    var mockChild = child_process.mockChildren[0];

    var onChildExitCallbacks = mockChild.on.mock.calls
      .filter(function(call) {
        return call[0] === 'exit';
      })
      .map(function(call) {
        return call[1];
      });

    expect(onChildExitCallbacks.length).toBe(1);
    expect(function() {
      onChildExitCallbacks[0](1, 'SIGINT');
    }).toThrow(
      'Worker process exited before it could be initialized! ' +
      'exit code: 1, exit signal: SIGINT\n' +
      'stderr:\n' +
      '  \n'
    );
  });

  describe('options.initData', function() {
    it('writes init data to child on boot', function() {
      var INIT_DATA = {value: 1};

      new Worker(FAKE_PATH, FAKE_ARGS, {
        initData: INIT_DATA
      });
      var mockChild = child_process.mockChildren[0];
      expect(mockChild.stdin.write.mock.calls.length).toBe(1);
      var data = JSON.parse(mockChild.stdin.write.mock.calls[0][0]);
      expect(data).toEqual({initData: INIT_DATA});
    });

    it('throws when an init error is received', function() {
      new Worker(FAKE_PATH, FAKE_ARGS);
      expect(function() {
        _simulateRawResponse(JSON.stringify({initError: 'initError!'}));
      }).toThrow('Error initializing worker: initError!');
    });

    it('throws when an invalid init response is received', function() {
      new Worker(FAKE_PATH, FAKE_ARGS);
      expect(function() {
        _simulateRawResponse(JSON.stringify({totallyRandomMsg: 42}));
      }).toThrow(
        'Invalid initialization response received: {"totallyRandomMsg":42}'
      );
    });
  });

  describe('destroy', function() {
    // TODO
  });

  describe('sendMessage', function() {
    it('queues a message sent before initialization has completed', function() {
      var INIT_DATA = {init: 'data'};
      var MESSAGE = {value: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
        initData: INIT_DATA
      });
      var mockChild = child_process.mockChildren[0];

      // Send a message (even before the child has confirmed successful
      // initialization)
      worker.sendMessage(MESSAGE);
      jest.runAllTicks();

      var stdinWriteCalls = mockChild.stdin.write.mock.calls;

      // Only the initialization message should have been sent at this point
      expect(stdinWriteCalls.length).toBe(1);

      _simulateInitResponse();
      jest.runAllTicks();

      // Now the initialization message + the user message should have been sent
      expect(stdinWriteCalls.length).toBe(2);
      var data = JSON.parse(stdinWriteCalls[1][0]);
      expect(data).toEqual({
        message: MESSAGE
      });
    });

    it('sends messages sent after initialization has completed', function() {
      var MESSAGE = {value: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      var mockChild = child_process.mockChildren[0];

      _simulateInitResponse();
      jest.runAllTicks();

      worker.sendMessage(MESSAGE);
      jest.runAllTicks();

      var stdinWriteCalls = mockChild.stdin.write.mock.calls;
      expect(stdinWriteCalls.length).toBe(2);
      var data = JSON.parse(stdinWriteCalls[1][0]);
      expect(data).toEqual({
        message: MESSAGE
      });
    });

    it('resolves when a valid response is received', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var response = null;
      worker.sendMessage(MESSAGE).done(function(value) {
        response = value;
      });
      jest.runAllTicks();

      expect(response).toBe(null);

      _simulateResponse(RESPONSE);
      jest.runAllTicks();

      expect(response).toEqual(RESPONSE);
    });

    it('resolves after child process exits if reboot/retry works', function() {
      var MESSAGE = {input: 1};
      var RESPONSE = {output: 2};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      var mockChild = child_process.mockChildren[0];

      // Initialize first child worker
      _simulateInitResponse();
      jest.runAllTicks();

      // Send a message (and record any rejections we get)
      var response = null;
      worker.sendMessage(MESSAGE).done(function(res) {
        response = res;
      });
      jest.runAllTicks();

      // Find and call the onChildExit callback to simulate the child executing
      // prematurely
      var onChildExitCallbacks = mockChild.on.mock.calls
        .filter(function(call) {
          return call[0] === 'exit';
        })
        .map(function(call) {
          return call[1];
        });
      expect(onChildExitCallbacks.length).toBe(1);
      onChildExitCallbacks[0](1, 'SIGINT');
      jest.runAllTicks();

      // At this point, the worker should try to reboot the child process (once)
      // and re-send the message (once) before giving up.
      expect(response).toBe(null);
      expect(child_process.mockChildren.length).toBe(2);

      // Simulate initialization of the second child process
      _simulateInitResponse();
      jest.runAllTicks();

      // Simulate the new, fresh child process responding properly this time
      _simulateResponse(RESPONSE, 1);
      jest.runAllTicks();

      // Assert that the message promise has now finally been rejected
      expect(response).toEqual(RESPONSE);
    });

    it('rejects when a valid error response is received', function() {
      var MESSAGE = {input: 42};
      var ERROR = {nope: 43};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var errResponse = null;
      worker.sendMessage(MESSAGE).catch(function(err) {
        errResponse = err;
      }).done();
      jest.runAllTicks();

      expect(errResponse).toBe(null);

      _simulateRawResponse(JSON.stringify({error: ERROR}));
      jest.runAllTicks();

      expect(errResponse).toEqual(ERROR);
    });

    it('rejects when child writes confusing response to a message', function() {
      var MESSAGE = {value: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var rejection = null;
      worker.sendMessage(MESSAGE).catch(function(err) {
        rejection = err;
      }).done();
      jest.runAllTicks();

      _simulateRawResponse(JSON.stringify({invalidResponseMessage: 42}));
      jest.runAllTicks();

      expect(rejection.message).toBe(
        'Confusing child response message: {"invalidResponseMessage":42}'
      );
    });

    it('rejects after reboot/retry of child process still fails', function() {
      var MESSAGE = {value: 1};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      var mockChild = child_process.mockChildren[0];

      // Initialize first child worker
      _simulateInitResponse();
      jest.runAllTicks();

      // Send a message (and record any rejections we get)
      var rejection = null;
      worker.sendMessage(MESSAGE).catch(function(err) {
        rejection = err;
      }).done();
      jest.runAllTicks();

      // Find and call the onChildExit callback to simulate the child executing
      // prematurely
      var onChildExitCallbacks = mockChild.on.mock.calls
        .filter(function(call) {
          return call[0] === 'exit';
        })
        .map(function(call) {
          return call[1];
        });
      expect(onChildExitCallbacks.length).toBe(1);
      onChildExitCallbacks[0](1, 'SIGINT');
      jest.runAllTicks();

      // At this point, the worker should try to reboot the child process (once)
      // and re-send the message (once) before giving up.
      expect(rejection).toBe(null);
      expect(child_process.mockChildren.length).toBe(2);

      // Simulate initialization of the second child process
      _simulateInitResponse(1);
      jest.runAllTicks();

      // Again, find and execute the onChildExit callback for the second child
      // process now to simulate it too exiting prematurely
      mockChild = child_process.mockChildren[1];
      onChildExitCallbacks = mockChild.on.mock.calls
        .filter(function(call) {
          return call[0] === 'exit';
        })
        .map(function(call) {
          return call[1];
        });
      expect(onChildExitCallbacks.length).toBe(1);
      onChildExitCallbacks[0](1, 'SIGINT');
      jest.runAllTicks();

      // Assert that the message promise has now finally been rejected
      expect(rejection.message).toBe(
        'Worker process exited before responding! ' +
        'exit code: 1, exit signal: SIGINT\n' +
        'stderr:\n' +
        '  \n'
      );
    });

    it('rejects when sending a second message before receiving first response',
       function() {
      var MESSAGE1 = {value: 42};
      var MESSAGE2 = {value: 43};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      worker.sendMessage(MESSAGE1).done();
      var rejected = null;
      worker.sendMessage(MESSAGE2).catch(function(err) {
        rejected = err;
      }).done();
      jest.runAllTicks();

      expect(rejected.message).toBe(
        'Attempted to send a message to the worker before the response from ' +
        'a previous message was received! Workers can only process one ' +
        'message at a time.'
      );
    });

    it('handles second message after first message response', function() {
      var MESSAGE1 = {value: 42};
      var MESSAGE2 = {value: 43};
      var RESPONSE1 = {output: 44};
      var RESPONSE2 = {output: 45};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var response1 = null;
      worker.sendMessage(MESSAGE1).done(function(response) {
        response1 = response;
      });
      jest.runAllTicks();

      _simulateResponse(RESPONSE1);
      jest.runAllTicks();

      expect(response1).toEqual(RESPONSE1);

      var response2 = null;
      worker.sendMessage(MESSAGE2).done(function(response) {
        response2 = response;
      });
      jest.runAllTicks();

      _simulateResponse(RESPONSE2);
      jest.runAllTicks();

      expect(response2).toEqual(RESPONSE2);
    });

    it('handles second message after first message error response', function() {
      var MESSAGE1 = {input: 42};
      var MESSAGE2 = {input: 43};
      var ERROR1 = {emsg: 'hai'};
      var RESPONSE2 = {output: 44};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var response1 = null;
      worker.sendMessage(MESSAGE1).catch(function(response) {
        response1 = response;
      }).done();
      jest.runAllTicks();

      _simulateRawResponse(JSON.stringify({error: ERROR1}));
      jest.runAllTicks();

      expect(response1).toEqual(ERROR1);

      var response2 = null;
      worker.sendMessage(MESSAGE2).done(function(response) {
        response2 = response;
      });
      jest.runAllTicks();

      _simulateResponse(RESPONSE2);
      jest.runAllTicks();

      expect(response2).toEqual(RESPONSE2);
    });

    it('handles chunked responses', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      _simulateInitResponse();
      jest.runAllTicks();

      var response = null;
      worker.sendMessage(MESSAGE).done(function(resp) {
        response = resp;
      });
      jest.runAllTicks();

      var fullResponse = JSON.stringify({response: RESPONSE});
      var firstPart = fullResponse.substr(0, 4);
      var secondPart = fullResponse.substr(4);
      _simulateRawResponse(firstPart);
      jest.runAllTicks();

      expect(response).toBe(null);

      _simulateRawResponse(secondPart);
      jest.runAllTicks();

      expect(response).toEqual(RESPONSE);
    });

    it('throws when the worker has already been destroyed', function() {
      var MESSAGE = {value: 1};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      worker.destroy();

      expect(function() {
        worker.sendMessage(MESSAGE);
      }).toThrow(
        'Attempted to send a message to a worker that has already been or is ' +
        'in the process of shutting down!'
      );
    });
  });
});
