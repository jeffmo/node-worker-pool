/**
 * Copyright 2004-present Facebook. All Rights Reserved.
 */

/**
 * @emails jeffmo@fb.com
 */

require('mock-modules').autoMockOff();

describe('JSONStreamParser', function() {
  var JSONStreamParser = require('../JSONStreamParser');

  describe('the basics', function() {
    it('handles a single empty object', function() {
      var parser = new JSONStreamParser();
      expect(parser.parse('{}')).toEqual([{}]);
    });

    it('handles multiple empty objects', function() {
      var parser = new JSONStreamParser();
      expect(parser.parse('{}{}')).toEqual([{}, {}]);
    });

    it('handles a flat key-value object', function() {
      var parser = new JSONStreamParser();
      expect(parser.parse('{"TEST_KEY":"TEST_VALUE"}')).toEqual([
        {TEST_KEY: "TEST_VALUE"}
      ]);
    });

    it('handles multiple flat key-value objects', function() {
      var parser = new JSONStreamParser();
      expect(parser.parse('{"OBJ1":"VAL1"}{"OBJ2":"VAL2"}')).toEqual([
        {OBJ1: "VAL1"},
        {OBJ2: "VAL2"}
      ]);
    });

    it('handles a stream of a single empty object', function() {
      var parser = new JSONStreamParser();
      var partialStream1 = '{';
      var partialStream2 = '}';
      expect(parser.parse(partialStream1)).toEqual([]);
      expect(parser.parse(partialStream2)).toEqual([{}]);
    });

    it('handles a stream of multiple empty objects', function() {
      var parser = new JSONStreamParser();
      var partialStream1 = '{}{';
      var partialStream2 = '}';
      expect(parser.parse(partialStream1)).toEqual([{}]);
      expect(parser.parse(partialStream2)).toEqual([{}]);
    });

    it('handles a stream of a single flat object', function() {
      var parser = new JSONStreamParser();
      var partialStream1 = '{"OBJECT1';
      var partialStream2 = '":true}';
      expect(parser.parse(partialStream1)).toEqual([]);
      expect(parser.parse(partialStream2)).toEqual([{OBJECT1: true}]);
    });

    it('handles stream of multiple flat objects', function() {
      var parser = new JSONStreamParser();
      var partialStream1 = '{"OBJECT1":true}{"OBJE';
      var partialStream2 = 'CT2":true}';
      expect(parser.parse(partialStream1)).toEqual([{OBJECT1: true}]);
      expect(parser.parse(partialStream2)).toEqual([{OBJECT2: true}]);
    });

    it('handles a stream of a single nested object', function() {
      var parser = new JSONStreamParser();
      var partialStream1 = '{"OBJECT1":{"OBJE';
      var partialStream2 = 'CT2":true}}';
      expect(parser.parse(partialStream1)).toEqual([]);
      expect(parser.parse(partialStream2)).toEqual([
        {OBJECT1: {OBJECT2: true}}
      ]);
    });

    it('handles a stream of multiple nested objects', function() {
      var parser = new JSONStreamParser();
      var partialStreams = [
        '{"OBJECT1":{"OBJECT2":true}}{"OBJECT3',
        '":{"OBJECT4"',
        ':true}}'
      ];
      expect(parser.parse(partialStreams[0])).toEqual([
        {OBJECT1: {OBJECT2: true}}
      ]);
      expect(parser.parse(partialStreams[1])).toEqual([]);
      expect(parser.parse(partialStreams[2])).toEqual([
        {OBJECT3: {OBJECT4: true}}
      ]);
    });
  });

  it('handles brackets in strings', function() {
    var parser = new JSONStreamParser();
    expect(parser.parse('{"}":"{"}')).toEqual([{"}":"{"}]);
  });

  it('handles escaped quotes in strings', function() {
    var parser = new JSONStreamParser();
    expect(parser.parse('{"\\"}":"\\"\\"\\"\\\\\\""}')).toEqual([
      {"\"}": "\"\"\"\\\""}
    ]);
  });
});
