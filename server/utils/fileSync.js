const fs = require('fs');

// Utility to read and sync .ini files
function readIniFile(filePath) {
  const ini = require('ini');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return ini.parse(fileContent);
}

function writeIniFile(filePath, data) {
  const ini = require('ini');
  const fileContent = ini.stringify(data);
  fs.writeFileSync(filePath, fileContent);
}

module.exports = { readIniFile, writeIniFile };
