console.log('No value for FOO yet:', process.env.FOO);

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

console.log('Now the value for secret is:', process.env.TWITTERR_CONSUMER_SECRET);
