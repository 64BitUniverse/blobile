const { writeFileSync } = require('fs-extra');

const p = require('./package.json');
p.build++;
writeFileSync('./package.json', JSON.stringify(p, undefined, 2));

console.info(`Updated package.json to build number ${p.build}`);
