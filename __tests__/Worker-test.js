jest
  .autoMockOff()
  .mock('child_process');

describe('Worker', function() {
  var FAKE_ARGS = ['--fakeArg1', '--fakeArg2=42'];
  var FAKE_PATH = '/path/to/some/fake/worker';

  var child_process;
  var Worker;

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

  function _expectRejection(promise, expectedError) {
    var rejection = null;
    promise.catch(function(err) {
      rejection = err;
    });

    var resolution = null;
    promise.then(function(result) {
      resolution = result;
    });

    jest.runAllTicks();

    if (rejection === null) {
      var msg = 'Expected promise to be rejected, but instead it was ';
      if (resolution === null) {
        msg += 'not settled at all!';
      } else {
        msg += 'resolved.';
      }
      throw new Error(msg);
    } else if (expectedError !== undefined) {
      expect(rejection).toEqual(expectedError);
    }
  }

  function _simulateInitResponse() {
    _simulateRawResponse(JSON.stringify({initSuccess: true}));
  }

  function _simulateRawResponse(responseStr) {
    var mockChildren = child_process.mockChildren;
    var onStdoutCallback = mockChildren[0].stdout.on.mock.calls[0][1];
    onStdoutCallback(responseStr);
  }

  function _simulateResponse(response) {
    _simulateRawResponse(JSON.stringify({response: response}));
  }

  beforeEach(function() {
    child_process = require('child_process');
    Worker = require('../Worker');
  });

  pit('boots a child process with the supplied path/args', function() {
    new Worker(FAKE_PATH, FAKE_ARGS);
    expect(child_process.spawn.mock.calls).toEqual([
      [FAKE_PATH, FAKE_ARGS]
    ]);
  });

  describe('options', function() {
    describe('initData', function() {
      pit('writes empty init data to child process on boot', function() {
        new Worker(FAKE_PATH, FAKE_ARGS);

        var mockChildren = child_process.mockChildren;
        var initData = mockChildren[0].stdin.write.mock.calls[0][0];
        expect(initData).toEqual(JSON.stringify({initData: undefined}));
      });

      pit('writes non-empty init data to child process on boot', function() {
        var INIT_DATA = {data: 42};
        new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

        var mockChildren = child_process.mockChildren;
        var initData = mockChildren[0].stdin.write.mock.calls[0][0];
        expect(initData).toEqual(JSON.stringify({initData: INIT_DATA}));
      });

      pit('throws when an initError is received', function() {
        new Worker(FAKE_PATH, FAKE_ARGS);
        expect(function() {
          _simulateRawResponse(JSON.stringify({initError: 'initError!'}));
        }).toThrow('Error initializing worker: initError!');
      });

      pit('throws when an invalid init response is received', function() {
        new Worker(FAKE_PATH, FAKE_ARGS);
        expect(function() {
          _simulateRawResponse(JSON.stringify({notAnInitResponse: true}));
        }).toThrow(
          'Invalid initialization response received: {"notAnInitResponse":true}'
        );
      });
    });

    describe('printChildResponses', function() {
      var origConsoleLog;

      function _generateResponseString(name, response) {
        return (
          '----Start Worker Responses (' + name + ')----\n' +
          response + '\n' +
          '----End Worker Responses (' + name + ')----\n'
        );
      }

      beforeEach(function() {
        origConsoleLog = console.log;
        console.log = require('mocks').getMockFunction();
      });

      afterEach(function() {
        console.log = origConsoleLog;
      });

      pit('does not print responses when not specified (default)', function() {
        var MESSAGE = {input: 42};
        var RESPONSE = {output: 43};

        var worker = new Worker(FAKE_PATH, FAKE_ARGS);

        _simulateInitResponse();
        jest.runAllTicks();

        worker.sendMessage(MESSAGE);
        jest.runAllTicks();

        _simulateResponse(RESPONSE);
        jest.runAllTicks();

        expect(console.log.mock.calls.length).toBe(0);
      });

      pit('does not print responses when off', function() {
        var MESSAGE = {input: 42};
        var RESPONSE = {output: 43};

        var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
          printChildResponses: false
        });

        _simulateInitResponse();
        jest.runAllTicks();

        worker.sendMessage(MESSAGE);
        jest.runAllTicks();

        _simulateResponse(RESPONSE);
        jest.runAllTicks();

        expect(console.log.mock.calls.length).toBe(0);
      });
      pit('prints unnamed child responses when on', function() {
        var MESSAGE = {input: 42};
        var RESPONSE = {output: 43};
        var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
          printChildResponses: true
        });

        _simulateInitResponse();
        jest.runAllTicks();

        worker.sendMessage(MESSAGE);
        jest.runAllTicks();

        _simulateResponse(RESPONSE);
        jest.runAllTicks();

        expect(console.log.mock.calls).toEqual([
          [
            _generateResponseString(
              'unnamed',
              JSON.stringify([{initSuccess: true}], null, 2)
            )
          ],
          [
            _generateResponseString(
              'unnamed',
              JSON.stringify([{response: RESPONSE}], null, 2)
            )
          ]
        ]);
      });

      pit('prints named child responses when on', function() {
        var MESSAGE = {input: 42};
        var NAME = 'BARNABY';
        var RESPONSE = {output: 43};

        var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
          printChildResponses: true,
          workerName: NAME
        });

        _simulateInitResponse();
        jest.runAllTicks();

        worker.sendMessage(MESSAGE);
        jest.runAllTicks();

        _simulateResponse(RESPONSE);
        jest.runAllTicks();

        expect(console.log.mock.calls).toEqual([
          [
            _generateResponseString(
              NAME,
              JSON.stringify([{initSuccess: true}], null, 2)
            )
          ],
          [
            _generateResponseString(
              NAME,
              JSON.stringify([{response: RESPONSE}], null, 2)
            )
          ]
        ]);
      });
    });
  });

  describe('destroy', function() {
    pit('waits for initialization to finish', function() {
      var INIT_DATA = {init: 7};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

      worker.destroy();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].kill.mock.calls.length).toBe(0);

      _simulateInitResponse();
      jest.runAllTicks();

      expect(mockChildren[0].kill.mock.calls.length).toBe(1);
    });

    pit('waits for pending message to finish', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});
      _simulateInitResponse();
      jest.runAllTicks();

      worker.sendMessage(MESSAGE);
      jest.runAllTicks();

      worker.destroy();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].kill.mock.calls.length).toBe(0);

      _simulateResponse(RESPONSE);
      jest.runAllTicks();
      expect(mockChildren[0].kill.mock.calls.length).toBe(1);
    });

    pit('destroys even when a pending message bubbles an error', function() {
      var MESSAGE = {input: 42};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      jest.runAllTicks();

      worker.sendMessage(MESSAGE);
      jest.runAllTicks();

      worker.destroy();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].kill.mock.calls.length).toBe(0);

      _simulateRawResponse(JSON.stringify({error: 'Error message'}));
      jest.runAllTicks();
      expect(mockChildren[0].kill.mock.calls.length).toBe(1);
    });
  });

  describe('sendMessage', function() {
    it('queues messages to be sent only after initialization', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

      worker.sendMessage(MESSAGE);
      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})]
      ]);

      _simulateInitResponse();
      jest.runAllTicks();

      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})],
        [JSON.stringify({message: MESSAGE})]
      ]);
    });

    it('sends messages sent after initialization', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

      _simulateInitResponse();
      jest.runAllTicks();

      worker.sendMessage(MESSAGE);
      jest.runAllTicks();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})],
        [JSON.stringify({message: MESSAGE})]
      ]);
    });

    it('throws when child writes an unexpected response', function() {
      new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      jest.runAllTicks();

      // No message was sent to the worker, so if the child sends us a response
      // the worker should throw
      expect(function() {
        _simulateResponse({output: 42});
      }).toThrow(
        'Received unexpected data from child process: ' +
        '{"response":{"output":42}}'
      );
    });

    it('resolves when a response is received', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();

      _simulateResponse(RESPONSE);

      var responseReceived = false;
      promise.then(function(response) {
        responseReceived = true;
        expect(response).toEqual(RESPONSE);
      });

      jest.runAllTicks();
      expect(responseReceived).toBe(true);
    });

    it('throws when sending a second message before 1st response', function() {
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      worker.sendMessage({messageNumber: 1});
      expect(function() {
        worker.sendMessage({messageNumber: 2});
      }).toThrow(
        'Attempted to send a message to the worker before the response from ' +
        'the last message was received! Worker processes can only handle one ' +
        'message at a time.'
      );
    });

    pit('allows second message after first message response', function() {
      var MESSAGE1 = {input: 42};
      var MESSAGE2 = {input: 43};
      var RESPONSE1 = {output: 42};
      var RESPONSE2 = {output: 43};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      jest.runAllTicks();

      var response1 = worker.sendMessage(MESSAGE1);
      jest.runAllTicks();
      _simulateResponse(RESPONSE1);

      return response1.then(function(response) {
        expect(response).toEqual(RESPONSE1);

        var response2 = worker.sendMessage(MESSAGE2);
        jest.runAllTicks();
        _simulateResponse(RESPONSE2);

        return response2;
      }).then(function(response) {
        expect(response).toEqual(RESPONSE2);
      });
    });

    pit('allows second message after first message error response', function() {
      var MESSAGE1 = {input: 42};
      var MESSAGE2 = {input: 43};
      var RESPONSE1 = {errorMsg: 'hai'};
      var RESPONSE2 = {output: 43};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      jest.runAllTicks();

      var response1 = worker.sendMessage(MESSAGE1);
      jest.runAllTicks();
      _simulateRawResponse(JSON.stringify({error: RESPONSE1}));

      return response1.catch(function(response) {
        expect(response).toEqual(RESPONSE1);

        var response2 = worker.sendMessage(MESSAGE2);
        jest.runAllTicks();
        _simulateResponse(RESPONSE2);

        return response2;
      }).then(function(response) {
        expect(response).toEqual(RESPONSE2);
      });
    });

    pit('allows second message after malformed response', function() {
      var MESSAGE1 = {input: 42};
      var MESSAGE2 = {input: 43};
      var RESPONSE1 = {IIMM: 'CRRAAZYY'};
      var RESPONSE2 = {output: 43};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      jest.runAllTicks();

      var response1 = worker.sendMessage(MESSAGE1);
      jest.runAllTicks();
      var rawResponse = JSON.stringify({UNEXPECTED: RESPONSE1});
      _simulateRawResponse(rawResponse);

      return response1.catch(function(response) {
        expect(response).toEqual(new Error(
          'Malformed child response message: ' + rawResponse
        ));

        var response2 = worker.sendMessage(MESSAGE2);
        jest.runAllTicks();
        _simulateResponse(RESPONSE2);

        return response2;
      }).then(function(response) {
        expect(response).toEqual(RESPONSE2);
      });
    });

    pit('handles chunked responses', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();

      var fullResponse = JSON.stringify({response: RESPONSE});
      var firstHalf = fullResponse.substr(0, 4);
      var secondHalf = fullResponse.substr(4);
      _simulateRawResponse(firstHalf);
      _simulateRawResponse(secondHalf);

      return promise.then(function(response) {
        expect(response).toEqual(RESPONSE);
      });
    });

    it('rejects when an error is received', function() {
      var MESSAGE = {input: 42};
      var ERROR = 'This is an error message!';
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();
      _simulateRawResponse(JSON.stringify({error: ERROR}));
      jest.runAllTicks();

      _expectRejection(promise, ERROR);
    });

    pit('rejects when malformed response is received', function() {
      var MESSAGE = {input: 42};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();
      _simulateRawResponse(JSON.stringify({UNEXPECTED: 'blah'}));

      return _expectReject(promise);
    });

    pit('rejects when multiple responses are received', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();

      var responseStr = JSON.stringify({response: RESPONSE});
      _simulateRawResponse(responseStr + responseStr);

      return _expectReject(promise);
    });

    it('throws when the worker has already been destroyed', function() {
      var MESSAGE = {input: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);

      worker.destroy();

      expect(function() {
        worker.sendMessage(MESSAGE);
      }).toThrow(
        'Attempted to send a message to a worker that has been (or is in the ' +
        'process of being) destroyed!'
      );
    });

    it('throws when child process exits before initializing', function() {
      var MESSAGE = {input: 42};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      //_simulateInitResponse();
      //jest.runAllTicks();

      var mockChild = child_process.mockChildren[0];
      var exitCallbacks = mockChild.on.mock.calls
        .filter(function(call) {
          if (call[0] === 'exit') {
            return true;
          }
        })
        .map(function(call) {
          return call[1];
        });

      expect(exitCallbacks.length).toBe(1);
      expect(function() {
        exitCallbacks[0](1, 'SIGINT');
      }).toThrow();
    });

    it('rejects when child process exits before responding', function() {
      var MESSAGE = {input: 42};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();

      var mockChild = child_process.mockChildren[0];
      mockChild.on.mock.calls
        .filter(function(call) {
          if (call[0] === 'exit') {
            return true;
          }
        })
        .forEach(function(call) {
          var exitCallback = call[1];
          exitCallback(1, 'SIGINT');
        });

      _expectRejection(promise);
    });

    it('attempts to re-boot the child process if the process exits before ' +
       'responding to a message', function() {
      var MESSAGE = {input: 42};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      jest.runAllTicks();

      expect(child_process.mockChildren.length).toBe(1);
      var mockChild = child_process.mockChildren[0];
      mockChild.on.mock.calls
        .filter(function(call) {
          if (call[0] === 'exit') {
            return true;
          }
        })
        .forEach(function(call) {
          var exitCallback = call[1];
          exitCallback(1, 'SIGINT');
        });

      _expectRejection(promise);

      // After rejection, the Worker should have attempted to spawn a second
      // child process to replace the failed first process
      expect(child_process.mockChildren.length).toBe(2);
    });
  });
});
