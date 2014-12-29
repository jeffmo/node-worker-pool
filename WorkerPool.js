'use strict';

var q = require('q');
var Worker = require('./Worker');

var Promise = q.Promise;

var DEFAULT_OPTIONS = {
  /**
   * A debug option that tells all workers to print the raw response data they
   * receive from their corresponding child process.
   */
  printChildResponses: false,

  /**
   * Initialization data that each worker needs before it can be considered
   * available and part of the pool.
   */
  workerInitData: null,
};

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

function WorkerPool(numWorkers, workerPath, workerArgs, options) {
  this._numWorkers = numWorkers;
  this._opts = _normalizeOptions(options);
  this._workerArgs = workerArgs;
  this._workerPath = workerPath;

  this._allWorkers = Object.create(null);
  this._availableWorkers = [];
  this._destructionResolver = null;
  this._pendingDestroy = false;
  this._pendingResponseCounter = 0;
  this._queuedMessages = [];
  this._uuidCounter = 1;

  for (var i = 0; i < numWorkers; i++) {
    this._bootNewWorker();
  }
}
var WPp = WorkerPool.prototype;

WPp.destroy = function() {
  this._pendingDestroy = true;

  var self = this;
  return new Promise(function(resolve) {
    self._destroyAllWorkers = function() {
      var allWorkers = Object.keys(self._allWorkers).map(function(workerID) {
        return self._allWorkers[workerID];
      });
      resolve(q.all(allWorkers.map(function(worker) {
        return worker.destroy();
      })));
    };

    if (self._pendingResponseCounter === 0) {
      self._destroyAllWorkers();
    }
  });
};

WPp.sendMessage = function(msg) {
  if (this._pendingDestroy) {
    throw new Error(
      'Attempted to send a message after the worker pool has already been ' +
      'or is in the process of shutting down!'
    );
  }

  var self = this;
  return new Promise(function(resolve) {
    self._pendingResponseCounter++;
    if (self._availableWorkers.length > 0) {
      resolve(self._sendMessageToWorker(self._availableWorkers.shift(), msg));
    } else {
      self._queuedMessages.push({
        msg: msg,
        resolve: resolve
      });
    }
  });
};

WPp._bootNewWorker = function() {
  var workerID = this._uuidCounter++;
  this._allWorkers[workerID] = new Worker(this._workerPath, this._workerArgs, {
    initData: this._opts.workerInitData,
    printChildResponses: this._opts.printChildResponses,
    workerName: workerID,
  });
  this._availableWorkers.push(workerID);
};

WPp._destroyAllWorkers = function() {
  var self = this;
  return new Promise(function(resolve) {
    // TODO
  });
};

WPp._sendMessageToWorker = function(workerID, msg) {
  var self = this;
  return new Promise(function(resolve) {
    var worker = self._allWorkers[workerID];
    resolve(worker.sendMessage(msg).finally(function() {
      self._pendingResponseCounter--;
      if (self._queuedMessages.length > 0) {
        var queuedMsg = self._queuedMessages.shift();
        queuedMsg.resolve(self._sendMessageToWorker(workerID, queuedMsg.msg));
      } else {
        if (self._pendingDestroy && self._pendingResponseCounter === 0) {
          self._destroyAllWorkers();
        }
      }
    }));
  });
};

module.exports = WorkerPool;
