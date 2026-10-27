// Preloaded by every test run (`node --import ./test/setup-env.js --test …`), before any app
// module reads the environment. Tests run in the LIVE deployment's zone (Oman, UTC+4 = -240)
// and never see a developer's server/.env values for these keys.
process.env.APP_TIMEZONE_OFFSET = "-240";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "test-secret-not-for-production";
process.env.NODE_ENV = "test";
process.env.CLOUD_DRAFT_ENABLED = "false";
// Keep app.js's dotenv from pulling a real MONGO_URI into a test process.
process.env.MONGO_URI = "mongodb://invalid.test.invalid:1/never-used";
