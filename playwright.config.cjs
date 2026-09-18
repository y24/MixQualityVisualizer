const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir:'./tests/ui', timeout:120000, workers:1, reporter:'list', use:{ screenshot:'only-on-failure' } });
