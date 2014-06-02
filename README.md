redis-clustering-client
=======================

A client for communicating with a Redis Cluster via the cluster's Sentinel 
applications.

This module abstracts away the concept of a cluster to allow users to connect to 
the cluster master regardless of any failovers that have occurred since the last 
connection.  
You also have the option of connecting to a random slave of the cluster as well.  


Usage:
------

A simple example:

```js
  var Sentinel = require('./redis-sentinel.js');

  // Initialize to use all known Sentinels
  Sentinel.init('mymaster', 
  [
    { host:'192.168.1.1', port:26379},
    { host:'anotherHost', port:26380},
    { host:'localhost', port:26379}
  ], ready);


  function ready(err) {
    if (err) {
      console.log('ERROR: ' + err);
      return;
    }

    // Connect to the cluster master and set a value
    Sentinel.command('set', ['clustering', 'is cool!'], function(err, resp) {
      if (err) {
        console.log('ERROR: ' + err);
        return;
      }
    });

    // Connect to a random slave and get a hash value
    Sentinel.command('hget', ['fuster', 'cluck'], function(err, resp) {
      if (err) {
        console.log('ERROR: ' + err);
        return;
      }
      console.log(resp);
    }, true);
  }
```  


API:
----

###cluster.init(cluster, sentinelArray, [callback])
Provide an ordered array of sentinels to use for connections. A connection to 
the reported Master Redis server is also established as a check.

* `cluster`: the name of the Redis Cluster in sentinel.conf (default: mymaster)
* `sentinelArray`: an array of objects describing each Redis Sentinel to attempt 
a connection with.  
*Example (default):* 
```js
    [{host:"localhost", port:26379}]
```
* `callback([err])`: called when test connection to master is completed or an error 
occurs

###cluster.command(cmd, args, [callback, slave])
Send a Redis command to the cluster master (or slave if `slave == true`) and 
receive the response.

* `cmd`: redis command to execute
* `args`: array of arguments to the command
* `callback(err, [res])`: response from the redis server
* `slave`: boolean - if true send command to a random slave