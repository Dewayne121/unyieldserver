const fs = require('fs');
const content = fs.readFileSync('routes/admin.js', 'utf8');

// Fix the prisma import path
const fixed = content.replace("require('../src/lib/prisma')", "require('../src/prisma')");

fs.writeFileSync('routes/admin.js', fixed);
console.log('Fixed prisma import');
