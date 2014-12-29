'use strict';

var child_process = require('child_process');
var JSONStreamParser = require('./lib/JSONStreamParser');
var q = require('q');

var Promise = q.Promise;

var DEFAULT_OPTIONS = {
  /**
   * Initialization data that must be sent to every worker (exactly once) before
   * it can begin accepting/processing messages.
   */
  initData: null,

  /**
   * A debug option that tells the worker to print the raw response data it
   * receives from its corresponding child process.
   */
  printChildResponses: false,

  /**
   * A name for this worker. Mostly used in debug output to help distinguish the
   * debug output between two different workers.
   */
  workerName: '[worker]',
};

function _middleTruncate(str, cutoffLength) {
  if (str.length > cutoffLength) {
    var halfCutoff = Math.floor(cutoffLength / 2);
    str =
      str.substr(0, halfCutoff) +
      "\n[...truncated...]\n" +
      str.substr(-1 * halfCutoff);
  }
  return str;
}

function _normalizeOptions(opts) {
  var normOpts = {};
  var optKey;

  for (optKey in DEFAULT_OPTIONS) {
    normOpts[optKey] = DEFAULT_OPTIONS[optKey];
  }

  for (optKey in opts) {
    if (DEFAULT_OPTIONS[optKey] === undefined) {
      throw new Error('Invalid WorkerPool option `' + optKey + '`!');
    }
    normOpts[optKey] = opts[optKey];
  }

  return normOpts;
}

function Worker(workerPath, workerArgs, options) {
  this._opts = _normalizeOptions(options);
  this._workerArgs = workerArgs;
  this._workerPath = workerPath;

  this._rebootRetryCount = 0;
  this._responseSettler = {
    isPending: false,
    pendingMessage: null,
    promise: null,
    resolve: null,
    reject: null
  };

  // Memoize these bindings to save them in case the child process ever gets
  // rebooted
  this._onChildExit = this._onChildExit.bind(this);
  this._onStderr = this._onStderr.bind(this);
  this._onStdout = this._onStdout.bind(this);

  this._bootChildProcess();
}
var Wp = Worker.prototype;

Wp.destroy = function() {
  this._isDestroyed = true;

  var self = this;
  return Promise.resolve(this._responseSettler.promise)
    .catch()
    .then(function() {
      self._childProcess.stdin.end();
      self._childProcess.kill();
    });
};

Wp.sendMessage = function(msg) {
  if (this._isDestroyed) {
    throw new Error(
      'Attempted to send a message to a worker that has already been or is ' +
      'in the process of shutting down!'
    );
  }

  if (this._responseSettler.isPending) {
    throw new Error(
      'Attempted to send a message to the worker before the response ' +
      'from a previous message was received! Workers can only process ' +
      'one message at a time.'
    );
  }
  this._responseSettler.isPending = true;
  this._responseSettler.pendingMessage = msg;

  var self = this;
  function sendMessage() {
    return new Promise(function(resolve, reject) {
      if (typeof msg !== 'object') {
        throw new Error('Worker message must always be an object: ' + msg);
      }

      self._childProcess.stdin.write(JSON.stringify({message: msg}));

      self._responseSettler.resolve = function(value) {
        resolve(value);
        self._responseSettler.resolve = self._responseSettler.reject = null;
      };
      self._responseSettler.reject = function(value) {
        reject(value);
        self._responseSettler.resolve = self._responseSettler.reject = null;
      };
    });
  }

  if (!this._initStatus.complete) {
    return this._initStatus.promise.then(sendMessage);
  } else {
    return sendMessage();
  }
};

Wp._bootChildProcess = function() {
  var initStatus = this._initStatus = {
    complete: false,
    resolve: null,
    reject: null,
  };
  this._isDestroyed = false;
  this._stderrData = '';
  this._streamParser = new JSONStreamParser();

  var child = this._childProcess = child_process.spawn(
    this._workerPath,
    this._workerArgs
  );
  child.on('exit', this._onChildExit);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', this._onStderr);

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', this._onStdout);

  // Start initialization
  initStatus.promise = new Promise(function(resolve, reject) {
    initStatus.resolve = function(value) {
      resolve(value);
      initStatus.resolve = initStatus.reject = null;
    };

    initStatus.reject = function(value) {
      reject(value);
      initStatus.resolve = initStatus.reject = null;
    };
  });

  child.stdin.write(JSON.stringify({initData: this._opts.initData}));
};

Wp._handleInitializationResponse = function(response) {
  if (response.initError !== undefined) {
    throw new Error('Error initializing worker: ' + response.initError);
  } else if (response.initSuccess !== undefined) {
    this._initStatus.complete = true;
    this._initStatus.resolve();
  } else {
    throw new Error(
      'Invalid initialization response received: ' +
      JSON.stringify(response)
    );
  }
};

Wp._handleMessageResponse = function(response) {
  if (response.error !== undefined) {
    this._responseSettler.reject(response.error);
  } else if (response.response !== undefined) {
    this._responseSettler.resolve(response.response);
  } else {
    this._responseSettler.reject(
      new Error(
        'Confusing child response message: ' + JSON.stringify(response)
      )
    );
  }

  this._rebootRetryCount = 0;
  this._responseSettler.isPending = false;
  this._responseSettler.pendingMessage = null;
};

Wp._onChildExit = function(code, signalStr) {
  if (this._isDestroyed && !this._responseSettler.isPending) {
    return;
  }

  var trimmedStderr = _middleTruncate(this._stderrData.trim(), 10000);
  var errorMsg =
    'exit code: ' + code + ', exit signal: ' + signalStr + '\n' +
    'stderr:\n' +
    '  ' + trimmedStderr + '\n';

  if (!this._initStatus.complete) {
    throw new Error(
      'Worker process exited before it could be initialized! ' + errorMsg
    );
  } else if (this._responseSettler.isPending) {
    if (this._rebootRetryCount < 1) {
      this._rebootRetryCount++;
      this._bootChildProcess();
      this._initStatus.promise.done(function() {
        this._childProcess.stdin.write(JSON.stringify({
          message: this._responseSettler.pendingMessage
        }));
      }.bind(this));
    } else {
      this._responseSettler.reject(new Error(
        'Worker process exited before responding! ' + errorMsg
      ));
      this._rebootRetryCount = 0;
      this._responseSettler.isPending = false;
      this._responseSettler.pendingMessage = null;
    }
  }
};

Wp._onStderr = function(data) {
  this._stderrData += data;
  process.stderr.write(data);
};

Wp._onStdout = function(data) {
  if (!this._responseSettler.isPending && this._initStatus.complete) {
    this._throwUnexpectedData(data);
  }

  var responses;
  try {
    responses = this._streamParser.parse(data);
  } catch (e) {
    e = new Error(
      'Unable to parse child response data: ' + this._streamParser.getBuffer()
    );

    if (!this._initStatus.complete) {
      throw e;
    } else {
      this._responseSettler.reject(e);
      return;
    }
  }

  if (this._opts.printChildResponses) {
    console.log(
      '----Start Worker Responses (' + this._opts.workerName + ')----\n' +
      JSON.stringify(responses, null, 2) + '\n' +
      '----End Worker Responses (' + this._opts.workerName + ')----\n'
    );
  }

  if (responses.length >= 1) {
    var response = responses[0];
    if (!this._initStatus.complete) {
      this._handleInitializationResponse(response);
    } else {
      this._handleMessageResponse(response);
    }

    if (responses.length > 1) {
      this._throwUnexpectedData(
        '(piggybacked on response)' +
        responses.slice(1)
          .map(function(resp) {
            return JSON.stringify(resp);
          })
          .join('\n')
      );
    }
  }
};

Wp._throwUnexpectedData = function(data) {
  throw new Error('Received unexpected data from child process: ' + data);
};

module.exports = Worker;
