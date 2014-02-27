var JSONStreamParser = require('./lib/JSONStreamParser');
var Q = require('q');
var util = require('util');

function respondWithError(err) {
  if (util.isError(err)) {
    err = err.stack;
  }
  console.log(JSON.stringify({error: err}, null, 2));
}

function respondWithResult(result) {
  console.log(JSON.stringify({response: result}, null, 2));
}

function startWorker(onMessageReceived, onShutdown) {
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  var inputData = '';
  var inputStreamParser = new JSONStreamParser();
  process.stdin.on('data', function(data) {
    inputData += data;
    var rcvdMsg = inputStreamParser.parse(inputData);
    if (rcvdMsg.length === 1) {
      var msg = rcvdMsg[0].msg;
      var workerId = rcvdMsg[0].workerId;
      var response;
      try {
        onMessageReceived(msg).then(function(response) {
          if (!response || typeof response !== 'object') {
            throw new Error(
              'worker(' + workerId + ') attempted to supply an invalid ' +
              'response: ' + JSON.stringify(response, null, 2)
            );
          }
          return response;
        }).done(respondWithResult, respondWithError);
      } catch (e) {
        respondWithError(e.stack || e.message);
      }
    } else if (rcvdMsg.length > 1) {
      throw new Error(
        'Received multiple messages at once! Not sure what to do, so bailing ' +
        'out!'
      );
    }
  });

  onShutdown && process.stdin.on('end', onShutdown);
}

exports.respondWithError = respondWithError;
exports.respondWithResult = respondWithResult;
exports.startWorker = startWorker;
