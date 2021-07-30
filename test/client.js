'use strict';
const assert = require('assert');
const _ = require('lodash');
const Client = require('..');
const db = 'vicanso';

function convertType(type) {
  const dict = {
    i: 'integer',
    b: 'boolean',
    f: 'float',
    s: 'string',
  };
  return dict[type] || type;
}

describe('Client', () => {
  const client = new Client(`http://localhost:8086,localhost:8076/${db}`);
  client.startHealthCheck();

  it('init', done => {
    setTimeout(done, 1500);
  });

  it('get database', () => {
    assert.equal(client.database, db);
  });

  it('get available servers', () => {
    assert.equal(client.availableServers.length, 1);
    assert.equal(client.availableServers[0].port, 8086);
  });

  it('get unavailable servers', () => {
    assert.equal(client.unavailableServers.length, 1);
    assert.equal(client.unavailableServers[0].port, 8076);
  });

  it('create database if not exists', done => {
    client.createDatabase().then(data => {
      done();
    }).catch(done);
  });

  it('write point', done => {
    client.write('http')
      .tag({
        spdy: 'fast',
        type: '2',
        method: 'get',
      })
      .field({
        use: 300,
        code: 200,
        size: 10 * 1024,
      })
      .then(data => {
        done();
      }).catch(done);
  });

  it('write point queue', () => {
    client.once('queue', (data) => {
      assert.equal(data.type, 'write');
    });
    client.once('writeQueue', (data) => {
      assert.equal(data.fields.uuid, 'vicanso');
    });
    client.write('http')
      .tag({
        spdy: 'fast',
        type: '3',
      })
      .field({
        use: 200,
        uuid: 'vicanso',
      })
      .queue();
    assert.equal(client.writeQueueLength, 1);
  });

  it('write queue lineformat', done => {
      assert.equal(client.writeQueueLength, 1);
      const arr = client.writeQueueLineFormat();
      assert.equal(arr.length, 1 );
      assert.match(arr[0], /http,spdy=fast,type=3 use=200,uuid="vicanso" \d*/);
      assert.equal(client.writeQueueLength, 1);
      done();
  });


  it('sync write queue', done => {
    client.syncWrite().then(() => {
      return client.query('http')
        .condition('uuid', 'vicanso')
        .set('format', 'json');
    }).then((data) => {
      assert.equal(data.http.length, 1);
      assert(data.http[0].time.length);
      done();
    }).catch(done);
  });

  it('write point', done => {
    client.writePoint('http', {
      use: 301,
    }, {
      spdy: 'faster',
    }).then(data => {
      return client.query('http')
        .condition('spdy', 'faster');
    }).then(data => {
      assert.equal(data.results[0].series[0].values[0][4], 'faster');
      done();
    }).catch(done);
  });

  it('write point with precision', done => {
    client.writePoint('http', {
      use: 404,
    }, {
      spdy: 'faster',
    }, 'ms')
    .then(data => {
      return client.query('http')
        .condition('spdy', 'faster');
    }).then(data => {
      assert.equal(data.results[0].series[0].values[0][4], 'faster');
      done();
    }).catch(done);
  });

  it('write point with schema(stripUnknown)', (done) => {
    const fieldSchema = {
      use: 'i',
      sucesss: 'b',
      vip: 'boolean',
      no: 'integer',
      score: 'f',
    };
    client.schema('request', fieldSchema, {
      type: ['vip'],
    }, {
      stripUnknown: true,
    });
    client.once('invalid-fields', (data) => {
      const fail = data.fail;
      assert.equal(data.measurement, 'request');
      assert.equal(fail.length, 4);
      assert.equal(fail[0].category, 'stripUnknown');
      assert.equal(fail[0].key, 'version');
      assert.equal(fail[0].value, 1);
    });
    client.once('invalid-tags', (data) => {
      const fail = data.fail;
      assert.equal(data.measurement, 'request');
      assert.equal(fail.length, 1);
      assert.equal(fail[0].category, 'invalid');
      assert.equal(fail[0].key, 'type');
      assert.equal(fail[0].value, 'a');
    });
    client.write('request')
      .field({
        use: 300,
        sucesss: 'T',
        vip: 'true',
        count: null,
        name: undefined,
        version: 1,
        token: 'abcd',
        no: 'abcd',
        score: 'ab',
      })
      .tag({
        type: 'a',
      })
      .then(() => {
        return client.showFieldKeys('request');
      }).then((data) => {
        assert.equal(data[0].values.length, 3);
        _.forEach(data[0].values, (item) => {
          assert.equal(item.type, convertType(fieldSchema[item.key]));
        });
        done();
      }).catch(done);
  });

  it('write point with schema', done => {
    const fieldSchema = {
      use: 'integer',
      sucesss: 'boolean',
      vip: 'boolean',
      account: 'string',
      amount: 'float',
    };
    const tagSchema = {
      spdy: ['1', '5', '3', '2'],
      method: '*',
    };
    client.schema('request', fieldSchema, tagSchema);
    client.write('request')
      .tag({
        spdy: '2',
        method: 'GET',
      })
      .field({
        use: 300,
        sucesss: 'T',
        vip: 'true',
        account: 'vicanso',
        amount: '231.124',
        count: null,
        name: undefined,
      }).then(() => {
        return client.showFieldKeys('request')
      }).then((data) => {
        assert.equal(data[0].values.length, 5);
        _.forEach(data[0].values, (item) => {
          assert.equal(item.type, fieldSchema[item.key]);
        });
        done();
      }).catch(done);
  });


  it('write point with schema, illegal tag value', done => {
    const fieldSchema = {
      use: 'integer',
      sucesss: 'boolean',
      vip: 'boolean',
      account: 'string',
      amount: 'float',
    };
    const tagSchema = {
      spdy: ['1', '5', '3', '2'],
      method: '*',
    };
    client.schema('request', fieldSchema, tagSchema);
    client.write('request')
      .tag({
        spdy: '8',
        method: 'POST',
        type: '1',
      })
      .field({
        use: 300,
        account: 'vicanso',
      }).then(() => {
        return client.query('request')
          .condition('method', 'POST')
          .set({
            format: 'json',
          });
      }).then((data) => {
        const item = data.request[0];
        assert.equal(item.type, '1')
        assert.equal(item.spdy, null);
        done();
      }).catch(done);
  });

  it('get point queue', () => {
    client.query('http')
      .condition('type', '2')
      .queue();
    client.query('http')
      .condition('type', '3')
      .queue();
    assert.equal(client.queryQueueLength, 2);
  });

  it('sync query queue', done => {
    client.syncQuery().then(data => {
      assert.equal(data.results.length, 2);
      assert.equal(data.results[0].series[0].values[0][5], '2');
      assert.equal(data.results[1].series[0].values[0][5], '3');
      done();
    }).catch(done);
  });

  it('sync query queue, set epoch', done => {
    client.query('http')
      .condition('type', '2')
      .queue();
    client.query('http')
      .condition('type', '3')
      .queue();
    client.epoch = 's';
    client.syncQuery().then(data => {
      client.epoch = null;
      assert.equal(data.results.length, 2);
      assert.equal(`${data.results[0].series[0].values[0][0]}`.length, 10)
      assert.equal(data.results[0].series[0].values[0][5], '2');
      assert.equal(data.results[1].series[0].values[0][5], '3');
      done();
    }).catch(done);
  });

  it('sync query queue, format:json', done => {
    client.query('http')
      .condition('type', '2')
      .queue();
    client.query('http')
      .condition('type', '3')
      .queue();
    client.syncQuery('json').then(data => {
      assert(data.http);
      assert.equal(data.http.length, 2);
      done();
    }).catch(done);
  });

  it('sync query queue, format:csv', done => {
    client.query('http')
      .condition('type', '2')
      .queue();
    client.query('http')
      .condition('type', '3')
      .queue();
    client.syncQuery('csv').then(data => {
      assert(data.http);
      done();
    }).catch(done);
  });

  it('query point', done => {
    client.query('http')
      .condition('spdy', 'fast')
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 2);
        done();
      }).catch(done);
  });

  it('query point by tag', done => {
    client.query('http')
      .condition('spdy', 'fast')
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 2);
        done();
      }).catch(done);
  });

  it('query point by field', done => {
    client.query('http')
      .condition('use', 301)
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 1);
        done();
      }).catch(done);
  });

  it('query raw', done => {
    client.queryRaw('select * from http where use = 301')
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 1);
        done();
      }).catch(done);
  });

  it('query point use or', done => {
    client.query('http')
      .condition('type', ['2', '3'])
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 2);
        done();
      }).catch(done);
  });

  it('query use addFunction', done => {
    client.query('http')
      .addFunction('bottom', 'use', 1)
      .then(data => {
        assert.equal(data.results[0].series[0].values.length, 1);
        done();
      }).catch(done);
  });

  it('subQuery', done => {
    client.query('http')
      .addFunction('max', 'use')
      .addGroup('type')
      .subQuery()
      .addFunction('sum', 'max')
      .then((data) => {
        assert.equal(data.results[0].series[0].values.length, 1);
        assert.equal(data.results[0].series[0].columns.join(','), 'time,sum');
        done();
      }).catch(done);
  });

  it('set timeout', done => {
    client.timeout = 1;
    assert.equal(client.timeout, 1);
    client.query('http')
      .then()
      .catch(err => {
        assert.equal(err.code, 'ECONNABORTED');
        client.timeout = 0;
        done();
      });
  });

  it('set format', done => {
    client.format = 'json';
    client.query('http')
      .then((data) => {
        assert.equal(client.format, 'json');
        assert.equal(data.http.length, 4);
        client.format = '';
        done();
      }).catch(done);
  });

  it('set epoch', done => {
    client.epoch = 's'
    client.query('http')
      .then((data) => {
        assert.equal(client.epoch, 's');
        assert.equal(`${data.results[0].series[0].values[0][0]}`.length, 10);
        client.epoch = '';
        done();
      }).catch(done);
  });

  it('show databases', done => {
    client.showDatabases().then(dbs => {
      assert(_.includes(dbs, db), true);
      done();
    }).catch(done);
  });

  it('show retention policies', done => {
    client.showRetentionPolicies().then(rps => {
      assert(rps.length);
      assert.equal(_.keys(rps[0]).sort().join(','), 'default,duration,name,replicaN,shardGroupDuration');
      done();
    }).catch(done);
  });

  it('create/update/drop retention policy', done => {
    client.createRetentionPolicy('mytest', '2h').then(() => {
      return client.showRetentionPolicies();
    }).then((rps) => {
      assert.equal(rps.length, 2);
      return client.updateRetentionPolicy('mytest', '4h', 1, '1h', true);
    }).then(() => {
      return client.showRetentionPolicies();
    }).then((rps) => {
      const rp = rps[1];
      assert.equal(rp.name, 'mytest');
      assert.equal(rp.duration, '4h0m0s');
      assert.equal(rp.shardGroupDuration, '1h0m0s');
      assert.equal(rp.replicaN, 1);
      assert(rp.default);
      return client.updateRetentionPolicy('autogen', '0', 1, true);
    }).then(() => {
      return client.dropRetentionPolicy('mytest');
    }).then(() => {
      return client.showRetentionPolicies();
    }).then((rps) => {
      assert.equal(rps.length, 1);
      done();
    }).catch(done);
  });

  it('show measurements', done => {
    client.showMeasurements().then(measurements => {
      assert.equal(measurements.length, 2);
      done();
    }).catch(done);
  });

  it('show tag keys of measurement', done => {
    client.showTagKeys('http').then(tagKeys => {
      assert(tagKeys.length);
      assert.equal(tagKeys[0].name, 'http');
      assert.equal(_.map(tagKeys[0].values, item => item.key).join(','), 'method,spdy,type');
      done();
    }).catch(done);
  });

  it('show tag keys of all measurements', done => {
    client.showTagKeys().then(tagKeys => {
      assert(tagKeys.length);
      assert.equal(tagKeys[0].name, 'http');
      assert.equal(_.map(tagKeys[0].values, item => item.key).join(','), 'method,spdy,type');
      done();
    }).catch(done);
  });

  it('show field keys of measurement', done => {
    client.showFieldKeys('http').then(fieldKeys => {
      assert(fieldKeys.length);
      assert.equal(fieldKeys[0].name, 'http');
      assert.equal(_.map(fieldKeys[0].values, item => item.key).join(','), 'code,size,use,uuid');
      assert.equal(_.map(fieldKeys[0].values, item => item.type).join(','), 'float,float,float,string');
      done();
    }).catch(done);
  });

  it('show field keys of all measurements', done => {
    client.showFieldKeys().then(fieldKeys => {
      assert(fieldKeys.length);
      assert.equal(fieldKeys[0].name, 'http');
      assert.equal(_.map(fieldKeys[0].values, item => item.key).join(','), 'code,size,use,uuid');
      assert.equal(_.map(fieldKeys[0].values, item => item.type).join(','), 'float,float,float,string');
      done();
    }).catch(done);
  });

  it('show series', done => {
    client.showSeries().then(series => {
      assert.equal(series.length, 6);
      done();
    }).catch(done);
  });

  it('add plugin', done => {
    let called = false;
    client.addPlugin((req) => {
      if (called) {
        return;
      }
      if (!req.backendServer) {
        done(new Error('the backend field is null'));
      }
      called = true;
    });
    client.query('http')
      .then(() => {
        if (!called) {
          done(new Error('not called'));
          return;
        }
        done();
      })
      .catch(done);
  });

  it('drop database', function(done) {
    this.timeout(5000);
    client.stopHealthCheck();
    client.dropDatabase().then(() => {
      done();
    }).catch(done);
  });
});

describe('Client:customLoadblance', () => {
  const client = new Client(`http://localhost:8076,localhost:8086/${db}`, {
    loadBalancingAlgorithm: 'last-backend',
  });
  client.addAlgorithm('last-backend', (request) => {
    return client.availableServers.length - 1;
  });
  it('create database if not exists', done => {
    client.createDatabase().then(data => {
      done();
    }).catch(done);
  });

  it('drop database', function(done) {
    this.timeout(5000);
    client.dropDatabase().then(() => {
      done();
    }).catch(done);
  });
});

describe('Client:Auth', () => {
  const client = new Client(`http://vicanso:mypwd@localhost:8085/${db}`);

  client.startHealthCheck();
  it('init', done => {
    setTimeout(done, 1500);
  });

  it('create user', done => {
    client.queryPost('create user "vicanso" with password \'mypwd\' with all privileges').then(data => {
      done();
    }).catch(err => {
      console.error(err);
      done(err);
    });
  });

  it('on auth client', done => {
    const tmp = new Client(`http://localhost:8085/${db}`);
    tmp.createDatabase().then(() => {
      done(new Error('no auth client can not create database'));
    }).catch(err => {
      assert.equal(err.status, 401);
      done();
    });
  });


  it('create database', done => {
    client.createDatabase().then(() => {
      done();
    }).catch(done);
  });

  it('basic auth client', done => {
    const tmp = new Client(`http://vicanso:mypwd@localhost:8085/${db}?auth=basic`);
    tmp.showDatabases().then((data) => {
      if (data.length === 0) {
        done(new Error('show data bases fail'));
        return;
      }
      done();
    }).catch(done);
  });

  it('write point', done => {
    client.write('http')
      .tag({
        spdy: 'fast',
        type: '2',
        method: 'get',
      })
      .field({
        use: 300,
        code: 200,
        size: 10 * 1024,
      })
      .then(data => {
        done();
      }).catch(done);
  });

  it('show databases', done => {
    client.showDatabases().then(dbs => {
      assert(_.includes(dbs, db), true);
      done();
    }).catch(done);
  });

  it('query point', done => {
    client.query('http')
      .condition({
        spdy: 'fast',
        type: '2',
      })
      .then(data => {
        assert(data.results[0].series[0].values.length);
        done();
      }).catch(done);
  });

  it('drop database', function(done) {
    this.timeout(5000);
    client.dropDatabase().then(() => {
      done();
    }).catch(done);
  });
});
