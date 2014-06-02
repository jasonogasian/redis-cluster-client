var redis = require('redis');

var Sentinel = {
  //
  // Properties
  //
  cluster: '',
  sentinels: [],
  preferredSentinel: null,


  //
  // Functions
  //
  init: function(cluster, sentinelArray, callback) {
    this.cluster = cluster;

    sentinelArray.forEach(function(s) {
      this.sentinels.push(s);
    }, this);
    this.connect(function(err, masterClient) {
      if (err) callback('(init) ' + err);
      else {
        masterClient.quit();
        callback();
      }
    });
  },

  command: function(cmd, args, callback, slave) {
    this.connect(function(err, redisClient) {
      if (err) {
        if (callback) callback('(command) ' + err);
        return;
      }

      redisClient[cmd](args, function(err, resp) {
        redisClient.quit();
        if (callback) callback(err, resp);
      });
    }, slave);
  },

  connect: function(callback, slave) {
    var self = this;
    var attempts = 0;

    if (self.preferredSentinel) {
      sentinelConnect(self.preferredSentinel, function(err, client) {
        if (err) trySentinel();
        else (callback('', client));
      });
    }
    else {
      trySentinel();
    }

    function trySentinel() {
      if (attempts >= self.sentinels.length) {
        callback('(connect) Unable to connect to a Sentinel');
        return;
      }
      var s = self.sentinels[attempts];

      sentinelConnect(s, function(err, client) {
        if (err) {
          console.log('\tConnection Error: ' + err);
          trySentinel(++attempts);
        }
        else if (client) {
          attempts = self.sentinels.length; // Break the loop
          callback('', client);
        }
      });
    }

    function sentinelConnect(sen, callback) {
      var sentinelClient = redis.createClient(sen.port, sen.host, {max_attempts:1});
      sentinelClient.on('error', function(err) { callback('(sentinelConnect) ' + err); });
      sentinelClient.on('ready', function() {
        self.preferredSentinel = sen;

        if (slave) {
          getSlaveClient(sentinelClient, self.cluster, callback);
        }
        else {
          getMasterClient(sentinelClient, self.cluster, callback);
        }
      });
    }
  }
}


function getMasterClient(sentinelClient, cluster, callback) {
  sentinelClient.send_command('SENTINEL', ['get-master-addr-by-name', cluster],
    function(err, master) {
      if (err) {
        sentinelClient.quit();
        callback('(getMaster) ' + err);
        return;
      }
      sentinelClient.quit();

      // Create the client for the redis Master server
      var redisMaster = redis.createClient(master[1], master[0]);
      redisMaster.on('error', function(err) { callback('(master) ' + err); });
      redisMaster.on('ready', function() { callback('', redisMaster); });          
    });
}


function getSlaveClient(sentinelClient, cluster, callback) {
  sentinelClient.send_command('SENTINEL', ['slaves', cluster],
    function(err, slaves) {
      if (err) {
        sentinelClient.quit();
        callback('(getSlave) ' + err);
        return;
      }
      sentinelClient.quit();

      // Collect all good slaves
      var goodSlaves = [];
      slaves.forEach( function(slave) {
        var tmpSlave = {};
        slave.forEach( function(config, index) {
          switch (config) {
            case 'ip':
              storeNext();
              break;
            case 'port':
              storeNext();
              break;
            case 'role-reported':
              storeNext();
              break;
            case 'master-link-status':
              storeNext();
              break;
          }

          function storeNext() {
            tmpSlave[config] = slave[index+1];
          }
        });
        
        if (tmpSlave['role-reported'] == 'slave' && 
            tmpSlave['master-link-status'] == 'ok') {
          goodSlaves.push(tmpSlave);
        }
      });

      // Choose random slave
      var rand = getRandomInt(0, goodSlaves.length -1);
      var chosenSlave = goodSlaves[rand];

      var redisSlave = redis.createClient(chosenSlave.port, chosenSlave.ip);
      redisSlave.on('error', function(err) { callback('(slave) ' + err); });
      redisSlave.on('ready', function() { callback('', redisSlave); });
    });
}


// Returns a random integer between min and max
// Using Math.round() will give you a non-uniform distribution!
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


module.exports = Sentinel;