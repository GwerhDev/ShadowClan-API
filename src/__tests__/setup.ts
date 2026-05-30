// Global test setup — env vars available to all test suites
process.env.PRIVATE_SECRET = 'test-secret-key';
process.env.MONGODB_STRING = 'mongodb://localhost:27017/test';
process.env.BNET_CLIENT    = 'test-bnet-client';
process.env.BNET_SECRET    = 'test-bnet-secret';
process.env.PORT           = '4000';
