"use strict";

var Q = require('q');
var Worker = require('./Worker');

function WorkerPool(numWorkers, workerPath, workerArgs, options) {
  options = options || {};

  this._numWorkers = numWorkers;
  this._workerArgs = workerArgs;
  this._workerPath = workerPath;
  this._opts = options;

  this._availableWorkers = [];
  this._allWorkers = [];
  this._isDestroyed = false;
  this._pendingResponses = [];
  this._queuedMessages = [];

  if (!options.lazyBoot) {
    this._eagerBootAllWorkers();
  }
};

WorkerPool.prototype._bootNewWorker = function() {
  var workerID = this._allWorkers.length;
  var worker = new Worker(this._workerPath, this._workerArgs, {
    initData: this._opts.initData,
    printChildResponses: !!this._opts.printChildResponses,
    workerName: workerID
  });
  this._allWorkers.push(worker);
  this._availableWorkers.push(worker);
};

WorkerPool.prototype._eagerBootAllWorkers = function() {
  while (this._allWorkers.length < this._numWorkers) {
    this._bootNewWorker();
  }
};

WorkerPool.prototype._sendMessageToWorker = function(worker, msg) {
  var workerID = worker._opts && worker._opts.workerName;
  return worker.sendMessage(msg).then(function(response) {
    if (this._queuedMessages.length > 0) {
      var queuedMsg = this._queuedMessages.shift();
      this._sendMessageToWorker(worker, queuedMsg.msg).done(function(response) {
        queuedMsg.deferred.resolve(response);
      })
    } else {
      this._availableWorkers.push(worker);
    }
    return response;
  }.bind(this));
};

WorkerPool.prototype.sendMessage = function(msg) {
  if (this._isDestroyed) {
    throw new Error(
      'Attempted to send a message after the worker pool has alread been ' +
      '(or is in the process of) shutting down!'
    );
  }

  if (this._opts.lazyBoot && this._allWorkers.length < this._numWorkers) {
    this._bootNewWorker();
  }

  var responsePromise;
  if (this._availableWorkers.length > 0) {
     responsePromise = this._sendMessageToWorker(
      this._availableWorkers.shift(),
      msg
    );
  } else {
    var queuedMsgID = this._queuedMessages.length;
    var deferred = Q.defer();
    this._queuedMessages.push({
      deferred: deferred,
      msg: msg
    });
    responsePromise = deferred.promise;
  }

  this._pendingResponses.push(responsePromise);
  return responsePromise;
};

WorkerPool.prototype.destroy = function() {
  var allWorkers = this._allWorkers;

  this._isDestroyed = true;
  return Q.all(this._pendingResponses).then(function() {
    return Q.all(allWorkers.map(function(worker) {
      return worker.destroy();
    }));
  });
};

module.exports = WorkerPool;
