var getMockFn = require('mocks').getMockFunction;
var mockExports = require.generateMock('child_process');

mockExports.mockChildren = [];

mockExports.spawn.mockImplementation(function(path, args) {
  var child = {
    on: getMockFn(),
    stderr: {
      setEncoding: getMockFn(),
      on: getMockFn()
    },
    stdin: {
      write: getMockFn()
    },
    stdout: {
      setEncoding: getMockFn(),
      on: getMockFn()
    }
  };
  mockExports.mockChildren.push(child);
  return child;
});

module.exports = mockExports;
