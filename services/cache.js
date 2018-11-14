const mongoose = require('mongoose');
const redis = require('redis');
const keys = require('./config/keys');
const client = redis.createClient(keys.redisURL);
const util = require('util');
// promisify a function
client.hget = util.promisify(client.hget);

const exec = mongoose.Query.prototype.exec;

/**
 * Cache flag
 * Warning: do not use an arrow function =>. The this in arrow functions is different 
 */
mongoose.Query.prototype.cache = function(options = {}) {
  this._useCache = true;
  this._hashKey = JSON.stringify(options.key || '');
  return this;
}


/**
 * Overwrite the exec function
 * Warning: do not use an arrow function =>. The this in arrow functions is different 
 */
mongoose.Query.prototype.exec = async function() {
  // If not cache just return
  if (!this._useCache) {
    return exec.apply(this, arguments);
  }

  const key = JSON.stringify(Object.assign({}, this.getQuery(), {
    collection: this.mongooseCollection.name
  }));
  console.log(key);
 
  // See if we have the key in redis
  const cachedValue = await client.hget(this._hashKey, key);
  if (cachedValue) {
    console.log('read cache');
    const doc = JSON.parse(cachedValue);
    return Array.isArray(doc)
      ? doc.map( d => new this.model(d))
      : new this.model(doc);
  }
  
  const results = await exec.apply(this, arguments);
  console.log('read mongo');

  // cache an expire in sec. Expire in 24h = 24*60*60
  client.hset(this._hashKey, key, JSON.stringify(results), 'EX', 60*60*24)
   
  // Execute the original function
  return results;
}

module.exports = {
  clearHash(hashKey) {
    client.del(JSON.stringify(hashKey));
  }
}