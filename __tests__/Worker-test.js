require('mock-modules')
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
    require('mock-modules').dumpCache();
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
        mockRunTicksRepeatedly();

        worker.sendMessage(MESSAGE);
        mockRunTicksRepeatedly();

        _simulateResponse(RESPONSE);
        mockRunTicksRepeatedly();

        expect(console.log.mock.calls.length).toBe(0);
      });

      pit('does not print responses when off', function() {
        var MESSAGE = {input: 42};
        var RESPONSE = {output: 43};

        var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
          printChildResponses: false
        });

        _simulateInitResponse();
        mockRunTicksRepeatedly();

        worker.sendMessage(MESSAGE);
        mockRunTicksRepeatedly();

        _simulateResponse(RESPONSE);
        mockRunTicksRepeatedly();

        expect(console.log.mock.calls.length).toBe(0);
      });
      pit('prints unnamed child responses when on', function() {
        var MESSAGE = {input: 42};
        var RESPONSE = {output: 43};
        var worker = new Worker(FAKE_PATH, FAKE_ARGS, {
          printChildResponses: true
        });

        _simulateInitResponse();
        mockRunTicksRepeatedly();

        worker.sendMessage(MESSAGE);
        mockRunTicksRepeatedly();

        _simulateResponse(RESPONSE);
        mockRunTicksRepeatedly();

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
        mockRunTicksRepeatedly();

        worker.sendMessage(MESSAGE);
        mockRunTicksRepeatedly();

        _simulateResponse(RESPONSE);
        mockRunTicksRepeatedly();

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
      mockRunTicksRepeatedly();

      expect(mockChildren[0].kill.mock.calls.length).toBe(1);
    });

    pit('waits for pending message to finish', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};

      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});
      _simulateInitResponse();
      mockRunTicksRepeatedly();

      worker.sendMessage(MESSAGE);
      mockRunTicksRepeatedly();

      worker.destroy();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].kill.mock.calls.length).toBe(0);

      _simulateResponse(RESPONSE);
      mockRunTicksRepeatedly();
      expect(mockChildren[0].kill.mock.calls.length).toBe(1);
    });
  });

  describe('sendMessage', function() {
    pit('queues messages to be sent only after initialization', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

      worker.sendMessage(MESSAGE);
      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})]
      ]);

      _simulateInitResponse();
      mockRunTicksRepeatedly();

      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})],
        [JSON.stringify({message: MESSAGE})]
      ]);
    });

    pit('sends messages sent after initialization', function() {
      var INIT_DATA = {init: 7};
      var MESSAGE = {input: 42};
      var worker = new Worker(FAKE_PATH, FAKE_ARGS, {initData: INIT_DATA});

      _simulateInitResponse();
      mockRunTicksRepeatedly();

      worker.sendMessage(MESSAGE);
      mockRunTicksRepeatedly();

      var mockChildren = child_process.mockChildren;
      expect(mockChildren[0].stdin.write.mock.calls).toEqual([
        [JSON.stringify({initData: INIT_DATA})],
        [JSON.stringify({message: MESSAGE})]
      ]);
    });

    pit('throws when child writes an unexpected response', function() {
      new Worker(FAKE_PATH, FAKE_ARGS);
      _simulateInitResponse();
      mockRunTicksRepeatedly();

      // No message was sent to the worker, so if the child sends us a response
      // the worker should throw
      expect(function() {
        _simulateResponse({output: 42});
      }).toThrow(
        'Received unexpected data from child process: ' +
        '{"response":{"output":42}}'
      );
    });

    pit('resolves when a response is received', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      mockRunTicksRepeatedly();

      _simulateResponse(RESPONSE);

      return promise.then(function(response) {
        expect(response).toEqual(RESPONSE);
      });
    });

    pit('throws when sending a second message before 1st response', function() {
      var worker = new Worker(FAKE_PATH, FAKE_ARGS);
      worker.sendMessage({messageNumber: 1});
      expect(function() {
        worker.sendMessage({messageNumber: 2});
      }).toThrow(
        'Attempted to send a message to the worker before the response from ' +
        'the last message was received! Child processes can only handle one ' +
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
      mockRunTicksRepeatedly();

      var response1 = worker.sendMessage(MESSAGE1);
      mockRunTicksRepeatedly();
      _simulateResponse(RESPONSE1);

      return response1.then(function(response) {
        expect(response).toEqual(RESPONSE1);

        var response2 = worker.sendMessage(MESSAGE2);
        mockRunTicksRepeatedly();
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
      mockRunTicksRepeatedly();

      var response1 = worker.sendMessage(MESSAGE1);
      mockRunTicksRepeatedly();
      _simulateRawResponse(JSON.stringify({error: RESPONSE1}));

      return response1.catch(function(response) {
        expect(response).toEqual(RESPONSE1);

        var response2 = worker.sendMessage(MESSAGE2);
        mockRunTicksRepeatedly();
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
      mockRunTicksRepeatedly();

      var response1 = worker.sendMessage(MESSAGE1);
      mockRunTicksRepeatedly();
      var rawResponse = JSON.stringify({UNEXPECTED: RESPONSE1});
      _simulateRawResponse(rawResponse);

      return response1.catch(function(response) {
        expect(response).toEqual(new Error(
          'Malformed child response message: ' + rawResponse
        ));

        var response2 = worker.sendMessage(MESSAGE2);
        mockRunTicksRepeatedly();
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
      mockRunTicksRepeatedly();

      var fullResponse = JSON.stringify({response: RESPONSE});
      var firstHalf = fullResponse.substr(0, 4);
      var secondHalf = fullResponse.substr(4);
      _simulateRawResponse(firstHalf);
      _simulateRawResponse(secondHalf);

      return promise.then(function(response) {
        expect(response).toEqual(RESPONSE);
      });
    });

    pit('rejects when an error is received', function() {
      var MESSAGE = {input: 42};
      var ERROR = 'This is an error message!';
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      mockRunTicksRepeatedly();
      _simulateRawResponse(JSON.stringify({error: ERROR}));

      return _expectReject(promise, ERROR);
    });

    pit('rejects when malformed response is received', function() {
      var MESSAGE = {input: 42};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      mockRunTicksRepeatedly();
      _simulateRawResponse(JSON.stringify({UNEXPECTED: 'blah'}));

      return _expectReject(promise);
    });

    pit('rejects when multiple responses are received', function() {
      var MESSAGE = {input: 42};
      var RESPONSE = {output: 43};
      var promise = new Worker(FAKE_PATH, FAKE_ARGS).sendMessage(MESSAGE);

      _simulateInitResponse();
      mockRunTicksRepeatedly();

      var responseStr = JSON.stringify({response: RESPONSE});
      _simulateRawResponse(responseStr + responseStr);

      return _expectReject(promise);
    });

    pit('throws when the worker has already been destoryed', function() {
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
  });
});
