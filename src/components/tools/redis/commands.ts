// Reference list backing the CLI Console's autocomplete. Not exhaustive —
// covers the commands a developer actually reaches for during debugging
// (string/hash/list/set/zset/stream, generic key ops, pub/sub, transactions,
// server/admin). `syntax` is shown as an inline hint once the command name
// is fully typed.
export interface RedisCommandDef {
  name: string;
  syntax: string;
  summary: string;
}

export const REDIS_COMMANDS: RedisCommandDef[] = [
  // Generic
  { name: 'GET', syntax: 'GET key', summary: 'Get the string value of a key' },
  { name: 'SET', syntax: 'SET key value [EX seconds|PX ms] [NX|XX]', summary: 'Set the string value of a key' },
  { name: 'DEL', syntax: 'DEL key [key ...]', summary: 'Delete one or more keys' },
  { name: 'EXISTS', syntax: 'EXISTS key [key ...]', summary: 'Count how many of the given keys exist' },
  { name: 'TYPE', syntax: 'TYPE key', summary: 'Return the type of the value stored at key' },
  { name: 'TTL', syntax: 'TTL key', summary: 'Time to live in seconds, -1 no expiry, -2 missing' },
  { name: 'PTTL', syntax: 'PTTL key', summary: 'Time to live in milliseconds' },
  { name: 'EXPIRE', syntax: 'EXPIRE key seconds [NX|XX|GT|LT]', summary: 'Set a key\'s time to live in seconds' },
  { name: 'PEXPIRE', syntax: 'PEXPIRE key ms', summary: 'Set a key\'s time to live in milliseconds' },
  { name: 'PERSIST', syntax: 'PERSIST key', summary: 'Remove the expiration from a key' },
  { name: 'RENAME', syntax: 'RENAME key newkey', summary: 'Rename a key, overwriting the destination' },
  { name: 'RENAMENX', syntax: 'RENAMENX key newkey', summary: 'Rename a key only if the new name doesn\'t exist' },
  { name: 'KEYS', syntax: 'KEYS pattern', summary: 'Find keys matching a pattern (blocking — prefer SCAN)' },
  { name: 'SCAN', syntax: 'SCAN cursor [MATCH pattern] [COUNT n] [TYPE type]', summary: 'Incrementally iterate the keyspace' },
  { name: 'DBSIZE', syntax: 'DBSIZE', summary: 'Number of keys in the current db' },
  { name: 'FLUSHDB', syntax: 'FLUSHDB [ASYNC|SYNC]', summary: 'Delete all keys in the current db' },
  { name: 'FLUSHALL', syntax: 'FLUSHALL [ASYNC|SYNC]', summary: 'Delete all keys in all dbs' },
  { name: 'COPY', syntax: 'COPY source destination [DB n] [REPLACE]', summary: 'Copy the value of a key to a new key' },
  { name: 'MOVE', syntax: 'MOVE key db', summary: 'Move a key to another db' },
  { name: 'DUMP', syntax: 'DUMP key', summary: 'Serialize a key\'s value' },
  { name: 'OBJECT', syntax: 'OBJECT ENCODING|FREQ|IDLETIME|REFCOUNT key', summary: 'Inspect internal details of a key' },
  { name: 'MEMORY', syntax: 'MEMORY USAGE key | MEMORY STATS | MEMORY DOCTOR', summary: 'Memory usage / diagnostics' },
  { name: 'RANDOMKEY', syntax: 'RANDOMKEY', summary: 'Return a random key from the current db' },
  { name: 'SORT', syntax: 'SORT key [BY pattern] [LIMIT off count] [ASC|DESC]', summary: 'Sort the elements of a list/set/zset' },

  // String
  { name: 'MGET', syntax: 'MGET key [key ...]', summary: 'Get the values of multiple keys' },
  { name: 'MSET', syntax: 'MSET key value [key value ...]', summary: 'Set multiple keys at once' },
  { name: 'SETNX', syntax: 'SETNX key value', summary: 'Set a key only if it does not exist' },
  { name: 'SETEX', syntax: 'SETEX key seconds value', summary: 'Set a key with an expiration in seconds' },
  { name: 'GETSET', syntax: 'GETSET key value', summary: 'Set a key and return its old value' },
  { name: 'APPEND', syntax: 'APPEND key value', summary: 'Append a value to a string key' },
  { name: 'STRLEN', syntax: 'STRLEN key', summary: 'Length of the string value' },
  { name: 'INCR', syntax: 'INCR key', summary: 'Increment the integer value by one' },
  { name: 'INCRBY', syntax: 'INCRBY key n', summary: 'Increment the integer value by n' },
  { name: 'INCRBYFLOAT', syntax: 'INCRBYFLOAT key n', summary: 'Increment the float value by n' },
  { name: 'DECR', syntax: 'DECR key', summary: 'Decrement the integer value by one' },
  { name: 'DECRBY', syntax: 'DECRBY key n', summary: 'Decrement the integer value by n' },
  { name: 'GETRANGE', syntax: 'GETRANGE key start end', summary: 'Substring of the string value' },
  { name: 'SETRANGE', syntax: 'SETRANGE key offset value', summary: 'Overwrite part of a string at offset' },

  // Hash
  { name: 'HGET', syntax: 'HGET key field', summary: 'Get the value of a hash field' },
  { name: 'HSET', syntax: 'HSET key field value [field value ...]', summary: 'Set one or more hash fields' },
  { name: 'HSETNX', syntax: 'HSETNX key field value', summary: 'Set a hash field only if it does not exist' },
  { name: 'HMGET', syntax: 'HMGET key field [field ...]', summary: 'Get the values of multiple hash fields' },
  { name: 'HGETALL', syntax: 'HGETALL key', summary: 'Get all fields and values in a hash' },
  { name: 'HDEL', syntax: 'HDEL key field [field ...]', summary: 'Delete one or more hash fields' },
  { name: 'HEXISTS', syntax: 'HEXISTS key field', summary: 'Check whether a hash field exists' },
  { name: 'HLEN', syntax: 'HLEN key', summary: 'Number of fields in a hash' },
  { name: 'HKEYS', syntax: 'HKEYS key', summary: 'All field names in a hash' },
  { name: 'HVALS', syntax: 'HVALS key', summary: 'All values in a hash' },
  { name: 'HINCRBY', syntax: 'HINCRBY key field n', summary: 'Increment a hash field by n' },
  { name: 'HSCAN', syntax: 'HSCAN key cursor [MATCH pattern] [COUNT n]', summary: 'Incrementally iterate hash fields' },

  // List
  { name: 'LPUSH', syntax: 'LPUSH key value [value ...]', summary: 'Push values onto the head of a list' },
  { name: 'RPUSH', syntax: 'RPUSH key value [value ...]', summary: 'Push values onto the tail of a list' },
  { name: 'LPOP', syntax: 'LPOP key [count]', summary: 'Pop from the head of a list' },
  { name: 'RPOP', syntax: 'RPOP key [count]', summary: 'Pop from the tail of a list' },
  { name: 'LLEN', syntax: 'LLEN key', summary: 'Length of a list' },
  { name: 'LRANGE', syntax: 'LRANGE key start stop', summary: 'Get a range of elements from a list' },
  { name: 'LINDEX', syntax: 'LINDEX key index', summary: 'Get an element by index' },
  { name: 'LSET', syntax: 'LSET key index value', summary: 'Set the value of an element by index' },
  { name: 'LREM', syntax: 'LREM key count value', summary: 'Remove matching elements from a list' },
  { name: 'LTRIM', syntax: 'LTRIM key start stop', summary: 'Trim a list to the given range' },
  { name: 'LINSERT', syntax: 'LINSERT key BEFORE|AFTER pivot value', summary: 'Insert an element before/after another' },

  // Set
  { name: 'SADD', syntax: 'SADD key member [member ...]', summary: 'Add members to a set' },
  { name: 'SREM', syntax: 'SREM key member [member ...]', summary: 'Remove members from a set' },
  { name: 'SMEMBERS', syntax: 'SMEMBERS key', summary: 'All members of a set (unbounded — prefer SSCAN)' },
  { name: 'SISMEMBER', syntax: 'SISMEMBER key member', summary: 'Check whether a value is a member' },
  { name: 'SCARD', syntax: 'SCARD key', summary: 'Number of members in a set' },
  { name: 'SPOP', syntax: 'SPOP key [count]', summary: 'Remove and return random member(s)' },
  { name: 'SRANDMEMBER', syntax: 'SRANDMEMBER key [count]', summary: 'Get random member(s) without removing' },
  { name: 'SINTER', syntax: 'SINTER key [key ...]', summary: 'Intersect multiple sets' },
  { name: 'SUNION', syntax: 'SUNION key [key ...]', summary: 'Union multiple sets' },
  { name: 'SDIFF', syntax: 'SDIFF key [key ...]', summary: 'Difference of multiple sets' },
  { name: 'SSCAN', syntax: 'SSCAN key cursor [MATCH pattern] [COUNT n]', summary: 'Incrementally iterate set members' },

  // Sorted set
  { name: 'ZADD', syntax: 'ZADD key [NX|XX] [GT|LT] score member [score member ...]', summary: 'Add members with scores' },
  { name: 'ZREM', syntax: 'ZREM key member [member ...]', summary: 'Remove members from a sorted set' },
  { name: 'ZSCORE', syntax: 'ZSCORE key member', summary: 'Get the score of a member' },
  { name: 'ZINCRBY', syntax: 'ZINCRBY key n member', summary: 'Increment a member\'s score by n' },
  { name: 'ZCARD', syntax: 'ZCARD key', summary: 'Number of members in a sorted set' },
  { name: 'ZRANGE', syntax: 'ZRANGE key start stop [REV] [WITHSCORES]', summary: 'Get members by index range' },
  { name: 'ZRANGEBYSCORE', syntax: 'ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT off count]', summary: 'Get members by score range' },
  { name: 'ZRANK', syntax: 'ZRANK key member', summary: 'Rank of a member, low to high' },
  { name: 'ZREVRANK', syntax: 'ZREVRANK key member', summary: 'Rank of a member, high to low' },
  { name: 'ZCOUNT', syntax: 'ZCOUNT key min max', summary: 'Count members within a score range' },
  { name: 'ZSCAN', syntax: 'ZSCAN key cursor [MATCH pattern] [COUNT n]', summary: 'Incrementally iterate sorted set members' },

  // Stream
  { name: 'XADD', syntax: 'XADD key * field value [field value ...]', summary: 'Append an entry to a stream' },
  { name: 'XRANGE', syntax: 'XRANGE key start end [COUNT n]', summary: 'Range of entries, oldest first' },
  { name: 'XREVRANGE', syntax: 'XREVRANGE key end start [COUNT n]', summary: 'Range of entries, newest first' },
  { name: 'XLEN', syntax: 'XLEN key', summary: 'Number of entries in a stream' },
  { name: 'XDEL', syntax: 'XDEL key id [id ...]', summary: 'Delete entries from a stream' },
  { name: 'XTRIM', syntax: 'XTRIM key MAXLEN [~] n', summary: 'Trim a stream to approximately n entries' },

  // Pub/Sub
  { name: 'SUBSCRIBE', syntax: 'SUBSCRIBE channel [channel ...]', summary: 'Listen for messages on channels (use the Pub/Sub view)' },
  { name: 'PSUBSCRIBE', syntax: 'PSUBSCRIBE pattern [pattern ...]', summary: 'Listen on channels matching patterns (use the Pub/Sub view)' },
  { name: 'PUBLISH', syntax: 'PUBLISH channel message', summary: 'Publish a message to a channel' },
  { name: 'PUBSUB', syntax: 'PUBSUB CHANNELS|NUMSUB|NUMPAT', summary: 'Inspect the Pub/Sub subsystem' },

  // Transactions / scripting
  { name: 'MULTI', syntax: 'MULTI', summary: 'Start a transaction block' },
  { name: 'EXEC', syntax: 'EXEC', summary: 'Execute a transaction block' },
  { name: 'DISCARD', syntax: 'DISCARD', summary: 'Discard a transaction block' },
  { name: 'WATCH', syntax: 'WATCH key [key ...]', summary: 'Watch keys for optimistic locking' },
  { name: 'EVAL', syntax: 'EVAL script numkeys [key ...] [arg ...]', summary: 'Execute a Lua script' },

  // Server / connection
  { name: 'PING', syntax: 'PING [message]', summary: 'Check the connection is alive' },
  { name: 'ECHO', syntax: 'ECHO message', summary: 'Echo the given message' },
  { name: 'INFO', syntax: 'INFO [section]', summary: 'Server info and statistics' },
  { name: 'CLIENT', syntax: 'CLIENT LIST|INFO|GETNAME|SETNAME name', summary: 'Inspect or control client connections' },
  { name: 'CONFIG', syntax: 'CONFIG GET pattern | CONFIG SET param value', summary: 'Get or set server configuration' },
  { name: 'COMMAND', syntax: 'COMMAND COUNT|DOCS|INFO name', summary: 'Introspect available commands' },
  { name: 'SLOWLOG', syntax: 'SLOWLOG GET [n] | SLOWLOG RESET | SLOWLOG LEN', summary: 'Inspect the slow command log' },
  { name: 'LASTSAVE', syntax: 'LASTSAVE', summary: 'Unix time of the last successful save' },
  { name: 'SELECT', syntax: 'SELECT db', summary: 'Switch the logical db (use the DB selector instead — see below)' },
];
