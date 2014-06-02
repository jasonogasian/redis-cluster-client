/**
 * Module pretty-logs
 *
 * Creates nicely formatted console logs with a context (breadCrumb) and message
 * Created By: Jason Ogasian
 * Created On: 5-31-2014
 *
 * ISC License (ISC)
 *
 * Copyright (c) 2014, Jason Ogasian
 *
 * Permission to use, copy, modify, and/or distribute this software for any 
 * purpose with or without fee is hereby granted, provided that the above 
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY 
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, 
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM 
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR 
 * PERFORMANCE OF THIS SOFTWARE.
 */
var redis = require('redis');

var Sentinel = {

  //
  // Default properties
  //
  cluster: 'mymaster',
  sentinels: [{host:"localhost", port:26379}],
  preferredSentinel: null,


  /**
   * Initialize the Sentinel object to use the given Sentinels. Also verifies a 
   * connection to the cluster master.
   * @param  {String}   cluster       Name of the Redis cluster (i.e. mymaster)
   * @param  {Array}    sentinelArray Array of Sentinels [{host:'abc',port:123}]
   * @param  {Function} callback      callback([err])
   */
  init: function(cluster, sentinelArray, callback) {
    this.cluster = cluster;

    sentinelArray.forEach(function(s) {
      this.sentinels.push(s);
    }, this);
    connect(this, function(err, masterClient) {
      if (err && callback) {
        callback('(init) ' + err);
        return;
      }

      masterClient.quit();
      if (callback) callback();
    });
  },


  /**
   * Send a Redis command to the cluster master (or random slave if desired).
   * @param  {String}   cmd      Any Redis command supported by redis module
   * @param  {Array}    args     An array of arguments to the given command
   * @param  {Function} callback [optional] callback(err, [resp])
   * @param  {Boolean}  slave    Connect to a random slave instead of master
   */
  command: function(cmd, args, callback, slave) {
    connect(this, function(err, redisClient) {
      if (err && callback) {
        callback('(command) ' + err);
        return;
      }

      redisClient[cmd](args, function(err, resp) {
        redisClient.quit();
        if (callback) callback(err, resp);
      });
    }, slave);
  }
}




/**
 * Connect to a Redis master (or slave) as determined by a sentinel
 * @param  {Object}   that     Sentinel object that called this function
 * @param  {Function} callback callback(err, [RedisClient])
 * @param  {Boolean}  slave    Connect to a random slave instead of master
 */
function connect(that, callback, slave) {
  var attempts = 0; // Count the sentinel connection attempts

  if (that.preferredSentinel) {
    sentinelConnect(that.preferredSentinel, function(err, client) {
      if (err) trySentinel();
      else (callback('', client));
    });
  }
  else {
    trySentinel();
  }


  /**
   * Loop through all known Sentinels until a connection is made - or error
   */
  function trySentinel() {

    if (attempts >= that.sentinels.length) {
      callback('(connect) Unable to connect to a Sentinel');
      return;
    }
    var s = that.sentinels[attempts];

    sentinelConnect(s, function(err, client) {
      if (err) {
        console.log('\tConnection Error: ' + err);
        attempts++;
        trySentinel();
      }
      else if (client) {
        attempts = that.sentinels.length; // Break the loop
        callback('', client);
      }
    });
  }


  /**
   * Attempt a connection to the given Redis Sentinel
   * @param  {Object}   sen      Sentinel: {host:'abc', port:123}
   * @param  {Function} callback callback(err, [RedisClient])
   */
  function sentinelConnect(sen, callback) {

    var sentinelClient = redis.createClient(sen.port, sen.host, 
      {max_attempts:1, connect_timeout:5000});
    sentinelClient.on('error', function(err) { callback('(sentinelConnect) ' + err); });
    sentinelClient.on('ready', function() {

      // Use this sentinel first for the next connection attempt
      that.preferredSentinel = sen;

      if (slave) {
        getSlaveClient(sentinelClient, that.cluster, callback);
      }
      else {
        getMasterClient(sentinelClient, that.cluster, callback);
      }
    });
  }
}


/**
 * Create a connection client to the master specified by the given Sentinel
 * @param  {RedisClient} sentinelClient Client connection to a Sentinel
 * @param  {String}      cluster        Name of the Redis cluster (i.e. mymaster)
 * @param  {Function}    callback       callback(err, [RedisClient])
 */
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


/**
 * Create a connection client to a random slave specified by the given Sentinel
 * @param  {RedisClient} sentinelClient Client connection to a Sentinel
 * @param  {String}      cluster        Name of the Redis cluster (i.e. mymaster)
 * @param  {Function}    callback       callback(err, [RedisClient])
 */
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

          // Every other line in the array is a value of the previous key
          function storeNext() {
            tmpSlave[config] = slave[index+1];
          }
        });
        

        // Only consider slaves that are online and valid
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


/**
 * Generates a random integer between min and max
 * @param  {Number} min Minimum value to output (inclusive)
 * @param  {Number} max Maximum value to output (inclusive)
 * @return {Number}     Random value
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


module.exports = Sentinel;