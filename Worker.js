"use strict";

var child_process = require('child_process');
var JSONStreamParser = require('./lib/JSONStreamParser');
var Q = require('q');

function Worker(workerPath, workerArgs, options) {
  options = options || {}

  var child = child_process.spawn(workerPath, workerArgs);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', this._onStderr.bind(this));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', this._onStdout.bind(this));

  this._childProcess = child;
  this._isDestroyed = false;
  this._opts = options;
  this._pendingResponseDeferred = null;
  this._stdoutData = '';
  this._streamParser = new JSONStreamParser();

  // Send init data to the child first thing
  this._initDeferred = Q.defer();
  this._initialized = false;
  child.stdin.write(JSON.stringify({initData: options.initData}));
}

Worker.prototype._handleInitializationResponse = function(response) {
  if (response.hasOwnProperty('initError')) {
    throw new Error('Error initializing worker: ' + response.initError);
  } else if (response.hasOwnProperty('initSuccess')) {
    this._initDeferred.resolve();
  } else {
    throw new Error(
      'Invalid initialization response received: ' +
      JSON.stringify(response)
    );
  }
};

Worker.prototype._handleMessageResponse = function(response) {
  if (response.hasOwnProperty('error')) {
    this._pendingResponseDeferred.reject(response.error);
  } else if (response.hasOwnProperty('response')) {
    this._pendingResponseDeferred.resolve(response.response);
    this._pendingResponseDeferred = null;
  } else {
    this._pendingResponseDeferred.reject(
      new Error(
        'Malformed child response message: ' + JSON.stringify(response)
      )
    );
  }
};

Worker.prototype._onStderr = function(data) {
  process.stderr.write(data);
};

Worker.prototype._onStdout = function(data) {
  if (this._pendingResponseDeferred === null && this._initialized === true) {
    throw new Error('Received unexpected data from child process: ' + data);
  }

  this._stdoutData += data;

  var responses;
  try {
    responses = this._streamParser.parse(this._stdoutData);
  } catch (e) {
    e = new Error('Unable to parse child response data: ' + this._stdoutData);
    if (this._initialized === false) {
      throw e;
    } else {
      this._pendingResponseDeferred.reject(e);
      return;
    }
  }

  if (this._opts.printChildResponses) {
    var workerName =
      this._opts.hasOwnProperty('workerName')
      ? this._opts.workerName
      : 'unnamed';

    console.log(
      '----Start Worker Responses (' + workerName + ')----\n' +
      JSON.stringify(responses, null, 2) + '\n' +
      '----End Worker Responses (' + workerName + ')----\n'
    );
  }

  if (responses.length === 1) {
    var response = responses[0];
    if (this._initialized === false) {
      this._handleInitializationResponse(response);
      this._initialized = true;
    } else {
      this._handleMessageResponse(response);
    }
  } else if (responses.length > 1) {
    this._pendingResponseDeferred.reject(
      new Error(
        'Received multiple responses when we were only expecting one: ' +
        JSON.stringify(responses)
      )
    );
  }
};

Worker.prototype.destroy = function() {
  this._isDestroyed = true;

  var pendingWork =
    this._pendingResponseDeferred === null
    ? this._initDeferred.promise
    : this._pendingResponseDeferred.promise;

  return pendingWork.then(function() {
    this._childProcess.stdin.end();
    this._childProcess.kill();
  }.bind(this));
};

Worker.prototype.sendMessage = function(messageObj) {
  if (this._isDestroyed) {
    throw new Error(
      'Attempted to send a message to a worker that has been (or is in the ' +
      'process of being) destroyed!'
    );
  }

  if (this._pendingResponseDeferred !== null) {
    throw new Error(
      'Attempted to send a message to the worker before the response from ' +
      'the last message was received! Child processes can only handle one ' +
      'message at a time.'
    );
  }
  this._pendingResponseDeferred = Q.defer();
  var responsePromise = this._pendingResponseDeferred.promise;

  var workerName = this._opts.workerName;
  return this._initDeferred.promise.then(function() {
    if (typeof messageObj !== 'object') {
      throw new Error('Worker messages must always be an object: ' + messageObj);
    }
    if (messageObj === null) {
      throw new Error('Worker messages must always be an object: null');
    }

    this._childProcess.stdin.write(JSON.stringify({message: messageObj}));
    return responsePromise;
  }.bind(this));
};

module.exports = Worker;