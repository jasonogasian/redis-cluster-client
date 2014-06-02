var Sentinel = require('./redis-sentinel.js');

// Initialize to use all known Sentinels
Sentinel.init('mymaster', 
[
  { host:'localhost', port:26379},
  { host:'192.168.1.1', port:26379},
  { host:'anotherHost', port:26380}
], ready);


function ready(err) {
  if (err) {
    console.log('ERROR: ' + err);
    return;
  }

  // Connect to the cluster master and set a value
  Sentinel.command('set', ['clustering', 'is cool!']);

  // Connect to a random slave and get a hash value
  Sentinel.command('hget', ['fuster', 'cluck'], function(err, resp) {
    if (err) {
      console.log('ERROR: ' + err);
      return;
    }
    console.log(resp);
  }, true);
}