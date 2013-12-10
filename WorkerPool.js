"use strict";

var child_process = require('child_process');
var JSONStreamParser = require('./lib/JSONStreamParser');
var Q = require('q');

function WorkerPool(maxWorkers, workerPath, workerArgs, lazyBoot) {
  this._workerPath = workerPath;
  this._workerArgs = workerArgs;

  this._availWorkerIds = [];
  this._isShutdown = false;
  this._responseDeferreds = [];
  this._maxWorkers = maxWorkers;
  this._msgs = [];
  this._queuedMsgIds = [];
  // TODO: See todos in _onWorkerStderr and _onWorkerClose below
  //this._workerErrorOutput = {};
  this._shutdownDeferred = null;
  this._workerIdToMsgId = {};
  this._workerOutput = [];
  this._workers = [];
  this._workerStreamParsers = [];

  if (!lazyBoot) {
    this._eagerBootAllWorkers();
  }
}

WorkerPool.prototype.sendMessage = function(msg) {
  if (this._isShutdown) {
    throw new Error(
      'This worker pool has been shut down (or is pending shut down). You ' +
      'cannot send anymore messages through it!'
    );
  }
  var msgId = this._msgs.length;
  var responseDeferred = Q.defer();

  this._msgs.push(msg);
  this._responseDeferreds[msgId] = responseDeferred;

  if (this._availWorkerIds.length > 0) {
    this._sendMsgToAvailWorker(msgId);
  } else if (this._workers.length < this._maxWorkers) {
    this._createWorker();
    this._sendMsgToAvailWorker(msgId);
  } else {
    this._queuedMsgIds.push(msgId);
  }

  return responseDeferred.promise;
};

WorkerPool.prototype.shutDown = function() {
  this._shutdownDeferred = Q.defer();
  var shutdownPromise = this._shutdownDeferred.promise;
  if (this._availWorkerIds.length !== this._workers.length) {
    this._isShutdown = true;
  } else {
    this._destroyAllWorkers();
    this._shutdownDeferred.resolve();
    this._shutdownDeferred = null;
  }
  return shutdownPromise;
}

WorkerPool.prototype._eagerBootAllWorkers = function() {
  while (this._workers.length < this._maxWorkers) {
    this._createWorker();
  }
};

WorkerPool.prototype._createWorker = function() {
  var workerId = this._workers.length;
  var child = child_process.spawn(this._workerPath, this._workerArgs);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', this._onWorkerStdout.bind(this, workerId));
  child.stderr.on('data', this._onWorkerStderr.bind(this, workerId));
  child.on('close', this._onWorkerClose.bind(this, workerId));
  this._workers.push(child);
  this._workerStreamParsers.push(new JSONStreamParser());
  this._availWorkerIds.push(workerId);
  this._workerOutput[workerId] = '';
};

WorkerPool.prototype._destroyAllWorkers = function() {
  this._workers.forEach(function(worker) {
    worker.stdin.end();
    worker.kill();
  });
};

WorkerPool.prototype._sendMsgToAvailWorker = function(msgId) {
  if (this._availWorkerIds.length <= 0) {
    throw new Error(
      'Cannot run msg(' + msgId + '): No workers available'
    );
  }

  var workerId = this._availWorkerIds.shift();
  var worker = this._workers[workerId];
  var msg = this._msgs[msgId];
  this._workerIdToMsgId[workerId] = msgId;
  worker.stdin.write(JSON.stringify({msg: msg, workerId: workerId}));
};

WorkerPool.prototype._onWorkerClose = function(workerId, exitCode) {
  // TODO
  /*
  if (exitCode != 0) {
    console.error(
      'worker(' + workerId + '): ' + this._workerErrorOutput[workerId]
    );
    if (!this._isShutdown) {
      console.error('Recycling worker(' + workerId + ')...');

    }
  }
  */
};

WorkerPool.prototype._onWorkerStdout = function(workerId, data) {
  this._workerOutput[workerId] += data;
  var responses = this._workerStreamParsers[workerId].parse(
    this._workerOutput[workerId]
  );

  if (responses.length === 1) {
    var msgId = this._workerIdToMsgId[workerId];
    var workerResponse = responses[0];

    var responseDeferred = this._responseDeferreds[msgId];
    if (workerResponse.error) {
      responseDeferred.reject(workerResponse.error);
    } else {
      responseDeferred.resolve(workerResponse.response);
    }

    // Cleanup
    this._responseDeferreds[msgId] = null;
    this._msgs[msgId] = null;
    this._workerIdToMsgId[workerId] = null;

    // Put worker back into pool
    this._availWorkerIds.push(workerId);

    // If there are any queued msgs, pop one off and run it.
    if (this._queuedMsgIds.length > 0) {
      var msgId = this._queuedMsgIds.shift();
      this._sendMsgToAvailWorker(msgId);
    } else if (this._isShutdown &&
               this._availWorkerIds.length === this._workers.length) {
      this._destroyAllWorkers();
      this._shutdownDeferred.resolve();
      this._shutdownDeferred = null;
      this._isShutdown = false;
    }

  } else if (responses.length > 1) {
    throw new Error(
      'Unexpected response from worker: ' + JSON.stringify(responses)
    );
  }
};

WorkerPool.prototype._onWorkerStderr = function(workerId, data) {
  // TODO: Buffer this output and only print it onWorkerClose
  //       stderr isn't necessarily (or often, even) flushed all at once
  /*
  if (!this._workerErrorOutput.hasOwnProperty(workerId)) {
    this._workerErrorOutput[workerId] = '';
  }
  this._workerErrorOutput[workerId] += data;
  */
  console.error('worker(' + workerId + '): ' + data);
  //process.exit(1);
  /*
  console.log(data);
  throw new Error('worker(' + workerId + '): ' + data);
  */
};

module.exports = WorkerPool;
