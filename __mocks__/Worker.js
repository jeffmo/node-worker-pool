'use strict';

var Promise = require.requireActual('q').Promise;

var MockWorker = jest.genMockFn().mockImpl(function() {
  var settlers = this.__settlers = {
    destroy: {resolve: null, reject: null},
    sendMessage: {resolve: null, reject: null},
  };

  this.destroy = jest.genMockFn().mockImpl(function() {
    return new Promise(function(resolve, reject) {
      settlers.destroy.resolve = resolve;
      settlers.destroy.reject = reject;
    });
  });

  this.sendMessage = jest.genMockFn().mockImpl(function() {
    return new Promise(function(resolve, reject) {
      settlers.sendMessage.resolve = resolve;
      settlers.sendMessage.reject = reject;
    });
  });
});

module.exports = MockWorker;
