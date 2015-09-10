"use strict";

var Worker = require('./Worker');
var Deferred = require('./lib/Deferred');

function WorkerPool(numWorkers, workerPath, workerArgs, options) {
  options = options || {};

  this._numWorkers = numWorkers;
  this._workerArgs = workerArgs;
  this._workerPath = workerPath;
  this._opts = options;

  this._availableWorkers = [];
  this._allWorkers = [];
  this._isDestroyed = false;
  this._allPendingResponses = [];
  this._queuedMessages = [];
  this._queuedWorkerSpecificMessages = {};
  this._workerPendingResponses = {};

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
  this._availableWorkers.push(workerID);
};

WorkerPool.prototype._eagerBootAllWorkers = function() {
  while (this._allWorkers.length < this._numWorkers) {
    this._bootNewWorker();
  }
};

WorkerPool.prototype._sendMessageToWorker = function(workerID, msg) {
  var worker = this._allWorkers[workerID];
  var settle = function() {
    var queuedMsg;
    if (this._queuedWorkerSpecificMessages.hasOwnProperty(workerID)
        && this._queuedWorkerSpecificMessages[workerID].length > 0) {
      queuedMsg = this._queuedWorkerSpecificMessages[workerID].shift();
    } else if (this._queuedMessages.length > 0) {
      queuedMsg = this._queuedMessages.shift();
    }

    if (queuedMsg) {
      this._sendMessageToWorker(workerID, queuedMsg.msg)
        .then(function(response) {
          queuedMsg.deferred.resolve(response);
        }, function(error) {
          queuedMsg.deferred.reject(error);
        });
    } else {
      this._availableWorkers.push(workerID);
      delete this._workerPendingResponses[workerID];
    }
  }.bind(this);

  var pendingResponse = worker.sendMessage(msg).then(
    function(response) {
      return Promise.resolve(settle()).then(function() {
        return response;
      });
    },
    function(error) {
      return Promise.resolve(settle()).then(function() {
        throw error;
      });
    }
  );
  return this._workerPendingResponses[workerID] = pendingResponse;
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
    var deferred = Deferred();
    this._queuedMessages.push({
      deferred: deferred,
      msg: msg
    });
    responsePromise = deferred.promise;
  }

  this._allPendingResponses.push(responsePromise);
  return responsePromise;
};

WorkerPool.prototype.sendMessageToAllWorkers = function(msg) {
  if (this._isDestroyed) {
    throw new Error(
      'Attempted to send a message after the worker pool has alread been ' +
      '(or is in the process of) shutting down!'
    );
  }

  // Queue the message up for all currently busy workers
  var busyWorkerResponses = [];
  for (var workerID in this._workerPendingResponses) {
    var deferred = Deferred();
    if (!this._queuedWorkerSpecificMessages.hasOwnProperty(workerID)) {
      this._queuedWorkerSpecificMessages[workerID] = [];
    }
    this._queuedWorkerSpecificMessages[workerID].push({
      deferred: deferred,
      msg: msg
    });
    busyWorkerResponses.push(deferred.promise);
  }

  // Send out the message to all workers that aren't currently busy
  var availableWorkerResponses = this._availableWorkers.map(function(workerID) {
    return this._sendMessageToWorker(workerID, msg);
  }, this);
  this._availableWorkers = [];

  return Promise.all(availableWorkerResponses.concat(busyWorkerResponses));
};

WorkerPool.prototype.destroy = function() {
  var allWorkers = this._allWorkers;

  this._isDestroyed = true;

  var allPending = this._allPendingResponses;
  return new Promise(function(resolve, reject) {
    var pending = allPending.length;
    function settle() {
      if (--pending <= 0) {
        resolve();
      }
    }

    allPending.forEach(function(promise) {
      promise.then(settle, settle);
    });
  }).then(function() {
    return Promise.all(allWorkers.map(function(worker) {
      return worker.destroy();
    }));
  });
};

module.exports = WorkerPool;
