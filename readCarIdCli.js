#!/usr/bin/env node

// CLI entry point for retrieving the RSFCarID for a given car slot.
// Usage: node readCarIdCli.js <path_to_Cars.ini> <slotId>
const { getRSFCarID } = require('./readCarId');

function usage() {
  console.log('Usage: node readCarIdCli.js <path_to_Cars.ini> <slotId>');
}

const [, , carsIniPath, slotId] = process.argv;

if (!carsIniPath || !slotId) {
  usage();
  process.exit(1);
}

const result = getRSFCarID(carsIniPath, parseInt(slotId, 10));
console.log(JSON.stringify(result, null, 2));

